// Purchase title snapshots: new requests store the title; lists fall back
// to the snapshot when the item is deleted, else say "title unknown"; the
// backfill (scripts/backfill-purchase-titles.js) only fills empty titles,
// is a dry run by default, and prints exactly what it changes.
jest.mock('../utils/sendEmail', () => ({
    ...jest.requireActual('../utils/sendEmail'),
    sendPurchaseRequestAdminEmail: jest.fn().mockResolvedValue(undefined),
    sendPurchaseDecisionEmail: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../utils/cloudinaryUpload', () => ({
    uploadBufferToCloudinary: jest.fn().mockResolvedValue({ secure_url: 'https://res.cloudinary.com/fake/image/upload/evidence.png' }),
}));

const path = require('path');
const { spawnSync } = require('child_process');
const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../app');
const db = require('./dbHandler');
const Book = require('../models/Book');
const Bundle = require('../models/Bundle');
const PurchaseRequest = require('../models/PurchaseRequest');
const { planTitleBackfill, applyTitleBackfill } = require('../utils/purchaseTitleBackfill');
const { createUser, tokenFor, createBook, createBundle, createPurchaseRequest } = require('./helpers');

const auth = (user) => ({ Authorization: `Bearer ${tokenFor(user)}` });
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

beforeAll(async () => db.connect());
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

describe('snapshots on new purchase requests', () => {
    it('stores the title, and lists show it after the book is deleted', async () => {
        const reader = await createUser({ role: 'reader' });
        const book = await createBook({ title: 'Snapshot Me', status: 'published', price: 1500 });
        const created = await request(app)
            .post('/api/purchases')
            .set(auth(reader))
            .field('itemType', 'book')
            .field('item', String(book._id))
            .attach('evidenceImage', PNG, { filename: 'evidence.png', contentType: 'image/png' });
        expect(created.status).toBe(201);
        expect((await PurchaseRequest.findOne().lean()).itemTitle).toBe('Snapshot Me');

        await Book.deleteMany({});
        const mine = await request(app).get('/api/purchases/mine').set(auth(reader));
        const list = Array.isArray(mine.body) ? mine.body : mine.body.requests || [];
        expect(list[0]).toMatchObject({ itemTitle: 'Snapshot Me', itemDeleted: true });
    });

    it('a deleted item without a snapshot is "Deleted book/bundle (title unknown)"', async () => {
        const admin = await createUser({ role: 'admin' });
        const reader = await createUser({ role: 'reader' });
        const book = await createBook({ userId: admin._id });
        const bundle = await createBundle({ title: 'Gone Bundle' });
        await createPurchaseRequest({ reader, itemType: 'book', item: book._id });
        await createPurchaseRequest({ reader, itemType: 'bundle', item: bundle._id });
        await Book.deleteMany({});
        await Bundle.deleteMany({});
        const res = await request(app).get('/api/purchases').set(auth(admin));
        const list = Array.isArray(res.body) ? res.body : res.body.requests || res.body.purchaseRequests || [];
        expect(list.map((r) => r.itemTitle).sort()).toEqual(['Deleted book (title unknown)', 'Deleted bundle (title unknown)']);
    });
});

describe('title backfill', () => {
    const seed = async () => {
        const reader = await createUser({ role: 'reader' });
        const book = await createBook({ title: 'Still Here' });
        const bundle = await createBundle({ title: 'Bundle Here' });
        const gone = await createBook({ title: 'Gone' });
        const withBook = await createPurchaseRequest({ reader, itemType: 'book', item: book._id });
        const withBundle = await createPurchaseRequest({ reader, itemType: 'bundle', item: bundle._id });
        const withGone = await createPurchaseRequest({ reader, itemType: 'book', item: gone._id });
        const already = await createPurchaseRequest({ reader, itemType: 'book', item: book._id });
        await PurchaseRequest.collection.updateOne({ _id: already._id }, { $set: { itemTitle: 'Kept As Is' } });
        // An old document with no itemTitle field at all.
        await PurchaseRequest.collection.updateOne({ _id: withBundle._id }, { $unset: { itemTitle: '' } });
        await Book.deleteOne({ _id: gone._id });
        return { withBook, withBundle, withGone, already };
    };

    it('plans titles from items that still exist; deleted ones stay unknown unless given by hand', async () => {
        const { withBook, withBundle, withGone } = await seed();
        const plan = await planTitleBackfill();
        expect(plan.changes.map((c) => [c.id, c.title, c.source]).sort()).toEqual(
            [
                [String(withBook._id), 'Still Here', 'current item'],
                [String(withBundle._id), 'Bundle Here', 'current item'],
            ].sort()
        );
        expect(plan.unknown).toEqual([expect.objectContaining({ id: String(withGone._id), itemType: 'book' })]);

        const manual = await planTitleBackfill({ manualTitles: { [String(withGone._id)]: 'The Real Title', '64b000000000000000000000': 'x' } });
        expect(manual.changes.find((c) => c.id === String(withGone._id))).toMatchObject({ title: 'The Real Title', source: 'given by hand' });
        expect(manual.unknown).toEqual([]);
        expect(manual.ignored).toEqual(['64b000000000000000000000']);
    });

    it('applying only fills empty titles and never overwrites one set meanwhile', async () => {
        const { withBook, withBundle, already } = await seed();
        const plan = await planTitleBackfill();
        // Someone fills one between planning and applying.
        await PurchaseRequest.collection.updateOne({ _id: withBook._id }, { $set: { itemTitle: 'Filled Meanwhile' } });
        const before = await PurchaseRequest.find().lean();
        const written = await applyTitleBackfill(plan.changes);
        expect(written).toBe(1);
        const byId = new Map((await PurchaseRequest.find().lean()).map((r) => [String(r._id), r]));
        expect(byId.get(String(withBook._id)).itemTitle).toBe('Filled Meanwhile');
        expect(byId.get(String(withBundle._id)).itemTitle).toBe('Bundle Here');
        expect(byId.get(String(already._id)).itemTitle).toBe('Kept As Is');
        // Nothing but itemTitle changed on any document.
        for (const original of before) {
            const now = byId.get(String(original._id));
            const { itemTitle: a, ...restBefore } = original;
            const { itemTitle: b, ...restAfter } = now;
            expect(restAfter).toEqual(restBefore);
            expect(a === undefined || a === '' || a === b).toBe(true);
        }
    });

    it('the script is a dry run by default and writes only with --apply', async () => {
        const { withBundle } = await seed();
        const uri = `mongodb://${mongoose.connection.getClient().options.hosts.map((h) => `${h.host}:${h.port}`).join(',')}/${mongoose.connection.db.databaseName}`;
        const run = (...args) =>
            spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'backfill-purchase-titles.js'), ...args], {
                env: { ...process.env, MONGO_URI: uri },
                encoding: 'utf8',
                timeout: 60000,
            });

        const dry = run();
        expect(dry.status).toBe(0);
        expect(dry.stdout).toMatch(/Dry run: nothing will be written/);
        expect(dry.stdout).toContain(`${withBundle._id}  bundle → "Bundle Here"  (current item)`);
        expect(dry.stdout).toMatch(/Left empty[\s\S]*--set-title/);
        expect(dry.stdout).not.toContain(uri);
        expect((await PurchaseRequest.findById(withBundle._id).lean()).itemTitle).toBeUndefined();

        const applied = run('--apply');
        expect(applied.status).toBe(0);
        expect(applied.stdout).toMatch(/Done: wrote itemTitle on 2 purchase requests\. Nothing else was changed\./);
        expect((await PurchaseRequest.findById(withBundle._id).lean()).itemTitle).toBe('Bundle Here');
        expect(run('--set-title').status).toBe(1);
    });
});
