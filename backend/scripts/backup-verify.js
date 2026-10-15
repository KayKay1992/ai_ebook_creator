// Proves a backup can actually be restored, without touching your data:
// checks the manifest checksums and counts, restores everything into a NEW
// temporary database (kenlibs_verify_<timestamp>) on the same server,
// compares document counts per collection with the manifest, then drops
// that temporary database. The real database is only read from (to learn
// its name, so the two can never be the same) and never written to.
//
// Usage (from backend/):
//   npm run backup:verify                          the newest folder in backups/
//   npm run backup:verify -- backups/2026-10-15_1530
//   npm run backup:verify -- <folder> --target-uri "<uri>"   use another server
const fs = require('fs');
const path = require('path');
const { loadEnv, parseArgs, maskConsole, formatCount } = require('./lib/cli');

loadEnv();
const args = parseArgs(process.argv.slice(2));
const uri = typeof args['target-uri'] === 'string' ? args['target-uri'] : process.env.MONGO_URI;
maskConsole([process.env.MONGO_URI, uri]);

const mongoose = require('mongoose');
const { BACKUP_FOLDER, MANIFEST, readManifest, tempDatabaseName, verifyByRestoring, describeTarget } = require('../utils/backup');

const newestBackup = (baseDir) => {
    if (!fs.existsSync(baseDir)) return null;
    const names = fs
        .readdirSync(baseDir)
        .filter((name) => BACKUP_FOLDER.test(name) && fs.existsSync(path.join(baseDir, name, MANIFEST)))
        .sort();
    return names.length ? path.join(baseDir, names[names.length - 1]) : null;
};

const main = async () => {
    if (!uri) throw new Error('MONGO_URI is not set in backend/.env and no --target-uri was given.');
    const dir = args._[0] ? path.resolve(args._[0]) : newestBackup(path.join(__dirname, '..', 'backups'));
    if (!dir) throw new Error('No backup found. Make one with: npm run backup');
    const manifest = readManifest(dir);

    const connection = await mongoose.createConnection(uri, { serverSelectionTimeoutMS: 20000 }).asPromise();
    try {
        const tempName = tempDatabaseName();
        const server = describeTarget(uri);
        const forbidden = new Set([connection.db.databaseName, manifest.source?.database].filter(Boolean));
        if (forbidden.has(tempName)) throw new Error('Temporary database name clashes with a real one; not continuing.');
        console.log(`Verifying ${dir}\nby restoring it into the temporary database "${tempName}" on ${server.host} …\n`);

        const result = await verifyByRestoring(connection.getClient().db(tempName), dir, { sourceDatabase: manifest.source?.database });
        for (const [name, { expected, restored }] of Object.entries(result.counts)) {
            console.log(`  ${name.padEnd(22)} manifest ${formatCount(expected).padStart(7)}   restored ${formatCount(restored).padStart(7)}   ${expected === restored ? 'OK' : 'MISMATCH'}`);
        }
        console.log(`\nTemporary database "${tempName}" dropped.`);
        if (result.ok) console.log('Backup verified: it restores completely.');
        else {
            console.error(`\nBackup verification FAILED:\n${result.problems.map((p) => `  - ${p}`).join('\n')}`);
            process.exitCode = 1;
        }
    } finally {
        await connection.close();
    }
};

main().catch((error) => {
    console.error(`\nVerification failed: ${error.message}`);
    process.exitCode = 1;
});
