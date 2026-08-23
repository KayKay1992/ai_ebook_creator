jest.mock('../utils/cloudinaryUpload', () => ({
    uploadBufferToCloudinary: jest.fn().mockResolvedValue({
        secure_url: 'https://res.cloudinary.com/fake/image/upload/mock-analytics-evidence.png',
    }),
}));

const request = require('supertest');
const app = require('../app');
const db = require('./dbHandler');
const ReferralReward = require('../models/ReferralReward');
const { createUser, tokenFor, createBook, createBundle, createPurchaseRequest } = require('./helpers');

beforeAll(async () => db.connect());
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

const getAnalytics = (admin) =>
    request(app).get('/api/admin/analytics').set('Authorization', `Bearer ${tokenFor(admin)}`);

describe('GET /api/admin/analytics — access control', () => {
    it('rejects a non-admin reader', async () => {
        const reader = await createUser({ role: 'reader' });
        const res = await getAnalytics(reader);
        expect(res.status).toBe(403);
    });

    it('rejects an unauthenticated request', async () => {
        const res = await request(app).get('/api/admin/analytics');
        expect(res.status).toBe(401);
    });
});

describe('GET /api/admin/analytics — revenue', () => {
    it('sums amount across approved requests only, excluding pending/rejected/revoked', async () => {
        const admin = await createUser({ role: 'admin' });
        const reader = await createUser({ role: 'reader' });
        const book = await createBook({ price: 1000 });

        await createPurchaseRequest({ reader, itemType: 'book', item: book._id, amount: 1000, status: 'approved' });
        await createPurchaseRequest({ reader, itemType: 'book', item: book._id, amount: 2000, status: 'approved' });
        await createPurchaseRequest({ reader, itemType: 'book', item: book._id, amount: 500, status: 'pending' });
        await createPurchaseRequest({ reader, itemType: 'book', item: book._id, amount: 700, status: 'rejected' });

        // Confirmed decision: a revoked purchase does NOT count as revenue,
        // even though it was genuinely approved/paid at some point — reach
        // 'revoked' via the real approve → revoke transition so this is a
        // realistic revoked record, not a fabricated one.
        const toRevoke = await createPurchaseRequest({
            reader,
            itemType: 'book',
            item: book._id,
            amount: 3000,
            status: 'pending',
        });
        await request(app).put(`/api/purchases/${toRevoke._id}/approve`).set('Authorization', `Bearer ${tokenFor(admin)}`);
        await request(app).put(`/api/purchases/${toRevoke._id}/revoke`).set('Authorization', `Bearer ${tokenFor(admin)}`);

        const res = await getAnalytics(admin);
        expect(res.status).toBe(200);
        // 1000 + 2000 (approved) = 3000. pending (500), rejected (700), and
        // the revoked 3000 (excluded even though it was once approved) all
        // left out.
        expect(res.body.revenue.total).toBe(3000);
    });

    it('returns 0 total revenue when nothing has ever been approved', async () => {
        const admin = await createUser({ role: 'admin' });
        const reader = await createUser({ role: 'reader' });
        const book = await createBook({ price: 1000 });
        await createPurchaseRequest({ reader, itemType: 'book', item: book._id, amount: 1000, status: 'pending' });
        await createPurchaseRequest({ reader, itemType: 'book', item: book._id, amount: 1000, status: 'rejected' });

        const res = await getAnalytics(admin);
        expect(res.body.revenue.total).toBe(0);
    });

    it('buckets revenue-over-time by the real approval date, not createdAt', async () => {
        const admin = await createUser({ role: 'admin' });
        const reader = await createUser({ role: 'reader' });
        const book = await createBook({ price: 1500 });
        const pr = await createPurchaseRequest({ reader, itemType: 'book', item: book._id, amount: 1500, status: 'pending' });

        const approveRes = await request(app)
            .put(`/api/purchases/${pr._id}/approve`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`);
        const approvedDate = new Date(approveRes.body.reviewedAt).toISOString().slice(0, 10);

        const res = await getAnalytics(admin);
        const bucket = res.body.revenue.overTime.find((d) => d.date === approvedDate);
        expect(bucket).toBeTruthy();
        expect(bucket.revenue).toBe(1500);
        expect(bucket.count).toBe(1);
    });

    it('falls back to top-level reviewedAt for a currently-approved record with no reviewHistory entry (legacy data)', async () => {
        // createPurchaseRequest() bypasses the real approve endpoint — for
        // status: 'approved' it sets top-level reviewedAt but leaves
        // reviewHistory empty, exactly matching real records found in
        // production that predate reviewHistory tracking.
        const admin = await createUser({ role: 'admin' });
        const reader = await createUser({ role: 'reader' });
        const book = await createBook({ price: 750 });
        const legacyApproved = await createPurchaseRequest({
            reader,
            itemType: 'book',
            item: book._id,
            amount: 750,
            status: 'approved',
        });
        expect(legacyApproved.reviewHistory).toHaveLength(0);

        const expectedDate = legacyApproved.reviewedAt.toISOString().slice(0, 10);
        const res = await getAnalytics(admin);
        const bucket = res.body.revenue.overTime.find((d) => d.date === expectedDate);
        expect(bucket).toBeTruthy();
        expect(bucket.revenue).toBeGreaterThanOrEqual(750);
    });

    it('excludes a revoked record from both the trend and the total, regardless of reviewHistory', async () => {
        const admin = await createUser({ role: 'admin' });
        const reader = await createUser({ role: 'reader' });
        const book = await createBook({ price: 900 });
        // status: 'revoked' directly (no reviewHistory) — confirms the
        // exclusion holds even for a record with no history to fall back
        // to, not just ones that went through the real approve → revoke
        // flow.
        await createPurchaseRequest({
            reader,
            itemType: 'book',
            item: book._id,
            amount: 900,
            status: 'revoked',
        });

        const res = await getAnalytics(admin);
        const totalBucketedRevenue = res.body.revenue.overTime.reduce((sum, d) => sum + d.revenue, 0);
        expect(totalBucketedRevenue).toBe(0);
        expect(res.body.revenue.total).toBe(0);
    });
});

describe('GET /api/admin/analytics — top books', () => {
    it('orders top books by purchase count and by revenue correctly', async () => {
        const admin = await createUser({ role: 'admin' });
        const reader = await createUser({ role: 'reader' });

        // Book A: 3 cheap purchases (highest count, modest revenue).
        const bookA = await createBook({ title: 'Book A', price: 100 });
        for (let i = 0; i < 3; i++) {
            await createPurchaseRequest({ reader, itemType: 'book', item: bookA._id, amount: 100, status: 'approved' });
        }

        // Book B: 1 expensive purchase (lowest count, highest revenue).
        const bookB = await createBook({ title: 'Book B', price: 5000 });
        await createPurchaseRequest({ reader, itemType: 'book', item: bookB._id, amount: 5000, status: 'approved' });

        // Book C: 2 mid purchases.
        const bookC = await createBook({ title: 'Book C', price: 800 });
        for (let i = 0; i < 2; i++) {
            await createPurchaseRequest({ reader, itemType: 'book', item: bookC._id, amount: 800, status: 'approved' });
        }

        const res = await getAnalytics(admin);
        const { byPurchaseCount, byRevenue } = res.body.topBooks;

        expect(byPurchaseCount.map((b) => b.title)).toEqual(['Book A', 'Book C', 'Book B']);
        expect(byPurchaseCount[0].purchaseCount).toBe(3);

        expect(byRevenue.map((b) => b.title)).toEqual(['Book B', 'Book C', 'Book A']);
        expect(byRevenue[0].revenue).toBe(5000);
    });

    it('excludes pending/rejected book purchases from the rankings', async () => {
        const admin = await createUser({ role: 'admin' });
        const reader = await createUser({ role: 'reader' });
        const book = await createBook({ title: 'Only Pending', price: 1000 });
        await createPurchaseRequest({ reader, itemType: 'book', item: book._id, amount: 1000, status: 'pending' });

        const res = await getAnalytics(admin);
        expect(res.body.topBooks.byPurchaseCount).toHaveLength(0);
        expect(res.body.topBooks.byRevenue).toHaveLength(0);
    });

    it('excludes bundle purchases from book rankings, reporting them as their own topBundles entries instead', async () => {
        const admin = await createUser({ role: 'admin' });
        const reader = await createUser({ role: 'reader' });
        const bookInBundle = await createBook({ title: 'Bundled Book' });
        const bundle = await createBundle({ title: 'Financial Wellness Bundle', books: [bookInBundle._id], price: 4000 });
        await createPurchaseRequest({ reader, itemType: 'bundle', item: bundle._id, amount: 4000, status: 'approved' });

        const res = await getAnalytics(admin);
        expect(res.body.topBooks.byPurchaseCount).toHaveLength(0);
        expect(res.body.topBooks.byRevenue).toHaveLength(0);

        expect(res.body.topBundles).toHaveLength(1);
        expect(res.body.topBundles[0]).toMatchObject({
            bundleId: bundle._id.toString(),
            title: 'Financial Wellness Bundle',
            purchaseCount: 1,
            revenue: 4000,
        });

        // Bundle revenue still counts toward the overall total.
        expect(res.body.revenue.total).toBe(4000);
    });

    it('orders topBundles by revenue and excludes non-approved bundle purchases', async () => {
        const admin = await createUser({ role: 'admin' });
        const reader = await createUser({ role: 'reader' });

        const bundleA = await createBundle({ title: 'Bundle A', price: 1000 });
        await createPurchaseRequest({ reader, itemType: 'bundle', item: bundleA._id, amount: 1000, status: 'approved' });

        const bundleB = await createBundle({ title: 'Bundle B', price: 6000 });
        await createPurchaseRequest({ reader, itemType: 'bundle', item: bundleB._id, amount: 6000, status: 'approved' });

        const bundleC = await createBundle({ title: 'Bundle C (still pending)', price: 9000 });
        await createPurchaseRequest({ reader, itemType: 'bundle', item: bundleC._id, amount: 9000, status: 'pending' });

        const res = await getAnalytics(admin);
        expect(res.body.topBundles.map((b) => b.title)).toEqual(['Bundle B', 'Bundle A']);
    });
});

describe('GET /api/admin/analytics — funnel and readers', () => {
    it('reports the funnel counts and published-book total correctly', async () => {
        const admin = await createUser({ role: 'admin' });
        const reader = await createUser({ role: 'reader' });
        await createBook({ status: 'published' });
        await createBook({ status: 'published' });
        await createBook({ status: 'draft' });

        const book = await createBook({ status: 'published', price: 1000 });
        await createPurchaseRequest({ reader, itemType: 'book', item: book._id, status: 'pending' });
        await createPurchaseRequest({ reader, itemType: 'book', item: book._id, status: 'approved' });
        await createPurchaseRequest({ reader, itemType: 'book', item: book._id, status: 'rejected' });

        const res = await getAnalytics(admin);
        expect(res.body.funnel.totalPublishedBooks).toBe(3); // the two above + `book` itself
        expect(res.body.funnel.totalPurchaseRequests).toBe(3);
        expect(res.body.funnel.pending).toBe(1);
        expect(res.body.funnel.approved).toBe(1);
        expect(res.body.funnel.rejected).toBe(1);
        expect(res.body.funnel.revoked).toBe(0);
    });

    it('splits readers into converted vs. browsing-only correctly', async () => {
        const admin = await createUser({ role: 'admin' });
        const converted = await createUser({ role: 'reader' });
        await createUser({ role: 'reader' }); // never purchased anything
        const book = await createBook({ price: 1000 });
        await createPurchaseRequest({ reader: converted, itemType: 'book', item: book._id, status: 'approved' });

        const res = await getAnalytics(admin);
        expect(res.body.readers.total).toBe(2);
        expect(res.body.readers.converted).toBe(1);
        expect(res.body.readers.conversionRatePercent).toBe(50);
    });
});

describe('GET /api/admin/analytics — referral stats', () => {
    it('sums outstanding credit across all users correctly', async () => {
        const admin = await createUser({ role: 'admin' });
        await createUser({ role: 'reader', creditBalance: 100 });
        await createUser({ role: 'reader', creditBalance: 250 });
        await createUser({ role: 'reader', creditBalance: 0 });

        const res = await getAnalytics(admin);
        expect(res.body.referrals.totalCreditOutstanding).toBe(350);
    });

    it('reports total credit ever granted and total referral conversions from ReferralReward records', async () => {
        const admin = await createUser({ role: 'admin' });
        const referrerA = await createUser({ role: 'reader' });
        const referrerB = await createUser({ role: 'reader' });
        const readerX = await createUser({ role: 'reader' });
        const readerY = await createUser({ role: 'reader' });

        await ReferralReward.create({
            referrer: referrerA._id,
            referredReader: readerX._id,
            triggeringPurchaseRequest: readerX._id, // any ObjectId — not exercised here
            amount: 100,
        });
        await ReferralReward.create({
            referrer: referrerB._id,
            referredReader: readerY._id,
            triggeringPurchaseRequest: readerY._id,
            amount: 250,
        });

        const res = await getAnalytics(admin);
        expect(res.body.referrals.totalCreditGranted).toBe(350);
        expect(res.body.referrals.totalConversions).toBe(2);
    });
});
