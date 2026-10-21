// Deleting a book: confirmed on the server (utils/bookDeletion.js), never
// only in the UI. Throwaway in-memory data only.
jest.mock('../utils/sendEmail', () => ({
    sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
    sendPurchaseRequestAdminEmail: jest.fn().mockResolvedValue(undefined),
    sendPurchaseDecisionEmail: jest.fn().mockResolvedValue(undefined),
    sendEmail: jest.fn().mockResolvedValue(undefined),
}));

const request = require('supertest');
const app = require('../app');
const db = require('./dbHandler');
const Book = require('../models/Book');
const AdminEvent = require('../models/AdminEvent');
const PurchaseRequest = require('../models/PurchaseRequest');
const { createUser, tokenFor, createBook, createBundle, createPurchaseRequest } = require('./helpers');
const { titlesMatch } = require('../utils/bookDeletion');

const auth = (user) => ({ Authorization: `Bearer ${tokenFor(user)}` });

beforeAll(db.connect);
afterEach(db.clearDatabase);
afterAll(db.closeDatabase);

const setup = async ({ status = 'draft', title = 'The Harmattan Letters' } = {}) => {
    const admin = await createUser({ role: 'admin' });
    const book = await createBook({ userId: admin._id, status, title, author: 'Ade Bello', chapters: [{ title: 'One', content: 'a' }, { title: 'Two', content: 'b' }] });
    const del = (body, user = admin) => request(app).delete(`/api/books/${book._id}`).set(auth(user)).send(body);
    const impact = (user = admin) => request(app).get(`/api/books/${book._id}/delete-impact`).set(auth(user));
    return { admin, book, del, impact };
};

describe('title matching', () => {
    it('is trimmed and case-insensitive, never empty', () => {
        expect(titlesMatch('  the harmattan LETTERS ', 'The Harmattan Letters')).toBe(true);
        expect(titlesMatch('The Harmattan Letter', 'The Harmattan Letters')).toBe(false);
        expect(titlesMatch('', '')).toBe(false);
        expect(titlesMatch(undefined, 'x')).toBe(false);
        expect(titlesMatch(['The Harmattan Letters'], 'The Harmattan Letters')).toBe(false);
    });
});

describe('DELETE /api/books/:id', () => {
    it('a draft: refused without the typed title or with the wrong one; deleted with it', async () => {
        const { admin, book, del } = await setup();
        // A direct API call with no body at all.
        expect((await request(app).delete(`/api/books/${book._id}`).set(auth(admin))).body.code).toBe('confirm_title_required');
        const missing = await del({});
        expect(missing.status).toBe(400);
        expect(missing.body.code).toBe('confirm_title_required');
        const wrong = await del({ confirmTitle: 'Some Other Book' });
        expect(wrong.status).toBe(400);
        expect(wrong.body.code).toBe('confirm_title_mismatch');
        expect(await Book.exists({ _id: book._id })).toBeTruthy();
        expect(await AdminEvent.countDocuments()).toBe(0); // nothing recorded for refused attempts
        const ok = await del({ confirmTitle: '  the harmattan letters ' });
        expect(ok.status).toBe(200);
        expect(await Book.exists({ _id: book._id })).toBeNull();
    });

    it('a published book needs confirmPublished and acknowledgeBuyers as well', async () => {
        const { book, del } = await setup({ status: 'published' });
        const noFlags = await del({ confirmTitle: book.title });
        expect(noFlags.status).toBe(400);
        expect(noFlags.body.code).toBe('confirm_published_required');
        const onlyPublished = await del({ confirmTitle: book.title, confirmPublished: true });
        expect(onlyPublished.body.code).toBe('acknowledge_buyers_required');
        // "truthy" isn't enough: it must be exactly true.
        expect((await del({ confirmTitle: book.title, confirmPublished: 'yes', acknowledgeBuyers: 1 })).body.code).toBe('confirm_published_required');
        expect(await Book.exists({ _id: book._id })).toBeTruthy();
        expect((await del({ confirmTitle: book.title, confirmPublished: true, acknowledgeBuyers: true })).status).toBe(200);
        expect(await Book.exists({ _id: book._id })).toBeNull();
    });

    it('with buyers: the impact lists them and the bundles; deletion needs acknowledgeBuyers (even once unpublished); purchases are kept', async () => {
        const { book, del, impact } = await setup({ status: 'published' });
        const bundle = await createBundle({ title: 'Harmattan Collection', books: [book._id] });
        const [direct, viaBundle, waiting] = await Promise.all([createUser(), createUser(), createUser()]);
        await createPurchaseRequest({ reader: direct, itemType: 'book', item: book._id, status: 'approved' });
        await createPurchaseRequest({ reader: viaBundle, itemType: 'bundle', item: bundle._id, status: 'approved' });
        await createPurchaseRequest({ reader: waiting, itemType: 'book', item: book._id, status: 'pending' });

        const res = await impact();
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
            title: 'The Harmattan Letters',
            author: 'Ade Bello',
            status: 'published',
            chapterCount: 2,
            buyers: { total: 2, direct: 1, viaBundles: 1 },
            pendingCount: 1,
            needsBuyerAcknowledgement: true,
        });
        expect(res.body.bundles).toEqual([expect.objectContaining({ title: 'Harmattan Collection', isForSale: true })]);
        expect(JSON.stringify(res.body)).not.toMatch(/@|email/); // counts only, no reader details

        // Unpublished but still owned by readers: still needs the acknowledgement.
        await Book.updateOne({ _id: book._id }, { status: 'draft' });
        const unacknowledged = await del({ confirmTitle: book.title });
        expect(unacknowledged.status).toBe(400);
        expect(unacknowledged.body.code).toBe('acknowledge_buyers_required');
        expect(unacknowledged.body.message).toMatch(/2 readers have bought this book/);

        expect((await del({ confirmTitle: book.title, acknowledgeBuyers: true })).status).toBe(200);
        expect(await PurchaseRequest.countDocuments()).toBe(3); // today's behaviour: purchase history is kept
    });

    it('writes an audit record for every deletion', async () => {
        const { admin, book, del } = await setup({ status: 'published' });
        const reader = await createUser();
        await createPurchaseRequest({ reader, itemType: 'book', item: book._id, status: 'approved' });
        await createBundle({ title: 'Starter Pack', books: [book._id] });
        await del({ confirmTitle: book.title, confirmPublished: true, acknowledgeBuyers: true });
        const events = await AdminEvent.find().lean();
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            type: 'book_deleted',
            title: 'The Harmattan Letters',
            author: 'Ade Bello',
            status: 'published',
            chapterCount: 2,
            buyerCount: 1,
            pendingCount: 0,
            bundleTitles: ['Starter Pack'],
        });
        expect(String(events[0].actorId)).toBe(String(admin._id));
        expect(String(events[0].bookId)).toBe(String(book._id));
        expect(events[0].createdAt).toBeInstanceOf(Date);
    });

    it('admin-only and owner-only, for both the impact and the delete', async () => {
        const { book, del, impact } = await setup();
        const reader = await createUser({ role: 'reader' });
        const otherAdmin = await createUser({ role: 'admin' });
        const body = { confirmTitle: book.title, confirmPublished: true, acknowledgeBuyers: true };
        expect((await request(app).delete(`/api/books/${book._id}`).send(body)).status).toBe(401);
        expect((await del(body, reader)).status).toBe(403);
        expect((await impact(reader)).status).toBe(403);
        expect((await del(body, otherAdmin)).status).toBe(401);
        expect((await impact(otherAdmin)).status).toBe(401);
        expect(await Book.exists({ _id: book._id })).toBeTruthy();
    });

    it('is rate-limited per admin', async () => {
        const admin = await createUser({ role: 'admin' });
        let last;
        for (let i = 0; i < 31; i++) last = await request(app).delete('/api/books/000000000000000000000000').set(auth(admin)).send({});
        expect(last.status).toBe(429);
        expect(last.body.code).toBe('rate_limited');
    });
});
