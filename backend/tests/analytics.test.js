// Admin analytics (controller/analyticsController.js): cash vs gross
// revenue, approval-date bucketing in Lagos days with zero-fill, ranges and
// previous-period comparison, the test-data filter, readers including
// accounts with no role, conversion samples, top books/bundles with title
// snapshots, the status breakdown, the view funnel, referral credit, and the
// "needs attention" row.
jest.mock('../utils/sendEmail', () => ({
    ...jest.requireActual('../utils/sendEmail'),
    sendPurchaseRequestAdminEmail: jest.fn().mockResolvedValue(undefined),
    sendPurchaseDecisionEmail: jest.fn().mockResolvedValue(undefined),
}));

const request = require('supertest');
const app = require('../app');
const db = require('./dbHandler');
const User = require('../models/User');
const Book = require('../models/Book');
const PurchaseRequest = require('../models/PurchaseRequest');
const ReferralReward = require('../models/ReferralReward');
const BookViewDaily = require('../models/BookViewDaily');
const BookTranslation = require('../models/BookTranslation');
const ErrorLog = require('../models/ErrorLog');
const { lagosDay, addDays } = require('../utils/lagosTime');
const { createUser, tokenFor, createBook, createBundle, createPurchaseRequest } = require('./helpers');

beforeAll(async () => db.connect());
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

const auth = (user) => ({ Authorization: `Bearer ${tokenFor(user)}` });
const getAnalytics = (admin, query = {}) => request(app).get('/api/admin/analytics').query(query).set(auth(admin));
const today = () => lagosDay();
const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

// Set fields the models/helpers don't let us set directly (timestamps,
// approval dates) on the raw collection.
const setRaw = (Model, doc, fields) => Model.collection.updateOne({ _id: doc._id }, { $set: fields });

// An approved purchase approved at `approvedAt` (legacy shape: top-level
// reviewedAt, no history), created a little before that.
const approvedPurchase = async ({ reader, item, amount = 1000, itemType = 'book', approvedAt = new Date(), creditApplied = 0, itemTitle }) => {
    const pr = await createPurchaseRequest({ reader, itemType, item, amount, status: 'approved' });
    await setRaw(PurchaseRequest, pr, { reviewedAt: approvedAt, createdAt: new Date(approvedAt.getTime() - 60000), creditApplied, ...(itemTitle !== undefined ? { itemTitle } : {}) });
    return pr;
};

describe('access', () => {
    it('analytics and attention are admin-only', async () => {
        const reader = await createUser({ role: 'reader' });
        expect((await getAnalytics(reader)).status).toBe(403);
        expect((await request(app).get('/api/admin/analytics')).status).toBe(401);
        expect((await request(app).get('/api/admin/attention').set(auth(reader))).status).toBe(403);
    });

    it('rejects invalid ranges', async () => {
        const admin = await createUser({ role: 'admin' });
        expect((await getAnalytics(admin, { from: 'yesterday', to: today() })).status).toBe(400);
        expect((await getAnalytics(admin, { from: '2026-02-30', to: '2026-03-01' })).status).toBe(400);
        expect((await getAnalytics(admin, { from: today(), to: addDays(today(), -1) })).status).toBe(400);
    });
});

describe('revenue', () => {
    it('headline is cash received (amount − credit); gross and credit reported; approved only, revoked excluded', async () => {
        const admin = await createUser({ role: 'admin' });
        const reader = await createUser({ role: 'reader' });
        const book = await createBook({ price: 1000 });
        await approvedPurchase({ reader, item: book._id, amount: 1000 });
        await approvedPurchase({ reader, item: book._id, amount: 2000, creditApplied: 500 });
        await createPurchaseRequest({ reader, itemType: 'book', item: book._id, amount: 500, status: 'pending' });
        await createPurchaseRequest({ reader, itemType: 'book', item: book._id, amount: 700, status: 'rejected' });
        // Approved, then revoked through the real endpoints: not revenue.
        const toRevoke = await createPurchaseRequest({ reader, itemType: 'book', item: book._id, amount: 3000, status: 'pending' });
        await request(app).put(`/api/purchases/${toRevoke._id}/approve`).set(auth(admin));
        await request(app).put(`/api/purchases/${toRevoke._id}/revoke`).set(auth(admin));

        const { body } = await getAnalytics(admin);
        expect(body.kpis.cashRevenue.value).toBe(2500);
        expect(body.kpis.grossSales.value).toBe(3000);
        expect(body.kpis.creditApplied.value).toBe(500);
        expect(body.kpis.orders.value).toBe(2);
    });

    it('zero-fills every day of the range, bucketed by approval date in Lagos time', async () => {
        const admin = await createUser({ role: 'admin' });
        const reader = await createUser({ role: 'reader' });
        const book = await createBook({ price: 1500 });
        // 23:30 UTC is already the next day in Lagos (UTC+1).
        const lateUtc = new Date(Date.UTC(2026, 8, 10, 23, 30));
        await approvedPurchase({ reader, item: book._id, amount: 1500, approvedAt: lateUtc });

        const { body } = await getAnalytics(admin, { from: '2026-09-08', to: '2026-09-14' });
        expect(body.revenueSeries.map((d) => d.date)).toEqual(['2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14']);
        expect(body.revenueSeries.find((d) => d.date === '2026-09-11')).toEqual({ date: '2026-09-11', cash: 1500, gross: 1500, orders: 1 });
        expect(body.revenueSeries.filter((d) => d.cash === 0)).toHaveLength(6);
        expect(body.range).toMatchObject({ days: 7, previousFrom: '2026-09-01', previousTo: '2026-09-07', timezone: 'Africa/Lagos' });
    });

    it('uses the real approval date (reviewHistory) rather than createdAt', async () => {
        const admin = await createUser({ role: 'admin' });
        const reader = await createUser({ role: 'reader' });
        const book = await createBook({ price: 1500 });
        const pr = await createPurchaseRequest({ reader, itemType: 'book', item: book._id, amount: 1500, status: 'pending' });
        await setRaw(PurchaseRequest, pr, { createdAt: daysAgo(40) }); // asked for long ago, approved today
        await request(app).put(`/api/purchases/${pr._id}/approve`).set(auth(admin));

        const { body } = await getAnalytics(admin);
        expect(body.revenueSeries.find((d) => d.date === today()).cash).toBe(1500);
    });

    it('compares with the previous period of the same length', async () => {
        const admin = await createUser({ role: 'admin' });
        const reader = await createUser({ role: 'reader' });
        const book = await createBook({ price: 1000 });
        await approvedPurchase({ reader, item: book._id, amount: 1000, approvedAt: daysAgo(2) });
        await approvedPurchase({ reader, item: book._id, amount: 4000, approvedAt: daysAgo(10) }); // previous 7 days
        await approvedPurchase({ reader, item: book._id, amount: 9000, approvedAt: daysAgo(30) }); // outside both

        const { body } = await getAnalytics(admin, { from: addDays(today(), -6), to: today() });
        expect(body.kpis.cashRevenue).toEqual({ value: 1000, previous: 4000 });
        expect(body.kpis.orders).toEqual({ value: 1, previous: 1 });
        const all = await getAnalytics(admin, { range: 'all' });
        expect(all.body.kpis.cashRevenue.value).toBe(14000);
    });

    it('lists recent sales (newest first, at most 8) with their titles', async () => {
        const admin = await createUser({ role: 'admin' });
        const reader = await createUser({ role: 'reader' });
        const book = await createBook({ title: 'Recent Book', price: 1000 });
        for (let i = 0; i < 10; i++) await approvedPurchase({ reader, item: book._id, amount: 1000 + i, approvedAt: daysAgo(i / 10) });
        const { body } = await getAnalytics(admin);
        expect(body.recentSales).toHaveLength(8);
        expect(body.recentSales[0]).toMatchObject({ title: 'Recent Book', amount: 1000, cash: 1000, itemType: 'book', deleted: false });
        expect(body.recentSales.map((s) => new Date(s.approvedAt).getTime())).toEqual(
            [...body.recentSales.map((s) => new Date(s.approvedAt).getTime())].sort((a, b) => b - a)
        );
    });
});

describe('top books and bundles', () => {
    it('one ranking per item type, by cash, with orders and share of total; pending excluded', async () => {
        const admin = await createUser({ role: 'admin' });
        const reader = await createUser({ role: 'reader' });
        const bookA = await createBook({ title: 'Book A', price: 100 });
        const bookB = await createBook({ title: 'Book B', price: 5000 });
        for (let i = 0; i < 3; i++) await approvedPurchase({ reader, item: bookA._id, amount: 100 });
        await approvedPurchase({ reader, item: bookB._id, amount: 5000 });
        await createPurchaseRequest({ reader, itemType: 'book', item: bookB._id, amount: 5000, status: 'pending' });
        const bundle = await createBundle({ title: 'Wellness Bundle', price: 4700 });
        await approvedPurchase({ reader, item: bundle._id, itemType: 'bundle', amount: 4700 });

        const { body } = await getAnalytics(admin);
        expect(body.topBooks.map((b) => [b.title, b.orders, b.cash])).toEqual([
            ['Book B', 1, 5000],
            ['Book A', 3, 300],
        ]);
        expect(body.topBooks[0].sharePercent).toBe(50); // of all cash, bundles included
        expect(body.topBundles).toEqual([expect.objectContaining({ title: 'Wellness Bundle', orders: 1, cash: 4700, sharePercent: 47 })]);
    });

    it('names deleted items from the title snapshot, or says the title is unknown', async () => {
        const admin = await createUser({ role: 'admin' });
        const reader = await createUser({ role: 'reader' });
        const kept = await createBook({ title: 'Will Be Deleted' });
        const lost = await createBook({ title: 'Never Snapshotted' });
        await approvedPurchase({ reader, item: kept._id, amount: 2000, itemTitle: 'Will Be Deleted' });
        await approvedPurchase({ reader, item: lost._id, amount: 1000 });
        await Book.deleteMany({});

        const { body } = await getAnalytics(admin);
        expect(body.topBooks.map((b) => [b.title, b.deleted])).toEqual([
            ['Will Be Deleted', true],
            ['Deleted book (title unknown)', true],
        ]);
    });
});

describe('readers and conversion', () => {
    it('counts every non-admin account, including old ones with no role field', async () => {
        const admin = await createUser({ role: 'admin' });
        const buyer = await createUser({ role: 'reader' });
        await createUser({ role: 'reader' });
        // An older account: no `role` field at all in the database.
        await User.collection.insertOne({ name: 'Old Account', email: 'old@example.com', password: 'x', createdAt: daysAgo(100), updatedAt: daysAgo(100) });
        const book = await createBook({ price: 1000 });
        await approvedPurchase({ reader: buyer, item: book._id });

        const { body } = await getAnalytics(admin);
        expect(body.kpis.readers.total).toBe(3);
        expect(body.kpis.conversion).toMatchObject({ converted: 1, sample: 3, ratePercent: 33.3 });
        expect((await User.collection.findOne({ email: 'old@example.com' })).role).toBeUndefined(); // untouched
    });

    it('reports new readers and conversion for the previous period too', async () => {
        const admin = await createUser({ role: 'admin' });
        const early = await createUser({ role: 'reader' });
        await setRaw(User, early, { createdAt: daysAgo(16) }); // in the previous 10-day period
        const recent = await createUser({ role: 'reader' });
        const book = await createBook({ price: 1000 });
        await approvedPurchase({ reader: early, item: book._id, approvedAt: daysAgo(15) });

        const { body } = await getAnalytics(admin, { from: addDays(today(), -9), to: today() });
        expect(body.kpis.readers).toMatchObject({ total: 2, previousTotal: 1, newInRange: 1, newPrevious: 1 });
        expect(body.kpis.conversion).toMatchObject({ ratePercent: 50, sample: 2, previousRatePercent: 100, previousSample: 1 });
        expect(recent).toBeTruthy();
    });
});

describe('hide test data', () => {
    it('is off by default; when on, drops cheap purchases, admin and flagged test accounts', async () => {
        const admin = await createUser({ role: 'admin' });
        const reader = await createUser({ role: 'reader' });
        const tester = await createUser({ role: 'reader' });
        await User.updateOne({ _id: tester._id }, { $set: { isTestAccount: true } });
        const book = await createBook({ price: 5000, userId: admin._id });
        await approvedPurchase({ reader, item: book._id, amount: 5000 });
        await approvedPurchase({ reader, item: book._id, amount: 9.99 });
        await approvedPurchase({ reader: tester, item: book._id, amount: 5000 });
        await approvedPurchase({ reader: admin, item: book._id, amount: 5000 });

        const all = await getAnalytics(admin);
        expect(all.body.testData).toMatchObject({ hidden: false });
        expect(all.body.kpis.cashRevenue.value).toBe(15009.99);
        expect(all.body.kpis.readers.total).toBe(2);

        const hidden = await getAnalytics(admin, { hideTest: '1' });
        expect(hidden.body.testData).toMatchObject({ hidden: true, minPrice: 100, excludedAccounts: 2 });
        expect(hidden.body.kpis.cashRevenue.value).toBe(5000);
        expect(hidden.body.kpis.readers.total).toBe(1);
        expect(hidden.body.kpis.conversion).toMatchObject({ converted: 1, sample: 1 });

        const custom = await getAnalytics(admin, { hideTest: '1', minPrice: '6000' });
        expect(custom.body.kpis.cashRevenue.value).toBe(0);
    });
});

describe('status breakdown, funnel and referrals', () => {
    it('breaks down requests made in the range by status', async () => {
        const admin = await createUser({ role: 'admin' });
        const reader = await createUser({ role: 'reader' });
        const book = await createBook({ price: 1000 });
        await createPurchaseRequest({ reader, itemType: 'book', item: book._id, status: 'pending' });
        await createPurchaseRequest({ reader, itemType: 'book', item: book._id, status: 'approved' });
        await createPurchaseRequest({ reader, itemType: 'book', item: book._id, status: 'rejected' });
        const old = await createPurchaseRequest({ reader, itemType: 'book', item: book._id, status: 'rejected' });
        await setRaw(PurchaseRequest, old, { createdAt: daysAgo(90) });

        const { body } = await getAnalytics(admin);
        expect(body.statusBreakdown).toEqual({ pending: 1, approved: 1, rejected: 1, revoked: 0, total: 3 });
    });

    it('funnel: views (only since tracking started) → signups → requests → approved', async () => {
        const admin = await createUser({ role: 'admin' });
        const reader = await createUser({ role: 'reader' });
        const book = await createBook({ price: 1000 });
        await BookViewDaily.create([
            { book: book._id, day: addDays(today(), -2), views: 7 },
            { book: book._id, day: today(), views: 3 },
            { book: book._id, day: addDays(today(), -60), views: 100 },
        ]);
        await createPurchaseRequest({ reader, itemType: 'book', item: book._id, status: 'approved' });
        await createPurchaseRequest({ reader, itemType: 'book', item: book._id, status: 'pending' });

        const { body } = await getAnalytics(admin);
        expect(body.funnel).toEqual({
            trackingEnabled: true,
            trackingStartedOn: addDays(today(), -60),
            views: 10,
            signups: 1,
            requests: 2,
            approved: 1,
        });
    });

    it('referral credit granted in the range (vs previous) and outstanding now', async () => {
        const admin = await createUser({ role: 'admin' });
        const a = await createUser({ role: 'reader', creditBalance: 100 });
        const b = await createUser({ role: 'reader', creditBalance: 250 });
        const recent = await ReferralReward.create({ referrer: a._id, referredReader: b._id, triggeringPurchaseRequest: b._id, amount: 100 });
        const older = await ReferralReward.create({ referrer: b._id, referredReader: a._id, triggeringPurchaseRequest: a._id, amount: 250 });
        await setRaw(ReferralReward, older, { createdAt: daysAgo(40) });

        const { body } = await getAnalytics(admin);
        expect(body.kpis.referralCredit).toEqual({ grantedInRange: 100, grantedPrevious: 250, outstandingNow: 350, conversionsInRange: 1 });
        expect(recent).toBeTruthy();
    });
});

describe('needs attention', () => {
    it('counts pending requests (with the oldest), unresolved errors and failed or waiting jobs', async () => {
        const admin = await createUser({ role: 'admin' });
        const reader = await createUser({ role: 'reader' });
        const book = await createBook({ title: 'Needs Work', chapters: [{ title: 'One', content: 'x' }, { title: 'Two', content: 'y' }] });
        const oldest = await createPurchaseRequest({ reader, itemType: 'book', item: book._id, status: 'pending' });
        await setRaw(PurchaseRequest, oldest, { createdAt: daysAgo(3) });
        await createPurchaseRequest({ reader, itemType: 'book', item: book._id, status: 'pending' });
        await Book.updateOne(
            { _id: book._id },
            { $set: { 'audio.chapters': [{ chapterId: book.chapters[0]._id, status: 'failed' }, { chapterId: book.chapters[1]._id, status: 'waiting' }] } }
        );
        await BookTranslation.create({ bookId: book._id, language: 'yo', chapters: [{ chapterId: book.chapters[0]._id, jobStatus: 'failed' }] });
        const now = new Date();
        await ErrorLog.create({ fingerprint: 'f1', source: 'backend', message: 'x', count: 1, firstSeenAt: now, lastSeenAt: now, expiresAt: now });

        const res = await request(app).get('/api/admin/attention').set(auth(admin));
        expect(res.status).toBe(200);
        expect(res.body.pendingPurchases.count).toBe(2);
        expect(new Date(res.body.pendingPurchases.oldestCreatedAt).getTime()).toBeLessThan(daysAgo(2).getTime());
        expect(res.body.unresolvedErrors).toBe(1);
        expect(res.body.failedAudio).toEqual({ count: 2, books: [expect.objectContaining({ bookId: String(book._id), title: 'Needs Work', count: 2 })] });
        expect(res.body.failedTranslations).toMatchObject({ count: 1, books: [expect.objectContaining({ title: 'Needs Work', languages: ['yo'] })] });
    });
});

describe('admin Users page and test-account flag', () => {
    it('lists every non-admin account, including those with no role field', async () => {
        const admin = await createUser({ role: 'admin' });
        await createUser({ role: 'reader', email: 'normal@example.com' });
        await User.collection.insertOne({ name: 'Old Account', email: 'old-users@example.com', password: 'x', createdAt: new Date(), updatedAt: new Date() });
        const res = await request(app).get('/api/admin/users').set(auth(admin));
        expect(res.status).toBe(200);
        const emails = JSON.stringify(res.body);
        expect(emails).toContain('normal@example.com');
        expect(emails).toContain('old-users@example.com');
        expect(emails).not.toContain(admin.email);
    });

    it('admins can flag a reader as a test account (never an admin); readers cannot', async () => {
        const admin = await createUser({ role: 'admin' });
        const reader = await createUser({ role: 'reader' });
        const put = (user, id, body) => request(app).put(`/api/admin/users/${id}/test-account`).set(auth(user)).send(body);
        expect((await put(reader, reader._id, { isTestAccount: true })).status).toBe(403);
        expect((await put(admin, reader._id, { isTestAccount: 'yes' })).status).toBe(400);
        expect((await put(admin, admin._id, { isTestAccount: true })).status).toBe(404);
        const res = await put(admin, reader._id, { isTestAccount: true });
        expect(res.status).toBe(200);
        expect((await User.findById(reader._id)).isTestAccount).toBe(true);
    });
});
