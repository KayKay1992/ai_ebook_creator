// Fills the new PurchaseRequest.itemTitle snapshot for purchase requests
// made before it existed. DRY RUN by default: prints exactly what it would
// change and writes nothing. Take a backup first (npm run backup).
//
// Usage (from backend/):
//   node scripts/backfill-purchase-titles.js                    dry run
//   node scripts/backfill-purchase-titles.js --apply            write the listed changes
//   node scripts/backfill-purchase-titles.js --set-title <purchaseRequestId> "The Real Title"
//        (repeatable) give a title by hand for a request whose book/bundle
//        was deleted, if you remember it; combine with --apply to write it.
//
// It only ever sets itemTitle, only where it is empty, and each write
// re-checks that it's still empty. Titles come from the book/bundle if it
// still exists (its current title). Requests whose item was deleted stay
// empty unless you give a title, and show as "Deleted book (title unknown)".
const { loadEnv, maskConsole } = require('./lib/cli');

loadEnv();
maskConsole([process.env.MONGO_URI]);

const mongoose = require('mongoose');
const { planTitleBackfill, applyTitleBackfill } = require('../utils/purchaseTitleBackfill');

// --set-title takes two values, so it's parsed by hand.
const parse = (argv) => {
    const options = { apply: false, manualTitles: {} };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--apply') options.apply = true;
        else if (argv[i] === '--dry-run') options.apply = false;
        else if (argv[i] === '--set-title') {
            const [id, title] = [argv[i + 1], argv[i + 2]];
            if (!id || !title || id.startsWith('--')) throw new Error('--set-title needs a purchase request id and a title.');
            options.manualTitles[id] = title;
            i += 2;
        } else throw new Error(`Unknown option: ${argv[i]}`);
    }
    return options;
};

const main = async () => {
    const options = parse(process.argv.slice(2));
    if (!process.env.MONGO_URI) throw new Error('MONGO_URI is not set in backend/.env.');
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });
    try {
        console.log(`Database "${mongoose.connection.db.databaseName}". ${options.apply ? 'APPLYING changes.' : 'Dry run: nothing will be written.'}\n`);
        const { changes, unknown, ignored } = await planTitleBackfill({ manualTitles: options.manualTitles });

        if (!changes.length && !unknown.length) {
            console.log('Every purchase request already has a title snapshot. Nothing to do.');
            return;
        }
        console.log(`Will set itemTitle on ${changes.length} purchase request${changes.length === 1 ? '' : 's'}:`);
        for (const c of changes) console.log(`  ${c.id}  ${c.itemType.padEnd(6)} → "${c.title}"  (${c.source})`);
        if (unknown.length) {
            console.log(`\nLeft empty (the ${unknown.length === 1 ? 'item was' : 'items were'} deleted; shown as "Deleted … (title unknown)"):`);
            for (const u of unknown) console.log(`  ${u.id}  ${u.itemType.padEnd(6)} item ${u.item}   → add: --set-title ${u.id} "Title"`);
        }
        if (ignored.length) console.log(`\nIgnored --set-title for ${ignored.join(', ')}: not a purchase request with an empty title.`);

        if (!options.apply) {
            console.log('\nDry run: nothing was written. Re-run with --apply to write the changes above.');
            return;
        }
        const written = await applyTitleBackfill(changes);
        console.log(`\nDone: wrote itemTitle on ${written} purchase request${written === 1 ? '' : 's'}. Nothing else was changed.`);
    } finally {
        await mongoose.disconnect();
    }
};

main().catch((error) => {
    console.error(`\nFailed: ${error.message}`);
    process.exitCode = 1;
});
