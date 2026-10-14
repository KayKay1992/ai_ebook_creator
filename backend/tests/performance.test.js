const request = require('supertest');
const app = require('../app');
const db = require('./dbHandler');
const Book = require('../models/Book');
const { createUser } = require('./helpers');

describe('GET /api/health', () => {
    // Deliberately runs with no database connected at all — the endpoint
    // must never depend on Mongo, or an uptime monitor would report the
    // instance down whenever the DB is slow.
    it('returns { ok: true } without touching the database', async () => {
        const res = await request(app).get('/api/health');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ok: true });
    });
});

describe('response compression + storefront', () => {
    beforeAll(async () => db.connect());
    afterEach(async () => db.clearDatabase());
    afterAll(async () => db.closeDatabase());

    it('gzips a storefront response large enough to be worth compressing', async () => {
        const author = await createUser({ role: 'admin' });
        await Book.insertMany(
            Array.from({ length: 20 }).map((_, i) => ({
                userId: author._id,
                title: `Published book ${i}`,
                author: 'Test Author',
                status: 'published',
                shareId: `share-${i}`,
            }))
        );

        const res = await request(app)
            .get('/api/public/kenlibs')
            .set('Accept-Encoding', 'gzip');

        expect(res.status).toBe(200);
        expect(res.headers['content-encoding']).toBe('gzip');
        // supertest transparently decompresses — the lean() payload still
        // has the same shape the frontend reads.
        expect(res.body.books).toHaveLength(20);
        expect(res.body.books[0]).toEqual(
            expect.objectContaining({ _id: expect.any(String), title: expect.any(String) })
        );
    });

    it('declares the { status, createdAt } index the storefront query uses', () => {
        const indexes = Book.schema.indexes().map(([fields]) => fields);
        expect(indexes).toContainEqual({ status: 1, createdAt: -1 });
    });
});
