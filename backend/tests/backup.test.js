// Backup / restore: manifest + checksums, exact type round-trips, the
// restore safety rules (also through the real CLI), merge vs drop, the
// temporary-database verification, pruning, and secret masking. Runs
// entirely against an in-memory MongoDB.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const mongoose = require('mongoose');
const db = require('./dbHandler');
const backup = require('../utils/backup');

const { ObjectId } = mongoose.Types;
let tmpRoot;
let client;
let sourceDb;
let sourceUri;
let source;

const seed = async () => {
    await sourceDb.collection('users').insertMany([
        { _id: new ObjectId(), email: 'a@example.com', createdAt: new Date('2026-01-02T03:04:05.678Z'), credit: 1500, nested: { tags: ['x', 'y'] } },
        { _id: new ObjectId(), email: 'b@example.com', createdAt: new Date('2026-02-03T00:00:00Z'), credit: 0, note: 'line one\nline two, "quoted"' },
    ]);
    await sourceDb.collection('users').createIndex({ email: 1 }, { unique: true, name: 'email_1' });
    await sourceDb.collection('books').insertOne({ title: 'Big', chapters: [{ _id: new ObjectId(), content: 'x'.repeat(50000) }] });
    await sourceDb.createCollection('emptycollection');
};

const makeBackup = async () => {
    const dir = backup.createBackupFolder(path.join(tmpRoot, 'backups'));
    const manifest = await backup.exportDatabase(sourceDb, dir, { source });
    return { dir, manifest };
};

beforeAll(async () => {
    await db.connect();
    client = mongoose.connection.getClient();
    sourceDb = mongoose.connection.db;
    // The in-memory server's URI, pointing at the test's own database.
    const base = client.options.hosts.map((h) => `${h.host}:${h.port}`).join(',');
    sourceUri = `mongodb://${base}/${sourceDb.databaseName}`;
    source = backup.describeTarget(sourceUri);
});
beforeEach(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kenlibs-backup-test-'));
    await seed();
});
afterEach(async () => {
    // Raw collections (not Mongoose models), so drop the whole test
    // database rather than dbHandler.clearDatabase().
    await sourceDb.dropDatabase();
    for (const { name } of await client.db().admin().listDatabases().then((r) => r.databases)) {
        if (/^(restore_target|kenlibs_verify_)/.test(name)) await client.db(name).dropDatabase();
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
});
afterAll(async () => {
    await db.closeDatabase();
});

describe('backup and manifest', () => {
    it('exports every collection with counts, sha256 checksums, indexes and a self-ignoring folder', async () => {
        const { dir, manifest } = await makeBackup();
        expect(Object.keys(manifest.collections).sort()).toEqual(['books', 'emptycollection', 'users']);
        expect(manifest.collections.users).toMatchObject({ file: 'users.json', count: 2 });
        expect(manifest.collections.emptycollection.count).toBe(0);
        expect(manifest.collections.users.indexes).toEqual([expect.objectContaining({ name: 'email_1', unique: true, key: { email: 1 } })]);
        expect(manifest.source).toEqual(source);
        // Host and database name only: never credentials.
        expect(Object.keys(manifest.source).sort()).toEqual(['database', 'host']);
        expect(JSON.stringify(manifest.source)).not.toContain('@');

        for (const [name, entry] of Object.entries(manifest.collections)) {
            const file = path.join(dir, entry.file);
            expect(await backup.sha256File(file)).toBe(entry.sha256);
            // Each file is a valid JSON array (EJSON documents, one per line).
            expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toHaveLength(entry.count);
            expect(name).toBeTruthy();
        }
        expect(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8')).toBe('*\n');
        expect(JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).collections.books.count).toBe(1);
        expect(path.basename(dir)).toMatch(backup.BACKUP_FOLDER);
        expect((await backup.verifyBackup(dir)).ok).toBe(true);
    });

    it('verification catches a changed file, a wrong count, a missing file and a bad file name', async () => {
        const { dir } = await makeBackup();
        const usersFile = path.join(dir, 'users.json');
        fs.writeFileSync(usersFile, fs.readFileSync(usersFile, 'utf8').replace('a@example.com', 'z@example.com'));
        let result = await backup.verifyBackup(dir);
        expect(result.ok).toBe(false);
        expect(result.problems).toEqual([expect.stringMatching(/users: checksum mismatch/)]);

        const { dir: dir2 } = await makeBackup();
        const manifestFile = path.join(dir2, 'manifest.json');
        const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
        manifest.collections.users.count = 3;
        manifest.collections.books.file = '../../etc/passwd';
        fs.writeFileSync(manifestFile, JSON.stringify(manifest));
        fs.rmSync(path.join(dir2, 'emptycollection.json'));
        result = await backup.verifyBackup(dir2);
        expect(result.problems).toEqual(
            expect.arrayContaining([
                expect.stringMatching(/users: 2 documents in the file, manifest says 3/),
                expect.stringMatching(/books: invalid file name/),
                expect.stringMatching(/emptycollection: file emptycollection.json is missing/),
            ])
        );
        expect((await backup.verifyBackup(dir2, { only: ['nope'] })).problems).toEqual(['nope: not in this backup.']);
    });

    it('--keep prunes only real backup folders, newest kept', async () => {
        const base = path.join(tmpRoot, 'prune');
        const make = (name, withManifest = true) => {
            fs.mkdirSync(path.join(base, name), { recursive: true });
            if (withManifest) fs.writeFileSync(path.join(base, name, 'manifest.json'), '{}');
        };
        ['2026-10-01_0900', '2026-10-02_0900', '2026-10-03_0900', '2026-10-03_090012'].forEach((n) => make(n));
        make('2026-09-01_0900', false); // no manifest: not ours
        make('my-notes'); // not a backup name
        const deleted = backup.pruneBackups(base, 2).map((d) => path.basename(d));
        expect(deleted.sort()).toEqual(['2026-10-01_0900', '2026-10-02_0900']);
        expect(fs.readdirSync(base).sort()).toEqual(['2026-09-01_0900', '2026-10-03_0900', '2026-10-03_090012', 'my-notes']);
        expect(() => backup.pruneBackups(base, 0)).toThrow();
    });
});

describe('restore safety rules', () => {
    const manifest = () => ({ source: { host: 'cluster0.abc.mongodb.net', database: 'test' } });
    const same = { host: 'cluster0.abc.mongodb.net', database: 'test' };
    const other = { host: 'cluster0.abc.mongodb.net', database: 'kenlibs_copy' };

    it('dry runs are always allowed (they write nothing)', () => {
        expect(backup.checkRestoreSafety({ manifest: manifest(), target: same }).allowed).toBe(true);
    });

    it('refuses to write into the source database without --yes-overwrite and the typed name', () => {
        const refused = backup.checkRestoreSafety({ manifest: manifest(), target: same, dryRun: false });
        expect(refused).toMatchObject({ allowed: false });
        expect(refused.reason).toMatch(/Refusing to write into "test"/);
        expect(backup.checkRestoreSafety({ manifest: manifest(), target: same, dryRun: false, yesOverwrite: true, typedName: 'tset' }).allowed).toBe(false);
        expect(backup.checkRestoreSafety({ manifest: manifest(), target: same, dryRun: false, yesOverwrite: true, typedName: null }).allowed).toBe(false);
        expect(backup.checkRestoreSafety({ manifest: manifest(), target: same, dryRun: false, yesOverwrite: true, typedName: 'test' }).allowed).toBe(true);
    });

    it('a backup that does not say where it came from is treated as the source', () => {
        expect(backup.checkRestoreSafety({ manifest: { source: null }, target: other, dryRun: false }).allowed).toBe(false);
    });

    it('allows writing into a different database', () => {
        expect(backup.checkRestoreSafety({ manifest: manifest(), target: other, dryRun: false }).allowed).toBe(true);
        const otherHost = { host: 'cluster9.xyz.mongodb.net', database: 'test' };
        expect(backup.checkRestoreSafety({ manifest: manifest(), target: otherHost, dryRun: false }).allowed).toBe(true);
    });

    it('the real restore CLI refuses the source database, and a dry run writes nothing', async () => {
        const { dir } = await makeBackup();
        const before = await sourceDb.collection('users').countDocuments();
        const run = (...extra) =>
            spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'restore.js'), dir, '--target-uri', sourceUri, ...extra], {
                // Never the real database: MONGO_URI is the in-memory one too.
                env: { ...process.env, MONGO_URI: sourceUri },
                encoding: 'utf8',
                timeout: 60000,
            });

        const dryRun = run();
        expect(dryRun.status).toBe(0);
        expect(dryRun.stdout).toMatch(/THE SAME DATABASE THIS BACKUP CAME FROM/);
        expect(dryRun.stdout).toMatch(/Dry run: nothing was written/);

        const refused = run('--apply');
        expect(refused.status).toBe(1);
        expect(refused.stderr).toMatch(/Refusing to write into/);

        const notInteractive = run('--apply', '--yes-overwrite');
        expect(notInteractive.status).toBe(1);
        expect(notInteractive.stderr).toMatch(/interactive terminal/);

        await sourceDb.collection('users').deleteMany({});
        await sourceDb.collection('users').insertOne({ email: 'changed@example.com' });
        expect(run('--apply').status).toBe(1);
        expect(await sourceDb.collection('users').countDocuments()).toBe(1); // untouched by the refused runs
        expect(before).toBe(2);
    });

    it('the CLI stops before connecting when the backup fails verification', async () => {
        const { dir } = await makeBackup();
        fs.appendFileSync(path.join(dir, 'books.json'), ' ');
        const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'restore.js'), dir, '--target-uri', 'mongodb://127.0.0.1:1/never', '--apply'], {
            env: { ...process.env, MONGO_URI: 'mongodb://127.0.0.1:1/never' },
            encoding: 'utf8',
            timeout: 60000,
        });
        expect(result.status).toBe(1);
        expect(result.stderr).toMatch(/failed verification[\s\S]*books: checksum mismatch/);
    });
});

describe('restoring', () => {
    it('restores into another database with exact types and indexes', async () => {
        const { dir, manifest } = await makeBackup();
        const target = client.db('restore_target_types');
        const plan = await backup.planRestore(target, manifest);
        expect(plan.every((step) => step.action === 'create')).toBe(true);
        await backup.restoreCollections(target, dir, manifest, plan);

        const original = await sourceDb.collection('users').find().sort({ _id: 1 }).toArray();
        const restored = await target.collection('users').find().sort({ _id: 1 }).toArray();
        expect(restored).toEqual(original);
        expect(restored[0]._id).toBeInstanceOf(ObjectId);
        expect(restored[0].createdAt).toBeInstanceOf(Date);
        expect(restored[1].note).toBe('line one\nline two, "quoted"');
        expect((await target.collection('books').findOne()).chapters[0].content).toHaveLength(50000);
        expect((await target.collection('users').indexes()).map((i) => i.name)).toContain('email_1');
    });

    it('merges by default (existing _ids skipped, never overwritten) and only drops with --drop; --only limits it', async () => {
        const { dir, manifest } = await makeBackup();
        const target = client.db('restore_target_merge');
        const [first] = await sourceDb.collection('users').find().sort({ _id: 1 }).toArray();
        await target.collection('users').insertOne({ _id: first._id, email: 'kept-version@example.com' });
        await target.collection('users').insertOne({ email: 'only-in-target@example.com' });

        let plan = await backup.planRestore(target, manifest, { only: ['users'] });
        expect(plan).toEqual([{ name: 'users', backupCount: 2, targetCount: 2, action: 'merge' }]);
        const [merged] = await backup.restoreCollections(target, dir, manifest, plan);
        expect(merged).toMatchObject({ inserted: 1, skipped: 1, finalCount: 3 });
        expect((await target.collection('users').findOne({ _id: first._id })).email).toBe('kept-version@example.com');
        expect(await target.collection('books').countDocuments()).toBe(0); // --only

        plan = await backup.planRestore(target, manifest, { only: ['users'], drop: true });
        expect(plan[0].action).toBe('replace');
        await backup.restoreCollections(target, dir, manifest, plan, { drop: true });
        expect(await target.collection('users').countDocuments()).toBe(2);
        expect((await target.collection('users').findOne({ _id: first._id })).email).toBe('a@example.com');
        await expect(backup.planRestore(target, manifest, { only: ['nope'] })).rejects.toThrow(/not in this backup/);
    });
});

describe('verify by restoring into a temporary database', () => {
    it('restores, compares counts, drops the temporary database, and never touches the source', async () => {
        const { dir } = await makeBackup();
        const tempName = backup.tempDatabaseName();
        const result = await backup.verifyByRestoring(client.db(tempName), dir, { sourceDatabase: sourceDb.databaseName });
        expect(result.ok).toBe(true);
        expect(result.counts.users).toEqual({ expected: 2, restored: 2 });
        const databases = (await client.db().admin().listDatabases()).databases.map((d) => d.name);
        expect(databases).not.toContain(tempName);
        expect(await sourceDb.collection('users').countDocuments()).toBe(2);
    });

    it('refuses an unexpected, non-empty or source database name', async () => {
        const { dir } = await makeBackup();
        await expect(backup.verifyByRestoring(client.db('production'), dir)).rejects.toThrow(/Refusing/);
        await expect(backup.verifyByRestoring(sourceDb, dir)).rejects.toThrow(/Refusing/);
        const busy = client.db('kenlibs_verify_1');
        await busy.collection('x').insertOne({ a: 1 });
        await expect(backup.verifyByRestoring(busy, dir)).rejects.toThrow(/already has data/);
        expect(await busy.collection('x').countDocuments()).toBe(1);
        await busy.dropDatabase();
        await expect(backup.verifyByRestoring(client.db('kenlibs_verify_2'), dir, { sourceDatabase: 'kenlibs_verify_2' })).rejects.toThrow(/must not be the source/);
    });

    it('reports a damaged backup instead of restoring it', async () => {
        const { dir } = await makeBackup();
        fs.appendFileSync(path.join(dir, 'users.json'), '\n');
        const result = await backup.verifyByRestoring(client.db(backup.tempDatabaseName()), dir);
        expect(result.ok).toBe(false);
        expect(result.problems[0]).toMatch(/checksum mismatch/);
    });
});

describe('masking', () => {
    it('never shows credentials or query strings', () => {
        // A fake URI, assembled from parts so secret scanners don't flag it.
        const user = 'test' + 'user';
        const password = 'notareal' + 'password%21';
        const uri = 'mongodb+srv://' + user + ':' + password + '@cluster0.example.invalid/test?retryWrites=true&appName=x';
        expect(backup.maskUri(uri)).toBe('mongodb+srv://***@cluster0.example.invalid/test?***');
        const redacted = backup.redact(`failed to connect to ${uri}`, [uri]);
        for (const part of [user, password, 'notarealpassword', 'retryWrites']) expect(redacted).not.toContain(part);
        expect(backup.describeTarget(uri)).toEqual({ host: 'cluster0.example.invalid', database: 'test' });
        expect(backup.describeTarget('mongodb://h1:1,h2:2/')).toEqual({ host: 'h1:1,h2:2', database: 'test' });
        expect(backup.describeTarget(uri, 'kenlibs_copy').database).toBe('kenlibs_copy');
        expect(() => backup.describeTarget('postgres://x')).toThrow();
    });
});
