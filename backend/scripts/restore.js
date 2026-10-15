// Restores a backup made by scripts/backup.js. SAFE BY DEFAULT:
//   - A dry run unless you add --apply: it verifies the backup and reports
//     what would change, and writes nothing.
//   - Every file's checksum and document count is checked against
//     manifest.json first; any mismatch stops it.
//   - It refuses to write into the database the backup came from unless you
//     pass --yes-overwrite AND type that database's name when asked.
//   - It never drops a collection unless you pass --drop. Without it,
//     documents are added and any whose _id already exists are skipped
//     (never overwritten).
//
// Usage (from backend/):
//   npm run restore -- backups/2026-10-15_1530                       dry run against MONGO_URI
//   npm run restore -- backups/2026-10-15_1530 --target-db kenlibs_copy --apply
//   npm run restore -- backups/2026-10-15_1530 --target-uri "<uri>" --apply
//   npm run restore -- backups/2026-10-15_1530 --only users,books --target-db kenlibs_copy --apply
//   npm run restore -- backups/2026-10-15_1530 --target-db kenlibs_copy --drop --apply
//   (overwrite the source, deliberately)  --yes-overwrite --apply   then type the name
const path = require('path');
const readline = require('readline');
const { loadEnv, parseArgs, maskConsole, formatCount } = require('./lib/cli');

loadEnv();
const args = parseArgs(process.argv.slice(2));
const targetUri = typeof args['target-uri'] === 'string' ? args['target-uri'] : process.env.MONGO_URI;
maskConsole([process.env.MONGO_URI, targetUri]);

const mongoose = require('mongoose');
const { verifyBackup, describeTarget, isSameDatabase, planRestore, restoreCollections, checkRestoreSafety } = require('../utils/backup');

const ask = (question) =>
    new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });

const main = async () => {
    const [folder] = args._;
    if (!folder) throw new Error('Which backup? Usage: npm run restore -- <backup folder> [--apply] (see the top of scripts/restore.js).');
    if (!targetUri) throw new Error('No target: MONGO_URI is not set in backend/.env and no --target-uri was given.');
    const dir = path.resolve(folder);
    const only = typeof args.only === 'string' ? args.only.split(',').map((s) => s.trim()).filter(Boolean) : null;
    const apply = Boolean(args.apply) && !args['dry-run'];
    const drop = Boolean(args.drop);

    console.log(`Checking backup ${dir} …`);
    const check = await verifyBackup(dir, { only });
    if (!check.ok) {
        console.error(`\nThe backup failed verification; nothing was restored:\n${check.problems.map((p) => `  - ${p}`).join('\n')}`);
        process.exitCode = 1;
        return;
    }
    const { manifest } = check;
    console.log(`Backup OK: made ${manifest.createdAt}${manifest.source ? ` from "${manifest.source.database}" on ${manifest.source.host}` : ''}.`);

    const connection = await mongoose.createConnection(targetUri, { serverSelectionTimeoutMS: 20000 }).asPromise();
    try {
        const databaseName = typeof args['target-db'] === 'string' ? args['target-db'] : connection.db.databaseName;
        const db = connection.getClient().db(databaseName);
        const target = describeTarget(targetUri, databaseName);
        const sameAsSource = !manifest.source || isSameDatabase(manifest.source, target);
        console.log(`Target: "${target.database}" on ${target.host}${sameAsSource ? '  ← THE SAME DATABASE THIS BACKUP CAME FROM' : ''}\n`);

        const plan = await planRestore(db, manifest, { only, drop });
        const describe = { create: 'restore into empty collection', merge: 'add missing documents (existing _ids skipped)', replace: 'DROP the collection, then restore' };
        for (const step of plan) {
            console.log(`  ${step.name.padEnd(22)} backup ${formatCount(step.backupCount).padStart(7)}   target now ${formatCount(step.targetCount).padStart(7)}   → ${describe[step.action]}`);
        }

        if (!apply) {
            console.log('\nDry run: nothing was written. Add --apply to restore.');
            return;
        }

        let typedName = null;
        if (sameAsSource && args['yes-overwrite']) {
            if (!process.stdin.isTTY) throw new Error('Overwriting the source database needs you to type its name, so it must be run in an interactive terminal.');
            typedName = await ask(`\nThis writes into "${target.database}", the database this backup came from.\nType the database name to confirm: `);
        }
        const safety = checkRestoreSafety({ manifest, target, dryRun: false, yesOverwrite: Boolean(args['yes-overwrite']), typedName });
        if (!safety.allowed) {
            console.error(`\nNot restoring: ${safety.reason}`);
            process.exitCode = 1;
            return;
        }
        const dropping = plan.filter((step) => step.action === 'replace').map((step) => step.name);
        if (dropping.length) console.log(`\n--drop: these collections will be dropped first: ${dropping.join(', ')}`);

        console.log('\nRestoring…');
        const results = await restoreCollections(db, dir, manifest, plan, {
            drop,
            onCollection: ({ name, inserted, skipped, finalCount }) =>
                console.log(`  ${name.padEnd(22)} inserted ${formatCount(inserted).padStart(7)}   skipped (already there) ${formatCount(skipped).padStart(6)}   now ${formatCount(finalCount)}`),
        });
        console.log(`\nDone: ${results.length} collection${results.length === 1 ? '' : 's'} restored into "${target.database}".`);
    } finally {
        await connection.close();
    }
};

main().catch((error) => {
    console.error(`\nRestore failed: ${error.message}`);
    process.exitCode = 1;
});
