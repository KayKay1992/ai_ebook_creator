const request = require('supertest');
const app = require('../app');
const db = require('./dbHandler');
const User = require('../models/User');
const Rating = require('../models/Rating');
const ReaderProgress = require('../models/ReaderProgress');
const ReferralReward = require('../models/ReferralReward');
const { createUser, tokenFor, createBook, createPurchaseRequest } = require('./helpers');

beforeAll(async () => db.connect());
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

const deleteUserAs = (admin, targetId) =>
    request(app).delete(`/api/admin/users/${targetId}`).set('Authorization', `Bearer ${tokenFor(admin)}`);

describe('DELETE /api/admin/users/:id — access control', () => {
    it('rejects a non-admin reader', async () => {
        const reader = await createUser({ role: 'reader' });
        const target = await createUser({ role: 'reader' });
        const res = await deleteUserAs(reader, target._id);
        expect(res.status).toBe(403);
    });

    it('rejects an unauthenticated request', async () => {
        const target = await createUser({ role: 'reader' });
        const res = await request(app).delete(`/api/admin/users/${target._id}`);
        expect(res.status).toBe(401);
    });

    it('404s for a nonexistent user id', async () => {
        const admin = await createUser({ role: 'admin' });
        const fakeId = new (require('mongoose').Types.ObjectId)();
        const res = await deleteUserAs(admin, fakeId);
        expect(res.status).toBe(404);
    });

    it('refuses to delete an admin account', async () => {
        const admin = await createUser({ role: 'admin' });
        const otherAdmin = await createUser({ role: 'admin' });
        const res = await deleteUserAs(admin, otherAdmin._id);
        expect(res.status).toBe(400);
        expect(await User.findById(otherAdmin._id)).not.toBeNull();
    });
});

describe('DELETE /api/admin/users/:id — hard delete (no history)', () => {
    it('permanently removes a reader with zero purchase/referral history', async () => {
        const admin = await createUser({ role: 'admin' });
        const target = await createUser({ role: 'reader' });

        const res = await deleteUserAs(admin, target._id);
        expect(res.status).toBe(200);
        expect(res.body.action).toBe('hard-deleted');
        expect(await User.findById(target._id)).toBeNull();
    });
});

describe('DELETE /api/admin/users/:id — anonymize (has history)', () => {
    it('anonymizes rather than deletes a reader with an approved purchase, preserving the PurchaseRequest', async () => {
        const admin = await createUser({ role: 'admin' });
        const target = await createUser({ role: 'reader', name: 'Real Name', email: 'real@example.com' });
        const book = await createBook({ price: 1000 });
        const pr = await createPurchaseRequest({ reader: target, itemType: 'book', item: book._id, status: 'approved', amount: 1000 });

        const res = await deleteUserAs(admin, target._id);
        expect(res.status).toBe(200);
        expect(res.body.action).toBe('anonymized');

        const anonymized = await User.findById(target._id).select('+password +resetPasswordToken');
        expect(anonymized).not.toBeNull();
        expect(anonymized.name).toBe('Deleted User');
        expect(anonymized.email).not.toBe('real@example.com');
        expect(anonymized.isDeleted).toBe(true);
        expect(anonymized.deletedAt).toBeTruthy();

        // The transaction record itself is untouched.
        const requests = await require('../models/PurchaseRequest').find({ reader: target._id });
        expect(requests).toHaveLength(1);
        expect(requests[0]._id.toString()).toBe(pr._id.toString());
    });

    it('anonymizes a reader who has zero purchases of their own but IS a referrer on an existing ReferralReward (referential integrity)', async () => {
        const admin = await createUser({ role: 'admin' });
        const referrer = await createUser({ role: 'reader' });
        const referredReader = await createUser({ role: 'reader' });
        await ReferralReward.create({
            referrer: referrer._id,
            referredReader: referredReader._id,
            triggeringPurchaseRequest: referredReader._id, // any ObjectId, not exercised here
            amount: 100,
        });

        const res = await deleteUserAs(admin, referrer._id);
        expect(res.status).toBe(200);
        expect(res.body.action).toBe('anonymized');

        // The reward record still resolves to a real (if anonymized) User —
        // never a dangling reference.
        const reward = await ReferralReward.findOne({ referrer: referrer._id }).populate('referrer', 'name isDeleted');
        expect(reward).not.toBeNull();
        expect(reward.referrer).not.toBeNull();
        expect(reward.referrer.isDeleted).toBe(true);
    });

    it('invalidates the account immediately — an already-issued token is rejected on the very next request', async () => {
        const admin = await createUser({ role: 'admin' });
        const target = await createUser({ role: 'reader' });
        const book = await createBook({ price: 1000 });
        await createPurchaseRequest({ reader: target, itemType: 'book', item: book._id, status: 'approved' });

        const staleToken = tokenFor(target); // minted before deletion, still cryptographically valid
        await deleteUserAs(admin, target._id);

        const res = await request(app).get('/api/purchases/mine').set('Authorization', `Bearer ${staleToken}`);
        expect(res.status).toBe(401);
    });

    it('clears any Rating/ReaderProgress reader-name lookups gracefully after anonymization', async () => {
        const admin = await createUser({ role: 'admin' });
        const target = await createUser({ role: 'reader' });
        const book = await createBook({ price: 1000 });
        await createPurchaseRequest({ reader: target, itemType: 'book', item: book._id, status: 'approved' });
        await Rating.create({ reader: target._id, book: book._id, stars: 5, review: 'Loved it.' });
        await ReaderProgress.create({ reader: target._id, book: book._id, lastChapterIndex: 1 });

        await deleteUserAs(admin, target._id);

        // Both documents survive the anonymization (only zero-history
        // accounts are ever hard-deleted, and this one has history).
        expect(await Rating.countDocuments({ reader: target._id })).toBe(1);
        expect(await ReaderProgress.countDocuments({ reader: target._id })).toBe(1);

        const ratingsRes = await request(app).get(`/api/kenlibs/ratings/${book._id}`);
        expect(ratingsRes.status).toBe(200);
        expect(ratingsRes.body.reviews[0].readerName).toBe('Deleted User');
    });
});
