// Cloudinary is never actually called in this suite — createPurchaseRequest
// uploads the evidence image via utils/cloudinaryUpload's
// uploadBufferToCloudinary, which this mock replaces with a fake resolved
// URL. No CLOUDINARY_* env vars are needed for any test to pass.
jest.mock('../utils/cloudinaryUpload', () => ({
    uploadBufferToCloudinary: jest.fn().mockResolvedValue({
        secure_url: 'https://res.cloudinary.com/fake/image/upload/mock-evidence.png',
    }),
}));

const request = require('supertest');
const app = require('../app');
const db = require('./dbHandler');
const PurchaseRequest = require('../models/PurchaseRequest');
const { createUser, tokenFor, createBook, createBundle, createPurchaseRequest } = require('./helpers');

beforeAll(async () => db.connect());
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

const attachEvidence = (req) => req.attach('evidenceImage', Buffer.from('fake-image-bytes'), 'evidence.png');

describe('POST /api/purchases — creation', () => {
    it('creates a request for a purchasable book, snapshotting the price server-side', async () => {
        const reader = await createUser({ role: 'reader' });
        const book = await createBook({ status: 'published', isForSale: true, price: 1500 });

        const req = request(app)
            .post('/api/purchases')
            .set('Authorization', `Bearer ${tokenFor(reader)}`)
            .field('itemType', 'book')
            .field('item', book._id.toString())
            // A malicious/buggy client sending its own amount must be
            // completely ignored — the server looks the price up itself.
            .field('amount', '1');

        const res = await attachEvidence(req);

        expect(res.status).toBe(201);
        expect(res.body.amount).toBe(1500);

        const stored = await PurchaseRequest.findById(res.body._id);
        expect(stored.amount).toBe(1500);
        expect(stored.reader.toString()).toBe(reader._id.toString());
    });

    it('rejects a request for a draft (unpublished) book', async () => {
        const reader = await createUser({ role: 'reader' });
        const book = await createBook({ status: 'draft', isForSale: true, price: 1000 });

        const req = request(app)
            .post('/api/purchases')
            .set('Authorization', `Bearer ${tokenFor(reader)}`)
            .field('itemType', 'book')
            .field('item', book._id.toString());
        const res = await attachEvidence(req);

        expect(res.status).toBe(400);
        expect(await PurchaseRequest.countDocuments({})).toBe(0);
    });

    it('rejects a request for a book that is not for sale', async () => {
        const reader = await createUser({ role: 'reader' });
        const book = await createBook({ status: 'published', isForSale: false, price: 1000 });

        const req = request(app)
            .post('/api/purchases')
            .set('Authorization', `Bearer ${tokenFor(reader)}`)
            .field('itemType', 'book')
            .field('item', book._id.toString());
        const res = await attachEvidence(req);

        expect(res.status).toBe(400);
    });

    it('rejects a request for a book with no price set', async () => {
        const reader = await createUser({ role: 'reader' });
        const book = await createBook({ status: 'published', isForSale: true, price: null });

        const req = request(app)
            .post('/api/purchases')
            .set('Authorization', `Bearer ${tokenFor(reader)}`)
            .field('itemType', 'book')
            .field('item', book._id.toString());
        const res = await attachEvidence(req);

        expect(res.status).toBe(400);
    });

    it('rejects a request for a bundle that is not for sale', async () => {
        const reader = await createUser({ role: 'reader' });
        const bundle = await createBundle({ isForSale: false, price: 2000 });

        const req = request(app)
            .post('/api/purchases')
            .set('Authorization', `Bearer ${tokenFor(reader)}`)
            .field('itemType', 'bundle')
            .field('item', bundle._id.toString());
        const res = await attachEvidence(req);

        expect(res.status).toBe(400);
    });

    it('rejects a request with no evidence image attached', async () => {
        const reader = await createUser({ role: 'reader' });
        const book = await createBook();

        const res = await request(app)
            .post('/api/purchases')
            .set('Authorization', `Bearer ${tokenFor(reader)}`)
            .field('itemType', 'book')
            .field('item', book._id.toString());

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/evidence image is required/i);
    });

    it('rejects a request missing itemType/item', async () => {
        const reader = await createUser({ role: 'reader' });
        const req = request(app).post('/api/purchases').set('Authorization', `Bearer ${tokenFor(reader)}`);
        const res = await attachEvidence(req);
        expect(res.status).toBe(400);
    });

    it('requires authentication', async () => {
        const book = await createBook();
        const req = request(app).post('/api/purchases').field('itemType', 'book').field('item', book._id.toString());
        const res = await attachEvidence(req);
        expect(res.status).toBe(401);
    });
});

describe('GET /api/purchases/mine — ownership scoping', () => {
    it('only returns the authenticated reader\'s own requests, never another reader\'s', async () => {
        const readerA = await createUser({ role: 'reader' });
        const readerB = await createUser({ role: 'reader' });
        const bookA = await createBook();
        const bookB = await createBook();

        const reqA = await createPurchaseRequest({ reader: readerA, itemType: 'book', item: bookA._id });
        await createPurchaseRequest({ reader: readerB, itemType: 'book', item: bookB._id });
        await createPurchaseRequest({ reader: readerB, itemType: 'book', item: bookA._id });

        const res = await request(app)
            .get('/api/purchases/mine')
            .set('Authorization', `Bearer ${tokenFor(readerA)}`);

        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(1);
        expect(res.body[0]._id).toBe(reqA._id.toString());
    });

    it('requires authentication', async () => {
        const res = await request(app).get('/api/purchases/mine');
        expect(res.status).toBe(401);
    });
});

describe('GET /api/purchases — admin queue', () => {
    it('rejects a non-admin reader', async () => {
        const reader = await createUser({ role: 'reader' });
        const res = await request(app).get('/api/purchases').set('Authorization', `Bearer ${tokenFor(reader)}`);
        expect(res.status).toBe(403);
    });

    it('rejects an unauthenticated request', async () => {
        const res = await request(app).get('/api/purchases');
        expect(res.status).toBe(401);
    });

    it('allows an admin and returns every request across readers', async () => {
        const admin = await createUser({ role: 'admin' });
        const readerA = await createUser({ role: 'reader' });
        const readerB = await createUser({ role: 'reader' });
        const book = await createBook();
        await createPurchaseRequest({ reader: readerA, itemType: 'book', item: book._id });
        await createPurchaseRequest({ reader: readerB, itemType: 'book', item: book._id });

        const res = await request(app).get('/api/purchases').set('Authorization', `Bearer ${tokenFor(admin)}`);
        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(2);
    });
});
