const request = require('supertest');
const app = require('../app');
const db = require('./dbHandler');
const Rating = require('../models/Rating');
const { createUser, tokenFor, createBook, createBundle, createPurchaseRequest } = require('./helpers');

beforeAll(async () => db.connect());
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

const rateAs = (user, bookId, body) =>
    request(app)
        .post(`/api/kenlibs/ratings/${bookId}`)
        .set('Authorization', `Bearer ${tokenFor(user)}`)
        .send(body);

describe('POST /api/kenlibs/ratings/:bookId — access gating', () => {
    it('rejects a reader with no access to the book', async () => {
        const reader = await createUser({ role: 'reader' });
        const book = await createBook();

        const res = await rateAs(reader, book._id, { stars: 5, review: 'Great!' });
        expect(res.status).toBe(403);
        expect(await Rating.countDocuments({})).toBe(0);
    });

    it('allows a reader with an approved DIRECT purchase', async () => {
        const reader = await createUser({ role: 'reader' });
        const book = await createBook();
        await createPurchaseRequest({ reader, itemType: 'book', item: book._id, status: 'approved' });

        const res = await rateAs(reader, book._id, { stars: 4, review: 'Solid read.' });
        expect(res.status).toBe(200);
        expect(res.body.stars).toBe(4);
    });

    it('allows a reader with access via an approved BUNDLE purchase', async () => {
        const reader = await createUser({ role: 'reader' });
        const book = await createBook();
        const bundle = await createBundle({ books: [book._id] });
        await createPurchaseRequest({ reader, itemType: 'bundle', item: bundle._id, status: 'approved' });

        const res = await rateAs(reader, book._id, { stars: 5, review: 'Bundle access works too.' });
        expect(res.status).toBe(200);
    });

    it('rejects a pending (not yet approved) purchase', async () => {
        const reader = await createUser({ role: 'reader' });
        const book = await createBook();
        await createPurchaseRequest({ reader, itemType: 'book', item: book._id, status: 'pending' });

        const res = await rateAs(reader, book._id, { stars: 3, review: 'Should not work.' });
        expect(res.status).toBe(403);
    });

    it('requires authentication', async () => {
        const book = await createBook();
        const res = await request(app).post(`/api/kenlibs/ratings/${book._id}`).send({ stars: 5 });
        expect(res.status).toBe(401);
    });
});

describe('POST /api/kenlibs/ratings/:bookId — validation', () => {
    it.each([0, 6, 3.5, -1])('rejects an out-of-range/non-integer stars value: %s', async (stars) => {
        const reader = await createUser({ role: 'reader' });
        const book = await createBook();
        await createPurchaseRequest({ reader, itemType: 'book', item: book._id, status: 'approved' });

        const res = await rateAs(reader, book._id, { stars });
        expect(res.status).toBe(400);
    });

    it('rejects a missing stars value', async () => {
        const reader = await createUser({ role: 'reader' });
        const book = await createBook();
        await createPurchaseRequest({ reader, itemType: 'book', item: book._id, status: 'approved' });

        const res = await rateAs(reader, book._id, { review: 'No stars given.' });
        expect(res.status).toBe(400);
    });
});

describe('editing an existing rating upserts, never duplicates', () => {
    it('updates in place — verified via a direct DB count, not just the API response', async () => {
        const reader = await createUser({ role: 'reader' });
        const book = await createBook();
        await createPurchaseRequest({ reader, itemType: 'book', item: book._id, status: 'approved' });

        await rateAs(reader, book._id, { stars: 3, review: 'First impression.' });
        const secondRes = await rateAs(reader, book._id, { stars: 5, review: 'Changed my mind, loved it.' });

        expect(secondRes.status).toBe(200);
        expect(secondRes.body.stars).toBe(5);

        const docs = await Rating.find({ reader: reader._id, book: book._id });
        expect(docs).toHaveLength(1);
        expect(docs[0].stars).toBe(5);
        expect(docs[0].review).toBe('Changed my mind, loved it.');

        expect(await Rating.countDocuments({ book: book._id })).toBe(1);
    });
});

describe('GET /api/kenlibs/ratings/:bookId — public aggregate', () => {
    it('is reachable without authentication', async () => {
        const book = await createBook();
        const res = await request(app).get(`/api/kenlibs/ratings/${book._id}`);
        expect(res.status).toBe(200);
        expect(res.body).toEqual(
            expect.objectContaining({ average: null, count: 0, reviews: [] })
        );
    });

    it('computes the average and count correctly across multiple raters', async () => {
        const book = await createBook();
        const readerA = await createUser({ role: 'reader' });
        const readerB = await createUser({ role: 'reader' });
        await createPurchaseRequest({ reader: readerA, itemType: 'book', item: book._id, status: 'approved' });
        await createPurchaseRequest({ reader: readerB, itemType: 'book', item: book._id, status: 'approved' });

        await rateAs(readerA, book._id, { stars: 5, review: 'Loved it.' });
        await rateAs(readerB, book._id, { stars: 3, review: 'It was fine.' });

        const res = await request(app).get(`/api/kenlibs/ratings/${book._id}`);
        expect(res.status).toBe(200);
        expect(res.body.average).toBe(4);
        expect(res.body.count).toBe(2);
        expect(res.body.reviews).toHaveLength(2);
    });

    it('never leaks the reviewer\'s email address', async () => {
        const book = await createBook();
        const reader = await createUser({ role: 'reader', email: 'private-address@example.com', name: 'Secretive Reader' });
        await createPurchaseRequest({ reader, itemType: 'book', item: book._id, status: 'approved' });
        await rateAs(reader, book._id, { stars: 4, review: 'Check my identity is not leaked.' });

        const res = await request(app).get(`/api/kenlibs/ratings/${book._id}`);
        const raw = JSON.stringify(res.body);

        expect(raw).not.toContain('private-address@example.com');
        expect(raw).toContain('Secretive Reader');
        expect(res.body.reviews[0].readerName).toBe('Secretive Reader');
        expect(res.body.reviews[0].reader).toBeUndefined();
    });
});

describe('GET /api/kenlibs/ratings/:bookId/mine', () => {
    it('reports hasAccess:false and rating:null for a reader without access', async () => {
        const reader = await createUser({ role: 'reader' });
        const book = await createBook();

        const res = await request(app)
            .get(`/api/kenlibs/ratings/${book._id}/mine`)
            .set('Authorization', `Bearer ${tokenFor(reader)}`);

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ hasAccess: false, rating: null });
    });

    it('reports hasAccess:true and the existing rating for a reader who has rated', async () => {
        const reader = await createUser({ role: 'reader' });
        const book = await createBook();
        await createPurchaseRequest({ reader, itemType: 'book', item: book._id, status: 'approved' });
        await rateAs(reader, book._id, { stars: 2, review: 'Mediocre.' });

        const res = await request(app)
            .get(`/api/kenlibs/ratings/${book._id}/mine`)
            .set('Authorization', `Bearer ${tokenFor(reader)}`);

        expect(res.status).toBe(200);
        expect(res.body.hasAccess).toBe(true);
        expect(res.body.rating.stars).toBe(2);
    });

    it('reports hasAccess:true and rating:null for a reader with access who has not rated yet', async () => {
        const reader = await createUser({ role: 'reader' });
        const book = await createBook();
        await createPurchaseRequest({ reader, itemType: 'book', item: book._id, status: 'approved' });

        const res = await request(app)
            .get(`/api/kenlibs/ratings/${book._id}/mine`)
            .set('Authorization', `Bearer ${tokenFor(reader)}`);

        expect(res.body).toEqual({ hasAccess: true, rating: null });
    });
});
