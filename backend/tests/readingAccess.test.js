const request = require('supertest');
const app = require('../app');
const db = require('./dbHandler');
const { createUser, tokenFor, createBook, createBundle, createPurchaseRequest } = require('./helpers');

beforeAll(async () => db.connect());
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

const readAs = (user, bookId) =>
    request(app).get(`/api/kenlibs/read/${bookId}`).set('Authorization', `Bearer ${tokenFor(user)}`);

describe('GET /api/kenlibs/read/:bookId — access resolution', () => {
    it('grants access via an approved DIRECT book purchase', async () => {
        const reader = await createUser({ role: 'reader' });
        const book = await createBook({ status: 'published' });
        await createPurchaseRequest({ reader, itemType: 'book', item: book._id, status: 'approved' });

        const res = await readAs(reader, book._id);
        expect(res.status).toBe(200);
        expect(res.body._id).toBe(book._id.toString());
    });

    it('grants access to EVERY book in an approved bundle, regardless of each book\'s own publish status', async () => {
        const reader = await createUser({ role: 'reader' });
        const publishedBook = await createBook({ status: 'published' });
        const draftBook = await createBook({ status: 'draft' });
        const bundle = await createBundle({ books: [publishedBook._id, draftBook._id] });
        await createPurchaseRequest({ reader, itemType: 'bundle', item: bundle._id, status: 'approved' });

        const publishedRes = await readAs(reader, publishedBook._id);
        expect(publishedRes.status).toBe(200);

        // The interesting case: hasBookAccess only checks bundle membership
        // + the PurchaseRequest's own status, never the book's own status
        // field — a draft book bundled into something the reader has
        // actually paid for must still be readable.
        const draftRes = await readAs(reader, draftBook._id);
        expect(draftRes.status).toBe(200);
        expect(draftRes.body._id).toBe(draftBook._id.toString());
    });

    it.each(['pending', 'rejected', 'revoked'])('grants NO access for a %s request', async (status) => {
        const reader = await createUser({ role: 'reader' });
        const book = await createBook({ status: 'published' });
        await createPurchaseRequest({ reader, itemType: 'book', item: book._id, status });

        const res = await readAs(reader, book._id);
        expect(res.status).toBe(403);
    });

    it('grants no access when the reader never requested the book at all', async () => {
        const reader = await createUser({ role: 'reader' });
        const book = await createBook({ status: 'published' });

        const res = await readAs(reader, book._id);
        expect(res.status).toBe(403);
    });

    it('grants no access based on another reader\'s approved purchase', async () => {
        const readerA = await createUser({ role: 'reader' });
        const readerB = await createUser({ role: 'reader' });
        const book = await createBook({ status: 'published' });
        await createPurchaseRequest({ reader: readerA, itemType: 'book', item: book._id, status: 'approved' });

        const res = await readAs(readerB, book._id);
        expect(res.status).toBe(403);
    });

    it('always grants an admin access, with zero purchase requests', async () => {
        const admin = await createUser({ role: 'admin' });
        const book = await createBook({ status: 'published' });

        const res = await readAs(admin, book._id);
        expect(res.status).toBe(200);
    });

    it('requires authentication', async () => {
        const book = await createBook({ status: 'published' });
        const res = await request(app).get(`/api/kenlibs/read/${book._id}`);
        expect(res.status).toBe(401);
    });

    it('404s for a nonexistent book id', async () => {
        const reader = await createUser({ role: 'reader' });
        const fakeId = new (require('mongoose').Types.ObjectId)();
        const res = await readAs(reader, fakeId);
        expect(res.status).toBe(404);
    });
});
