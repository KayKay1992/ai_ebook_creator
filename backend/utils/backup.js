const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
// The driver's own BSON/EJSON (via mongoose), so types match what's stored.
const { EJSON } = require('mongoose').mongo.BSON;

// Local backup and restore of the Kenlibs MongoDB data (scripts/backup.js,
// scripts/restore.js, scripts/backup-verify.js; run on the admin's PC, never
// on Render). Everything that touches the filesystem or a database lives
// here so it can be tested against an in-memory MongoDB.
//
// Backup folder layout (backups/<YYYY-MM-DD_HHmm>/):
//   <collection>.json   a JSON array, one Extended JSON (EJSON, relaxed:
//                       false) document per line, so ObjectIds, Dates and
//                       numbers restore with their exact types. One
//                       document per line also lets restore stream it.
//   manifest.json       date, source (host + database name, never the
//                       credentials), and per collection: file, document
//                       count, sha256 of the file, and index definitions.
//   .gitignore          "*", so the folder can't be committed even if it's
//                       written somewhere inside the repository.
//
// Images and audio are NOT in a backup: they live in Cloudinary, and the
// backup only holds their URLs/ids.

const MANIFEST = 'manifest.json';
const FORMAT_VERSION = 1;
const BATCH_SIZE = 500;
const BACKUP_FOLDER = /^\d{4}-\d{2}-\d{2}_\d{4}(\d{2})?$/;

// ---------------------------------------------------------------------------
// Connection strings: shown masked, compared by host + database name.

// Hides credentials (and any query string, which can carry secrets too).
const maskUri = (uri = '') =>
    String(uri)
        .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]*@/gi, '$1***@')
        .replace(/\?[^\s]*/, '?***');

// Any text that might contain a connection string, made safe to print.
const redact = (text, uris = []) => {
    let out = String(text);
    for (const uri of uris.filter(Boolean)) out = out.split(uri).join(maskUri(uri));
    return maskUri(out);
};

// { host, database } of a mongodb:// or mongodb+srv:// URI (database
// defaults to "test", as the driver does). `databaseOverride` wins.
const describeTarget = (uri, databaseOverride) => {
    const match = /^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)(?:\/([^?]*))?/i.exec(String(uri || '').trim());
    if (!match) throw new Error('That is not a MongoDB connection string (mongodb:// or mongodb+srv://).');
    const host = match[1].toLowerCase().split(',').sort().join(',');
    const database = databaseOverride || decodeURIComponent(match[2] || '') || 'test';
    return { host, database };
};

const isSameDatabase = (a, b) => Boolean(a && b) && a.host === b.host && a.database === b.database;

// ---------------------------------------------------------------------------
// Backup

const pad = (n) => String(n).padStart(2, '0');
const folderNameFor = (date = new Date()) =>
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`;

// A new, empty folder under baseDir: YYYY-MM-DD_HHmm, or with seconds if
// that already exists.
const createBackupFolder = (baseDir, date = new Date()) => {
    fs.mkdirSync(baseDir, { recursive: true });
    let dir = path.join(baseDir, folderNameFor(date));
    if (fs.existsSync(dir)) dir = `${dir}${pad(date.getSeconds())}`;
    if (fs.existsSync(dir)) throw new Error(`Backup folder already exists: ${dir}`);
    fs.mkdirSync(dir);
    // Never committable, wherever it's written.
    fs.writeFileSync(path.join(dir, '.gitignore'), '*\n');
    return dir;
};

// Writes one collection as a streamed JSON array (one EJSON document per
// line), hashing as it goes. Returns { count, sha256, bytes }.
const exportCollection = async (collection, file) => {
    const hash = crypto.createHash('sha256');
    const out = fs.createWriteStream(file, { encoding: 'utf8' });
    let bytes = 0;
    const write = (chunk) =>
        new Promise((resolve, reject) => {
            hash.update(chunk, 'utf8');
            bytes += Buffer.byteLength(chunk, 'utf8');
            if (out.write(chunk)) resolve();
            else out.once('drain', resolve).once('error', reject);
        });
    let count = 0;
    await write('[\n');
    // _id order keeps the export stable; the cursor streams in batches.
    const cursor = collection.find({}, { batchSize: BATCH_SIZE }).sort({ _id: 1 });
    for await (const doc of cursor) {
        await write(`${count ? ',\n' : ''}${EJSON.stringify(doc, { relaxed: false })}`);
        count += 1;
    }
    await write(`${count ? '\n' : ''}]\n`);
    await new Promise((resolve, reject) => out.end((error) => (error ? reject(error) : resolve())));
    return { count, sha256: hash.digest('hex'), bytes };
};

// Exports every collection of `db` (a native driver Db) into `dir` and
// writes the manifest. `source` is describeTarget() of where it came from.
const exportDatabase = async (db, dir, { source, onCollection } = {}) => {
    const collections = (await db.listCollections({ type: 'collection' }, { nameOnly: true }).toArray())
        .map((c) => c.name)
        .filter((name) => !name.startsWith('system.'))
        .sort();
    const manifest = {
        formatVersion: FORMAT_VERSION,
        createdAt: new Date().toISOString(),
        source: source ? { host: source.host, database: source.database } : null,
        note: 'Images and audio are not included: they live in Cloudinary and are only referenced here by URL/id. This backup contains personal data (emails, password hashes, payment details): keep it private.',
        collections: {},
    };
    for (const name of collections) {
        const file = `${name}.json`;
        const result = await exportCollection(db.collection(name), path.join(dir, file));
        const indexes = (await db.collection(name).indexes())
            .filter((index) => index.name !== '_id_')
            .map(({ v, ns, ...index }) => index);
        manifest.collections[name] = { file, count: result.count, sha256: result.sha256, bytes: result.bytes, indexes };
        if (onCollection) onCollection(name, result);
    }
    fs.writeFileSync(path.join(dir, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
    return manifest;
};

// Deletes all but the newest `keep` backup folders in baseDir. Only folders
// named like a backup AND containing a manifest are ever touched. Returns
// the deleted paths.
const pruneBackups = (baseDir, keep) => {
    if (!Number.isInteger(keep) || keep < 1) throw new Error('--keep must be a whole number of at least 1.');
    if (!fs.existsSync(baseDir)) return [];
    const backups = fs
        .readdirSync(baseDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && BACKUP_FOLDER.test(entry.name))
        .filter((entry) => fs.existsSync(path.join(baseDir, entry.name, MANIFEST)))
        .map((entry) => entry.name)
        .sort()
        .reverse();
    const doomed = backups.slice(keep).map((name) => path.join(baseDir, name));
    for (const dir of doomed) fs.rmSync(dir, { recursive: true });
    return doomed;
};

// ---------------------------------------------------------------------------
// Verification (before any restore)

const sha256File = (file) =>
    new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        fs.createReadStream(file)
            .on('data', (chunk) => hash.update(chunk))
            .on('error', reject)
            .on('end', () => resolve(hash.digest('hex')));
    });

// Streams the documents of a backup file, batch by batch (arrays of
// EJSON-parsed documents).
async function* readDocuments(file, batchSize = BATCH_SIZE) {
    const lines = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
    let batch = [];
    for await (const raw of lines) {
        const line = raw.trim().replace(/,$/, '');
        if (!line || line === '[' || line === ']') continue;
        batch.push(EJSON.parse(line, { relaxed: false }));
        if (batch.length >= batchSize) {
            yield batch;
            batch = [];
        }
    }
    if (batch.length) yield batch;
}

const countDocuments = async (file) => {
    let count = 0;
    for await (const batch of readDocuments(file)) count += batch.length;
    return count;
};

const readManifest = (dir) => {
    const file = path.join(dir, MANIFEST);
    if (!fs.existsSync(file)) throw new Error(`No ${MANIFEST} in ${dir}. Is this a backup folder?`);
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (manifest.formatVersion !== FORMAT_VERSION || !manifest.collections) throw new Error(`Unsupported or damaged ${MANIFEST}.`);
    return manifest;
};

// Checks every listed file (or just `only`): it exists, its sha256 matches
// and it holds exactly the manifest's number of documents.
// Returns { ok, manifest, problems: [string] }.
const verifyBackup = async (dir, { only } = {}) => {
    const manifest = readManifest(dir);
    const problems = [];
    const names = only?.length ? only : Object.keys(manifest.collections);
    for (const name of names) {
        const entry = manifest.collections[name];
        if (!entry) {
            problems.push(`${name}: not in this backup.`);
            continue;
        }
        // The file name comes from the manifest: never let it point outside.
        if (path.basename(entry.file) !== entry.file) {
            problems.push(`${name}: invalid file name in manifest.`);
            continue;
        }
        const file = path.join(dir, entry.file);
        if (!fs.existsSync(file)) {
            problems.push(`${name}: file ${entry.file} is missing.`);
            continue;
        }
        if ((await sha256File(file)) !== entry.sha256) {
            problems.push(`${name}: checksum mismatch (the file changed or is damaged).`);
            continue;
        }
        const count = await countDocuments(file);
        if (count !== entry.count) problems.push(`${name}: ${count} documents in the file, manifest says ${entry.count}.`);
    }
    return { ok: problems.length === 0, manifest, problems };
};

// ---------------------------------------------------------------------------
// Restore

// The rule for writing into a database at all. `target` and
// manifest.source are describeTarget() results; `typedName` is what the
// person typed when asked for the database name.
// Returns { allowed: boolean, reason }.
// (Dropping collections needs its own explicit --drop flag, checked by the
// CLI; on the source database it can only happen after this confirmation.)
const checkRestoreSafety = ({ manifest, target, dryRun = true, yesOverwrite = false, typedName = null }) => {
    if (!target) return { allowed: false, reason: 'No target database.' };
    if (dryRun) return { allowed: true, reason: 'Dry run: nothing will be written.' };
    const sameAsSource = !manifest?.source || isSameDatabase(manifest.source, target);
    if (sameAsSource) {
        if (!yesOverwrite) {
            return {
                allowed: false,
                reason: manifest?.source
                    ? `Refusing to write into "${target.database}", the database this backup came from. Restore into a different database with --target-uri / --target-db, or pass --yes-overwrite and type the database name when asked.`
                    : 'This backup does not say which database it came from, so it is treated as the same one: pass --yes-overwrite and type the database name when asked.',
            };
        }
        if (typedName !== target.database) {
            return { allowed: false, reason: `The name you typed does not match "${target.database}". Nothing was written.` };
        }
    }
    return { allowed: true, reason: sameAsSource ? 'Confirmed overwrite of the source database.' : 'Different database from the backup source.' };
};

// What a restore would do, per collection: { name, backupCount,
// targetCount, action } where action is 'create' (collection doesn't exist
// or is empty), 'merge' (insert, skipping _ids already there) or 'replace'
// (with --drop).
const planRestore = async (db, manifest, { only, drop = false } = {}) => {
    const names = only?.length ? only : Object.keys(manifest.collections).sort();
    const plan = [];
    for (const name of names) {
        const entry = manifest.collections[name];
        if (!entry) throw new Error(`"${name}" is not in this backup.`);
        const targetCount = await db.collection(name).countDocuments();
        plan.push({
            name,
            backupCount: entry.count,
            targetCount,
            action: targetCount === 0 ? 'create' : drop ? 'replace' : 'merge',
        });
    }
    return plan;
};

// Restores the planned collections into `db`. Only drops a collection when
// `drop` is true. In merge mode documents whose _id already exists are
// skipped (reported, never overwritten). Returns per-collection results.
const restoreCollections = async (db, dir, manifest, plan, { drop = false, onCollection } = {}) => {
    const results = [];
    for (const step of plan) {
        const entry = manifest.collections[step.name];
        const collection = db.collection(step.name);
        if (drop && step.targetCount > 0) await collection.drop().catch(() => {});
        let inserted = 0;
        let skipped = 0;
        for await (const batch of readDocuments(path.join(dir, entry.file))) {
            try {
                const result = await collection.insertMany(batch, { ordered: false });
                inserted += result.insertedCount;
            } catch (error) {
                // Duplicate _ids (merge mode) are expected and skipped; any
                // other write error stops the restore.
                const writeErrors = error.writeErrors || error.result?.getWriteErrors?.() || [];
                const nonDuplicate = writeErrors.filter((e) => (e.code ?? e.err?.code) !== 11000);
                if (!writeErrors.length || nonDuplicate.length) throw error;
                inserted += error.result?.insertedCount ?? error.insertedCount ?? batch.length - writeErrors.length;
                skipped += writeErrors.length;
            }
        }
        for (const index of entry.indexes || []) {
            const { key, name, ...options } = index;
            await collection.createIndex(key, { name, ...options }).catch((error) => {
                throw new Error(`Couldn't recreate index ${name} on ${step.name}: ${error.message}`);
            });
        }
        const finalCount = await collection.countDocuments();
        const result = { name: step.name, inserted, skipped, finalCount };
        results.push(result);
        if (onCollection) onCollection(result);
    }
    return results;
};

// ---------------------------------------------------------------------------
// Verify by restoring into a temporary database

const tempDatabaseName = (date = new Date()) => `kenlibs_verify_${date.getTime()}`;
const TEMP_DATABASE = /^kenlibs_verify_\d+$/;

// Restores the whole backup into `tempDb` (must be empty and named like
// kenlibs_verify_<n>), compares counts with the manifest, then drops it.
// Returns { ok, problems, counts }.
const verifyByRestoring = async (tempDb, dir, { sourceDatabase } = {}) => {
    if (!TEMP_DATABASE.test(tempDb.databaseName)) throw new Error(`Refusing to use "${tempDb.databaseName}" as a temporary database.`);
    if (sourceDatabase && tempDb.databaseName === sourceDatabase) throw new Error('The temporary database must not be the source database.');
    const existing = await tempDb.listCollections({}, { nameOnly: true }).toArray();
    if (existing.length) throw new Error(`Temporary database "${tempDb.databaseName}" already has data; not touching it.`);

    const check = await verifyBackup(dir);
    if (!check.ok) return { ok: false, problems: check.problems, counts: {} };
    try {
        const plan = await planRestore(tempDb, check.manifest);
        const results = await restoreCollections(tempDb, dir, check.manifest, plan);
        const problems = [];
        const counts = {};
        for (const result of results) {
            const expected = check.manifest.collections[result.name].count;
            counts[result.name] = { expected, restored: result.finalCount };
            if (result.finalCount !== expected) problems.push(`${result.name}: restored ${result.finalCount}, manifest says ${expected}.`);
        }
        return { ok: problems.length === 0, problems, counts };
    } finally {
        await tempDb.dropDatabase();
    }
};

module.exports = {
    MANIFEST,
    BACKUP_FOLDER,
    maskUri,
    redact,
    describeTarget,
    isSameDatabase,
    folderNameFor,
    createBackupFolder,
    exportCollection,
    exportDatabase,
    pruneBackups,
    sha256File,
    readDocuments,
    readManifest,
    verifyBackup,
    checkRestoreSafety,
    planRestore,
    restoreCollections,
    tempDatabaseName,
    verifyByRestoring,
};
