// Readers' highlights, notes and bookmarks: access (hasBookAccess), strict
// per-reader ownership, limits and validation, translation languages, and
// that they're never exposed anywhere public. (Re-anchoring is browser-side
// and tested in frontend/src/utils/annotationAnchor.test.js.)
const request = require('supertest');
const app = require('../app');
const db = require('./dbHandler');
const ReaderAnnotation = require('../models/ReaderAnnotation');
const Book = require('../models/Book');
const PurchaseRequest = require('../models/PurchaseRequest');
const { createUser, tokenFor, createBook, createPurchaseRequest } = require('./helpers');

const auth = (user) => ({ Authorization: `Bearer ${tokenFor(user)}` });

const highlight = (chapterId, extra = {}) => ({
    type: 'highlight',
    chapterId,
    color: 'yellow',
    anchor: { paragraphIndex: 0, startOffset: 4, endOffset: 9, quote: 'quick', prefix: 'The ', suffix: ' brown' },
    ...extra,
});

const setup = async () => {
    const admin = await createUser({ role: 'admin' });
    const book = await createBook({
        userId: admin._id,
        status: 'published',
        chapters: [{ title: 'One', content: 'The quick brown fox.' }, { title: 'Two', content: 'Jumps over.' }],
    });
    const reader = await createUser({ role: 'reader' });
    await createPurchaseRequest({ reader, itemType: 'book', item: book._id, status: 'approved' });
    const chapterId = String(book.chapters[0]._id);
    return { admin, book, reader, chapterId };
};

const api = (user, book) => {
    const base = `/api/kenlibs/annotations/${book._id}`;
    const withAuth = (req) => (user ? req.set(auth(user)) : req);
    return {
        list: () => withAuth(request(app).get(base)),
        create: (body) => withAuth(request(app).post(base)).send(body),
        update: (id, body) => withAuth(request(app).put(`${base}/${id}`)).send(body),
        remove: (id) => withAuth(request(app).delete(`${base}/${id}`)),
    };
};

beforeAll(async () => {
    await db.connect();
});
afterEach(async () => {
    delete process.env.READER_ANNOTATIONS_MAX_PER_BOOK;
    await db.clearDatabase();
});
afterAll(async () => {
    await db.closeDatabase();
});

describe('access', () => {
    it('a reader without access gets 403 on every route, and nothing is stored', async () => {
        const { book, chapterId } = await setup();
        const stranger = await createUser({ role: 'reader' });
        const a = api(stranger, book);
        expect((await a.list()).status).toBe(403);
        expect((await a.create(highlight(chapterId))).status).toBe(403);
        expect((await a.update('64b000000000000000000000', { note: 'x' })).status).toBe(403);
        expect((await a.remove('64b000000000000000000000')).status).toBe(403);
        expect((await api(null, book).list()).status).toBe(401);
        expect(await ReaderAnnotation.countDocuments()).toBe(0);
    });

    it('a revoked purchase cuts access off on the next request (annotations are kept)', async () => {
        const { book, reader, chapterId } = await setup();
        expect((await api(reader, book).create(highlight(chapterId))).status).toBe(201);
        await PurchaseRequest.updateMany({ reader: reader._id }, { $set: { status: 'revoked' } });
        expect((await api(reader, book).list()).status).toBe(403);
        expect(await ReaderAnnotation.countDocuments()).toBe(1);
    });

    it('unknown books 404', async () => {
        const { reader } = await setup();
        expect((await request(app).get('/api/kenlibs/annotations/64b000000000000000000000').set(auth(reader))).status).toBe(404);
        expect((await request(app).get('/api/kenlibs/annotations/not-an-id').set(auth(reader))).status).toBe(404);
    });
});

describe('ownership isolation', () => {
    it("readers only ever see and change their own annotations, even with another reader's id", async () => {
        const { book, reader, chapterId } = await setup();
        const other = await createUser({ role: 'reader' });
        await createPurchaseRequest({ reader: other, itemType: 'book', item: book._id, status: 'approved' });

        const mine = (await api(reader, book).create(highlight(chapterId, { note: 'MY PRIVATE NOTE' }))).body;
        const theirs = (await api(other, book).create(highlight(chapterId, { note: 'THEIR NOTE' }))).body;

        const myList = (await api(reader, book).list()).body.annotations;
        expect(myList.map((a) => a._id)).toEqual([mine._id]);
        expect(JSON.stringify(myList)).not.toContain('THEIR NOTE');
        expect(myList[0]).not.toHaveProperty('reader');

        // Someone else's id behaves exactly like a missing one.
        expect((await api(other, book).update(mine._id, { note: 'hijacked' })).status).toBe(404);
        expect((await api(other, book).remove(mine._id)).status).toBe(404);
        const stored = await ReaderAnnotation.findById(mine._id).lean();
        expect(stored.note).toBe('MY PRIVATE NOTE');

        expect((await api(other, book).update(theirs._id, { note: 'edited' })).status).toBe(200);
        expect((await api(other, book).remove(theirs._id)).status).toBe(200);
        expect(await ReaderAnnotation.countDocuments()).toBe(1);
    });

    it('an annotation id from another book is not found through this book', async () => {
        const { admin, book, reader, chapterId } = await setup();
        const otherBook = await createBook({ userId: admin._id, chapters: [{ title: 'X', content: 'Text.' }] });
        await createPurchaseRequest({ reader, itemType: 'book', item: otherBook._id, status: 'approved' });
        const created = (await api(reader, book).create(highlight(chapterId))).body;
        expect((await api(reader, otherBook).remove(created._id)).status).toBe(404);
        expect((await api(reader, otherBook).list()).body.annotations).toEqual([]);
    });

    it('annotations are never in public or admin book responses', async () => {
        const { admin, book, reader, chapterId } = await setup();
        await api(reader, book).create(highlight(chapterId, { note: 'SECRET-READER-NOTE' }));
        await Book.updateOne({ _id: book._id }, { $set: { shareId: 'share-annotation-test' } });
        const responses = [
            await request(app).get('/api/public/kenlibs'),
            await request(app).get(`/api/public/kenlibs/books/${book._id}`),
            await request(app).get('/api/public/books/share-annotation-test'),
            await request(app).get(`/api/books/${book._id}`).set(auth(admin)),
            await request(app).get(`/api/kenlibs/read/${book._id}`).set(auth(reader)),
        ];
        for (const res of responses) expect(res.text).not.toContain('SECRET-READER-NOTE');
    });
});

describe('validation and limits', () => {
    it('creates highlights and bookmarks, and edits color, note and label', async () => {
        const { book, reader, chapterId } = await setup();
        const a = api(reader, book);
        const created = await a.create(highlight(chapterId, { note: '  A note.\u0007  ' }));
        expect(created.status).toBe(201);
        expect(created.body).toMatchObject({ type: 'highlight', color: 'yellow', language: 'original', note: 'A note.' });
        expect(created.body.anchor).toMatchObject({ paragraphIndex: 0, startOffset: 4, endOffset: 9, quote: 'quick' });

        expect((await a.update(created.body._id, { color: 'pink', note: 'Changed.' })).body).toMatchObject({ color: 'pink', note: 'Changed.' });

        const bookmark = await a.create({ type: 'bookmark', chapterId, label: 'Good bit', anchor: { paragraphIndex: 3 } });
        expect(bookmark.status).toBe(201);
        expect(bookmark.body).toMatchObject({ type: 'bookmark', label: 'Good bit', anchor: { paragraphIndex: 3, startOffset: null } });
        expect((await a.update(bookmark.body._id, { color: 'green' })).status).toBe(400); // bookmarks have no color
        expect((await a.create({ type: 'bookmark', chapterId })).body.anchor.paragraphIndex).toBeNull(); // chapter bookmark
    });

    it('rejects bad input', async () => {
        const { book, reader, chapterId } = await setup();
        const a = api(reader, book);
        const bad = [
            { ...highlight(chapterId), type: 'scribble' },
            highlight('64b000000000000000000000'),
            highlight(chapterId, { color: 'purple' }),
            highlight(chapterId, { note: 'x'.repeat(1001) }),
            highlight(chapterId, { note: { $gt: '' } }),
            highlight(chapterId, { anchor: { paragraphIndex: 0, startOffset: 9, endOffset: 4, quote: 'x' } }),
            highlight(chapterId, { anchor: { paragraphIndex: -1, startOffset: 0, endOffset: 4, quote: 'x' } }),
            highlight(chapterId, { anchor: { paragraphIndex: 0, startOffset: 0, endOffset: 4, quote: '   ' } }),
            highlight(chapterId, { anchor: { paragraphIndex: 0, startOffset: 0, endOffset: 4, quote: 'x'.repeat(2001) } }),
            highlight(chapterId, { language: 'klingon' }),
            { type: 'bookmark', chapterId, label: 'x'.repeat(121) },
        ];
        for (const body of bad) expect((await a.create(body)).status).toBe(400);
        expect(await ReaderAnnotation.countDocuments()).toBe(0);

        const ok = (await a.create(highlight(chapterId))).body;
        expect((await a.update(ok._id, { note: 'x'.repeat(1001) })).status).toBe(400);
        expect((await a.update(ok._id, {})).status).toBe(400);
    });

    it('enforces the per-book limit (READER_ANNOTATIONS_MAX_PER_BOOK, default 2000)', async () => {
        const { book, reader, chapterId } = await setup();
        expect((await api(reader, book).list()).body.maxPerBook).toBe(2000);
        process.env.READER_ANNOTATIONS_MAX_PER_BOOK = '2';
        const a = api(reader, book);
        expect((await a.create(highlight(chapterId))).status).toBe(201);
        expect((await a.create({ type: 'bookmark', chapterId })).status).toBe(201);
        const third = await a.create(highlight(chapterId));
        expect(third.status).toBe(409);
        expect(third.body.code).toBe('limit');
    });
});

describe('translations', () => {
    it('stores the language a highlight was made in, kept apart from the original', async () => {
        const { book, reader, chapterId } = await setup();
        const a = api(reader, book);
        await a.create(highlight(chapterId, { language: 'yo', note: 'on Yoruba' }));
        await a.create(highlight(chapterId, { note: 'on original' }));
        const list = (await a.list()).body.annotations;
        expect(list.map((x) => [x.language, x.note])).toEqual([
            ['yo', 'on Yoruba'],
            ['original', 'on original'],
        ]);
    });
});

describe('cleanup', () => {
    it("deleting the book or the reader's account deletes their annotations", async () => {
        const { admin, book, reader, chapterId } = await setup();
        await api(reader, book).create(highlight(chapterId));
        expect((await request(app).delete(`/api/admin/users/${reader._id}`).set(auth(admin))).status).toBe(200);
        expect(await ReaderAnnotation.countDocuments()).toBe(0);

        const reader2 = await createUser({ role: 'reader' });
        await createPurchaseRequest({ reader: reader2, itemType: 'book', item: book._id, status: 'approved' });
        await api(reader2, book).create(highlight(chapterId));
        expect((await request(app).delete(`/api/books/${book._id}`).set(auth(admin))).status).toBe(200);
        expect(await ReaderAnnotation.countDocuments()).toBe(0);
    });
});
