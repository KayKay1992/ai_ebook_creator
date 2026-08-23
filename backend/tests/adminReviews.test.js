const request = require('supertest');
const app = require('../app');
const db = require('./dbHandler');
const Rating = require('../models/Rating');
const { createUser, tokenFor, createBook } = require('./helpers');

beforeAll(async () => db.connect());
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

describe('GET /api/admin/ratings — moderation list', () => {
    it('rejects a non-admin reader', async () => {
        const reader = await createUser({ role: 'reader' });
        const res = await request(app).get('/api/admin/ratings').set('Authorization', `Bearer ${tokenFor(reader)}`);
        expect(res.status).toBe(403);
    });

    it('lists reviews with book title and reader name, newest first, excluding star-only ratings', async () => {
        const admin = await createUser({ role: 'admin' });
        const readerA = await createUser({ role: 'reader', name: 'Reader A' });
        const readerB = await createUser({ role: 'reader', name: 'Reader B' });
        const book = await createBook({ title: 'The Test Book' });

        await Rating.create({ reader: readerA._id, book: book._id, stars: 3, review: 'First review.' });
        await Rating.create({ reader: readerB._id, book: book._id, stars: 5, review: 'Second review.' });
        // Star-only, no text — shouldn't appear in the moderation list.
        const otherReader = await createUser({ role: 'reader' });
        await Rating.create({ reader: otherReader._id, book: book._id, stars: 4, review: '' });

        const res = await request(app).get('/api/admin/ratings').set('Authorization', `Bearer ${tokenFor(admin)}`);
        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(2);
        expect(res.body.map((r) => r.review)).toEqual(['Second review.', 'First review.']);
        expect(res.body[0].bookTitle).toBe('The Test Book');
        expect(res.body[0].readerName).toBe('Reader B');
    });
});

describe('DELETE /api/admin/ratings/:id — moderation delete', () => {
    it('rejects a non-admin reader', async () => {
        const reader = await createUser({ role: 'reader' });
        const book = await createBook();
        const rating = await Rating.create({ reader: reader._id, book: book._id, stars: 5, review: 'x' });
        const res = await request(app).delete(`/api/admin/ratings/${rating._id}`).set('Authorization', `Bearer ${tokenFor(reader)}`);
        expect(res.status).toBe(403);
    });

    it('deletes the review and it no longer appears in the public list', async () => {
        const admin = await createUser({ role: 'admin' });
        const reader = await createUser({ role: 'reader' });
        const book = await createBook();
        const rating = await Rating.create({
            reader: reader._id,
            book: book._id,
            stars: 5,
            review: 'This review will be removed.',
        });

        const deleteRes = await request(app)
            .delete(`/api/admin/ratings/${rating._id}`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`);
        expect(deleteRes.status).toBe(200);
        expect(await Rating.findById(rating._id)).toBeNull();

        const publicRes = await request(app).get(`/api/kenlibs/ratings/${book._id}`);
        expect(publicRes.body.count).toBe(0);
        expect(publicRes.body.reviews).toHaveLength(0);
    });

    it('404s for a nonexistent review id', async () => {
        const admin = await createUser({ role: 'admin' });
        const fakeId = new (require('mongoose').Types.ObjectId)();
        const res = await request(app).delete(`/api/admin/ratings/${fakeId}`).set('Authorization', `Bearer ${tokenFor(admin)}`);
        expect(res.status).toBe(404);
    });
});
