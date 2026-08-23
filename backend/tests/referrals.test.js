jest.mock('../utils/cloudinaryUpload', () => ({
    uploadBufferToCloudinary: jest.fn().mockResolvedValue({
        secure_url: 'https://res.cloudinary.com/fake/image/upload/mock-referral-evidence.png',
    }),
}));

const request = require('supertest');
const app = require('../app');
const db = require('./dbHandler');
const User = require('../models/User');
const PurchaseRequest = require('../models/PurchaseRequest');
const ReferralReward = require('../models/ReferralReward');
const { createUser, tokenFor, createBook, createPurchaseRequest } = require('./helpers');

beforeAll(async () => db.connect());
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

const attachEvidence = (req) =>
    req.attach('evidenceImage', Buffer.from('fake-image-bytes'), 'evidence.png');

describe('POST /api/auth/register — referral capture', () => {
    it('sets referredBy when a valid ?ref=CODE is provided', async () => {
        const referrer = await createUser({ role: 'reader', referralCode: 'GIFTER1' });

        const res = await request(app)
            .post('/api/auth/register?ref=GIFTER1')
            .send({ name: 'New Reader', email: 'new-reader@example.com', password: 'password123' });

        expect(res.status).toBe(201);

        const created = await User.findOne({ email: 'new-reader@example.com' });
        expect(created.referredBy.toString()).toBe(referrer._id.toString());
        expect(created.referralCode).toBeTruthy();
    });

    it('silently ignores an invalid/unknown referral code rather than failing signup', async () => {
        const res = await request(app)
            .post('/api/auth/register?ref=DOES-NOT-EXIST')
            .send({ name: 'Another Reader', email: 'another-reader@example.com', password: 'password123' });

        expect(res.status).toBe(201);

        const created = await User.findOne({ email: 'another-reader@example.com' });
        expect(created.referredBy).toBeNull();
    });

    it('gives every new reader their own unique referral code, even with no ref param', async () => {
        await request(app)
            .post('/api/auth/register')
            .send({ name: 'Plain Signup', email: 'plain-signup@example.com', password: 'password123' });

        const created = await User.findOne({ email: 'plain-signup@example.com' });
        expect(created.referralCode).toBeTruthy();

        const collision = await User.exists({ referralCode: created.referralCode, _id: { $ne: created._id } });
        expect(collision).toBeFalsy();
    });
});

describe('Referral reward on purchase approval', () => {
    it("grants the referrer 5% of the referred reader's first approved purchase, recorded as a ReferralReward", async () => {
        const admin = await createUser({ role: 'admin' });
        const referrer = await createUser({ role: 'reader', referralCode: 'REF001' });
        const referred = await createUser({ role: 'reader', referredBy: referrer._id });
        const book = await createBook({ price: 2000 });
        const pr = await createPurchaseRequest({
            reader: referred,
            itemType: 'book',
            item: book._id,
            amount: 2000,
            status: 'pending',
        });

        const res = await request(app)
            .put(`/api/purchases/${pr._id}/approve`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`);

        expect(res.status).toBe(200);

        const updatedReferrer = await User.findById(referrer._id);
        expect(updatedReferrer.creditBalance).toBe(100); // 5% of 2000

        const rewards = await ReferralReward.find({ referredReader: referred._id });
        expect(rewards).toHaveLength(1);
        expect(rewards[0].referrer.toString()).toBe(referrer._id.toString());
        expect(rewards[0].triggeringPurchaseRequest.toString()).toBe(pr._id.toString());
        expect(rewards[0].amount).toBe(100);
    });

    it("does not grant an additional reward for a referred reader's second approved purchase", async () => {
        const admin = await createUser({ role: 'admin' });
        const referrer = await createUser({ role: 'reader', referralCode: 'REF002' });
        const referred = await createUser({ role: 'reader', referredBy: referrer._id });
        const bookA = await createBook({ price: 1000 });
        const bookB = await createBook({ price: 3000 });

        const prA = await createPurchaseRequest({
            reader: referred,
            itemType: 'book',
            item: bookA._id,
            amount: 1000,
            status: 'pending',
        });
        await request(app)
            .put(`/api/purchases/${prA._id}/approve`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`);

        const balanceAfterFirst = (await User.findById(referrer._id)).creditBalance;
        expect(balanceAfterFirst).toBe(50); // 5% of 1000

        const prB = await createPurchaseRequest({
            reader: referred,
            itemType: 'book',
            item: bookB._id,
            amount: 3000,
            status: 'pending',
        });
        const res = await request(app)
            .put(`/api/purchases/${prB._id}/approve`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`);

        expect(res.status).toBe(200);

        const balanceAfterSecond = (await User.findById(referrer._id)).creditBalance;
        expect(balanceAfterSecond).toBe(balanceAfterFirst);

        const rewardCount = await ReferralReward.countDocuments({ referredReader: referred._id });
        expect(rewardCount).toBe(1);
    });

    it('grants no reward when the approved reader has no referrer', async () => {
        const admin = await createUser({ role: 'admin' });
        const reader = await createUser({ role: 'reader' }); // referredBy null
        const book = await createBook({ price: 1000 });
        const pr = await createPurchaseRequest({
            reader,
            itemType: 'book',
            item: book._id,
            amount: 1000,
            status: 'pending',
        });

        const res = await request(app)
            .put(`/api/purchases/${pr._id}/approve`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`);

        expect(res.status).toBe(200);
        expect(await ReferralReward.countDocuments({})).toBe(0);
    });

    it('grants no reward on a rejection — only approval triggers it', async () => {
        const admin = await createUser({ role: 'admin' });
        const referrer = await createUser({ role: 'reader', referralCode: 'REF003' });
        const referred = await createUser({ role: 'reader', referredBy: referrer._id });
        const book = await createBook({ price: 1000 });
        const pr = await createPurchaseRequest({
            reader: referred,
            itemType: 'book',
            item: book._id,
            amount: 1000,
            status: 'pending',
        });

        await request(app)
            .put(`/api/purchases/${pr._id}/reject`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`);

        expect(await ReferralReward.countDocuments({})).toBe(0);
        expect((await User.findById(referrer._id)).creditBalance).toBe(0);
    });
});

describe('Store credit application at checkout', () => {
    it("caps applied credit at the reader's actual balance, deducting it immediately", async () => {
        const reader = await createUser({ role: 'reader', creditBalance: 100 });
        const book = await createBook({ price: 1500 });

        const req = request(app)
            .post('/api/purchases')
            .set('Authorization', `Bearer ${tokenFor(reader)}`)
            .field('itemType', 'book')
            .field('item', book._id.toString())
            .field('creditApplied', '500'); // more than the reader actually has
        const res = await attachEvidence(req);

        expect(res.status).toBe(201);
        expect(res.body.creditApplied).toBe(100);
        expect(res.body.amount).toBe(1500); // amount stays the full snapshot price

        const updatedReader = await User.findById(reader._id);
        expect(updatedReader.creditBalance).toBe(0);
    });

    it("caps applied credit at the item's price, never granting a refund beyond it", async () => {
        const reader = await createUser({ role: 'reader', creditBalance: 5000 });
        const book = await createBook({ price: 1000 });

        const req = request(app)
            .post('/api/purchases')
            .set('Authorization', `Bearer ${tokenFor(reader)}`)
            .field('itemType', 'book')
            .field('item', book._id.toString())
            .field('creditApplied', '5000');
        const res = await attachEvidence(req);

        expect(res.status).toBe(201);
        expect(res.body.creditApplied).toBe(1000);

        const updatedReader = await User.findById(reader._id);
        expect(updatedReader.creditBalance).toBe(4000);
    });

    it('deducts applied credit at creation time regardless of the request later being rejected', async () => {
        const admin = await createUser({ role: 'admin' });
        const reader = await createUser({ role: 'reader', creditBalance: 1000 });
        const book = await createBook({ price: 1500 });

        const req = request(app)
            .post('/api/purchases')
            .set('Authorization', `Bearer ${tokenFor(reader)}`)
            .field('itemType', 'book')
            .field('item', book._id.toString())
            .field('creditApplied', '500');
        const created = await attachEvidence(req);
        expect(created.body.creditApplied).toBe(500);
        expect((await User.findById(reader._id)).creditBalance).toBe(500);

        await request(app)
            .put(`/api/purchases/${created.body._id}/reject`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`);

        // Spent regardless of the outcome — same as a coupon, not refunded
        // on rejection.
        expect((await User.findById(reader._id)).creditBalance).toBe(500);
    });

    it('defaults creditApplied to 0 when none is requested', async () => {
        const reader = await createUser({ role: 'reader', creditBalance: 500 });
        const book = await createBook({ price: 1000 });

        const req = request(app)
            .post('/api/purchases')
            .set('Authorization', `Bearer ${tokenFor(reader)}`)
            .field('itemType', 'book')
            .field('item', book._id.toString());
        const res = await attachEvidence(req);

        expect(res.status).toBe(201);
        expect(res.body.creditApplied).toBe(0);
        expect((await User.findById(reader._id)).creditBalance).toBe(500);
    });
});

describe('GET /api/referrals/me', () => {
    it("returns the reader's own code, balance, and reward history without leaking other users' emails", async () => {
        const admin = await createUser({ role: 'admin' });
        const referrer = await createUser({ role: 'reader', referralCode: 'REF004', name: 'Referrer Reader' });
        const referred = await createUser({
            role: 'reader',
            referredBy: referrer._id,
            name: 'Referred Reader',
            email: 'referred-secret@example.com',
        });
        const book = await createBook({ price: 4000 });
        const pr = await createPurchaseRequest({
            reader: referred,
            itemType: 'book',
            item: book._id,
            amount: 4000,
            status: 'pending',
        });
        await request(app)
            .put(`/api/purchases/${pr._id}/approve`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`);

        const res = await request(app)
            .get('/api/referrals/me')
            .set('Authorization', `Bearer ${tokenFor(referrer)}`);

        expect(res.status).toBe(200);
        expect(res.body.referralCode).toBe('REF004');
        expect(res.body.creditBalance).toBe(200); // 5% of 4000
        expect(res.body.rewards).toHaveLength(1);
        expect(res.body.rewards[0].referredReaderName).toBe('Referred Reader');
        expect(res.body.rewards[0].amount).toBe(200);
        expect(JSON.stringify(res.body)).not.toContain('referred-secret@example.com');
    });

    it('requires authentication', async () => {
        const res = await request(app).get('/api/referrals/me');
        expect(res.status).toBe(401);
    });

    it('lazily generates and persists a referralCode for a pre-existing account that never got one', async () => {
        // Simulates an account created before the referral system existed —
        // createUser() with no referralCode override leaves it unset, same
        // as a real pre-Step-46 document.
        const reader = await createUser({ role: 'reader' });
        expect(reader.referralCode).toBeFalsy();

        const res = await request(app)
            .get('/api/referrals/me')
            .set('Authorization', `Bearer ${tokenFor(reader)}`);

        expect(res.status).toBe(200);
        expect(res.body.referralCode).toBeTruthy();

        const persisted = await User.findById(reader._id);
        expect(persisted.referralCode).toBe(res.body.referralCode);
    });
});
