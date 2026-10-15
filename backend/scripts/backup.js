// Backs up every collection of the Kenlibs MongoDB database to local files.
// Runs on your PC with backend/.env's MONGO_URI; nothing here runs on Render.
//
// Usage (from backend/):
//   npm run backup                      → backups/<YYYY-MM-DD_HHmm>/
//   npm run backup -- --out D:\KenlibsBackups
//   npm run backup -- --keep 7          also delete all but the newest 7
//                                       backups in that folder (off by default)
//
// Each collection becomes <collection>.json (Extended JSON, so ObjectIds and
// Dates restore exactly), plus manifest.json with document counts and a
// sha256 per file. Collections are streamed, so memory stays low.
//
// Backups contain personal data (emails, password hashes, purchases, the
// admin's payment details, readers' private notes): keep them private and
// never commit or share them. Images and audio are not included; they live
// in Cloudinary and the backup only holds their URLs/ids.
const path = require('path');
const { loadEnv, parseArgs, maskConsole, formatCount, formatBytes } = require('./lib/cli');

loadEnv();
const uri = process.env.MONGO_URI;
maskConsole([uri]);

const mongoose = require('mongoose');
const { createBackupFolder, exportDatabase, pruneBackups, describeTarget } = require('../utils/backup');

const main = async () => {
    const args = parseArgs(process.argv.slice(2));
    if (!uri) throw new Error('MONGO_URI is not set in backend/.env.');
    const baseDir = path.resolve(typeof args.out === 'string' ? args.out : path.join(__dirname, '..', 'backups'));
    const keep = args.keep === undefined ? null : Number(args.keep);
    if (keep !== null && (!Number.isInteger(keep) || keep < 1)) throw new Error('--keep must be a whole number of at least 1.');

    const connection = await mongoose.createConnection(uri, { serverSelectionTimeoutMS: 20000 }).asPromise();
    try {
        const db = connection.db;
        const source = describeTarget(uri, db.databaseName);
        const dir = createBackupFolder(baseDir);
        console.log(`Backing up database "${source.database}" on ${source.host}\n→ ${dir}\n`);

        const started = Date.now();
        const manifest = await exportDatabase(db, dir, {
            source,
            onCollection: (name, { count, bytes }) =>
                console.log(`  ${name.padEnd(22)} ${formatCount(count).padStart(8)} documents  ${formatBytes(bytes).padStart(8)}`),
        });

        const entries = Object.values(manifest.collections);
        const totalDocs = entries.reduce((sum, e) => sum + e.count, 0);
        const totalBytes = entries.reduce((sum, e) => sum + e.bytes, 0);
        console.log(
            `\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s: ${entries.length} collections, ` +
                `${formatCount(totalDocs)} documents, ${formatBytes(totalBytes)}.\n` +
                'Contains personal data (emails, password hashes, payment details): keep it private.\n' +
                'Images and audio are in Cloudinary and are not part of this backup.\n' +
                `Check it any time with: npm run backup:verify -- "${dir}"`
        );

        if (keep !== null) {
            const deleted = pruneBackups(baseDir, keep);
            console.log(deleted.length ? `\nKept the newest ${keep}; deleted:\n${deleted.map((d) => `  ${d}`).join('\n')}` : `\n--keep ${keep}: nothing to delete.`);
        }
    } finally {
        await connection.close();
    }
};

main().catch((error) => {
    console.error(`\nBackup failed: ${error.message}`);
    process.exitCode = 1;
});
