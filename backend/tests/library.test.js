// Library page backend: GET /api/kenlibs/library (one request, metadata
// only, own data only) and the reading-progress endpoints it relies on
// (auth, ownership/access, validation, latest-wins across devices, rate
// limit).
const request = require('supertest');
const app = require('../app');
const db = require('./dbHandler');
const ReaderProgress = require('../models/ReaderProgress');
const ReaderAnnotation = require('../models/ReaderAnnotation');
const BookTranslation = require('../models/BookTranslation');
const Book = require('../models/Book');
const User = require('../models/User');
const { createUser, tokenFor, createBook, createBundle, createPurchaseRequest } = require('./helpers');

const auth = (user) => ({ Authorization: `Bearer ${tokenFor(user)}` });
const chapters = (n) => Array.from({ length: n }, (_, i) => ({ title: `Chapter ${i + 1}`, content: `SECRET CHAPTER TEXT ${i + 1}` }));
const progressUrl = (book) => `/api/kenlibs/progress/${book._id}`;

beforeAll(db.connect);
afterEach(db.clearDatabase);
afterAll(db.closeDatabase);

const setup = async () => {
    const admin = await createUser({ role: 'admin' });
    const reader = await createUser({ role: 'reader', creditBalance: 750 });
    const owned = await createBook({ userId: admin._id, title: 'Owned Book', author: 'Ada', chapters: chapters(4) });
    const pendingBook = await createBook({ userId: admin._id, title: 'Pending Book', chapters: chapters(2) });
    const rejectedBook = await createBook({ userId: admin._id, title: 'Rejected Book', chapters: chapters(2) });
    const bundled = await createBook({ userId: admin._id, title: 'Bundled Book', chapters: chapters(3) });
    const bundle = await createBundle({ title: 'Starter Bundle', books: [bundled._id] });
    await createPurchaseRequest({ reader, itemType: 'book', item: owned._id, status: 'approved' });
    await createPurchaseRequest({ reader, itemType: 'book', item: pendingBook._id, status: 'pending' });
    const rejected = await createPurchaseRequest({ reader, itemType: 'book', item: rejectedBook._id, status: 'rejected' });
    rejected.adminNote = 'The transfer amount did not match.';
    await rejected.save();
    await createPurchaseRequest({ reader, itemType: 'bundle', item: bundle._id, status: 'approved' });
    return { admin, reader, owned, pendingBook, rejectedBook, bundled, bundle };
};

describe('GET /api/kenlibs/library', () => {
    it('needs a signed-in user', async () => {
        expect((await request(app).get('/api/kenlibs/library')).status).toBe(401);
    });

    it('returns statuses, owned books with progress and extras, and a summary, in one response', async () => {
        const { reader, owned, pendingBook, bundled } = await setup();
        await ReaderProgress.create({ reader: reader._id, book: owned._id, lastChapterIndex: 1, chapterProgress: 0.5, positionUpdatedAt: new Date() });
        await ReaderProgress.create({ reader: reader._id, book: bundled._id, lastChapterIndex: 2, completedAt: new Date() });
        const chapterId = owned.chapters[0]._id;
        await ReaderAnnotation.create([
            { reader: reader._id, book: owned._id, chapterId, type: 'highlight', note: 'Nice' },
            { reader: reader._id, book: owned._id, chapterId, type: 'highlight' },
            { reader: reader._id, book: owned._id, chapterId, type: 'bookmark' },
        ]);
        await BookTranslation.create({
            bookId: owned._id,
            language: 'fr',
            chapters: [{ chapterId, reviewStatus: 'published', publishedTitle: 'Un', publishedContent: 'Texte', publishedAt: new Date() }],
        });
        await Book.updateOne({ _id: owned._id }, { $set: { 'audio.chapters': [{ chapterId, status: 'ready', publicId: 'secret-public-id' }] } });

        const res = await request(app).get('/api/kenlibs/library').set(auth(reader));
        expect(res.status).toBe(200);
        expect(res.body.summary).toEqual({ owned: 2, finished: 1, reading: 1, pending: 1, creditBalance: 750 });

        const byTitle = Object.fromEntries(res.body.items.map((i) => [i.title, i]));
        expect(byTitle['Pending Book']).toMatchObject({ status: 'pending', decidedAt: null, adminNote: '' });
        expect(byTitle['Pending Book'].requestedAt).toBeTruthy();
        expect(byTitle['Rejected Book']).toMatchObject({ status: 'rejected', adminNote: 'The transfer amount did not match.' });
        expect(byTitle['Starter Bundle']).toMatchObject({ status: 'approved', itemType: 'bundle', bookIds: [String(bundled._id)] });

        const book = res.body.books[String(owned._id)];
        expect(book).toMatchObject({
            title: 'Owned Book',
            author: 'Ada',
            chapterCount: 4,
            owned: true,
            hasAudio: true,
            translations: [{ code: 'fr', name: 'French', nativeName: 'Français' }],
            annotations: { highlights: 2, notes: 1, bookmarks: 1 },
            progress: { chapterIndex: 1, chapterProgress: 0.5, percent: 37, completedAt: null },
        });
        expect(res.body.books[String(bundled._id)].progress.percent).toBe(100);
        // Pending items show what was asked for, but grant nothing.
        expect(res.body.books[String(pendingBook._id)]).toEqual(expect.objectContaining({ owned: false }));
        expect(res.body.books[String(pendingBook._id)].progress).toBeUndefined();

        // Never chapter text, audio ids or evidence URLs.
        const raw = JSON.stringify(res.body);
        expect(raw).not.toMatch(/SECRET CHAPTER TEXT|secret-public-id|fixture-evidence|evidenceImage|Texte/);
    });

    it('percentages are not rounded down by float noise', async () => {
        const { reader, admin } = await setup();
        const five = await createBook({ userId: admin._id, title: 'Five Chapters', chapters: chapters(5) });
        await createPurchaseRequest({ reader, itemType: 'book', item: five._id, status: 'approved' });
        await ReaderProgress.create({ reader: reader._id, book: five._id, lastChapterIndex: 1, chapterProgress: 0.4 });
        const res = await request(app).get('/api/kenlibs/library').set(auth(reader));
        expect(res.body.books[String(five._id)].progress.percent).toBe(28); // (1 + 0.4) / 5, not 27
    });

    it("only ever shows the signed-in reader's own requests", async () => {
        const { reader } = await setup();
        const other = await createUser();
        const res = await request(app).get('/api/kenlibs/library').set(auth(other));
        expect(res.status).toBe(200);
        expect(res.body.items).toEqual([]);
        expect(res.body.summary.owned).toBe(0);
        expect((await request(app).get('/api/kenlibs/library').set(auth(reader))).body.items).toHaveLength(4);
    });
});

describe('reading progress', () => {
    it('needs a signed-in user and access to the book', async () => {
        const { reader, pendingBook, owned } = await setup();
        expect((await request(app).get(progressUrl(owned))).status).toBe(401);
        expect((await request(app).put(progressUrl(owned)).send({ lastChapterIndex: 1 })).status).toBe(401);
        expect((await request(app).get(progressUrl(pendingBook)).set(auth(reader))).status).toBe(403);
        expect((await request(app).put(progressUrl(pendingBook)).set(auth(reader)).send({ lastChapterIndex: 1 })).status).toBe(403);
        expect((await request(app).get('/api/kenlibs/progress/not-an-id').set(auth(reader))).status).toBe(404);
    });

    it("each reader only reads and writes their own progress", async () => {
        const { reader, owned } = await setup();
        const other = await createUser();
        await createPurchaseRequest({ reader: other, itemType: 'book', item: owned._id, status: 'approved' });
        await request(app).put(progressUrl(owned)).set(auth(reader)).send({ lastChapterIndex: 2, chapterProgress: 0.4 });
        const theirs = await request(app).get(progressUrl(owned)).set(auth(other));
        expect(theirs.body).toMatchObject({ lastChapterIndex: 0, chapterProgress: 0 });
        await request(app).put(progressUrl(owned)).set(auth(other)).send({ lastChapterIndex: 3 });
        expect((await request(app).get(progressUrl(owned)).set(auth(reader))).body).toMatchObject({ lastChapterIndex: 2, chapterProgress: 0.4 });
    });

    it('saves chapter, chapter id and position, and validates input', async () => {
        const { reader, owned } = await setup();
        const chapterId = String(owned.chapters[2]._id);
        const ok = await request(app).put(progressUrl(owned)).set(auth(reader)).send({ lastChapterIndex: 2, lastChapterId: chapterId, chapterProgress: 0.25 });
        expect(ok.status).toBe(200);
        expect(ok.body).toMatchObject({ lastChapterIndex: 2, lastChapterId: chapterId, chapterProgress: 0.25, completedAt: null });
        expect(ok.body.positionUpdatedAt).toBeTruthy();

        for (const body of [
            { lastChapterIndex: 4 },
            { lastChapterIndex: -1 },
            { lastChapterIndex: 1.5 },
            { lastChapterIndex: '2' },
            { chapterProgress: 1.2 },
            { chapterProgress: -0.1 },
            { lastChapterId: 'nope' },
            { lastSpokenBlockIndex: -3 },
            { notes: 5 },
            { notes: 'x'.repeat(50001) },
            { lastChapterIndex: 1, positionUpdatedAt: 'not a date' },
            {},
        ]) {
            const res = await request(app).put(progressUrl(owned)).set(auth(reader)).send(body);
            expect(res.status).toBe(400);
        }
        expect((await request(app).get(progressUrl(owned)).set(auth(reader))).body).toMatchObject({ lastChapterIndex: 2, chapterProgress: 0.25 });
    });

    it('a new chapter without a position starts at its top, and finishing sets completedAt once', async () => {
        const { reader, owned } = await setup();
        await request(app).put(progressUrl(owned)).set(auth(reader)).send({ lastChapterIndex: 1, chapterProgress: 0.8 });
        const next = await request(app).put(progressUrl(owned)).set(auth(reader)).send({ lastChapterIndex: 2 });
        expect(next.body.chapterProgress).toBe(0);
        const last = await request(app).put(progressUrl(owned)).set(auth(reader)).send({ lastChapterIndex: 3 });
        expect(last.body.completedAt).toBeTruthy();
        const back = await request(app).put(progressUrl(owned)).set(auth(reader)).send({ lastChapterIndex: 0 });
        expect(back.body.completedAt).toBe(last.body.completedAt);
    });

    it('latest wins: an older position from another device is ignored, notes are not', async () => {
        const { reader, owned } = await setup();
        // A timeline in the past, so every step is genuinely later than the last.
        const now = Date.now() - 600000;
        await request(app).put(progressUrl(owned)).set(auth(reader)).send({ lastChapterIndex: 2, chapterProgress: 0.6, positionUpdatedAt: now });
        // A phone that was offline syncs an older position later.
        const stale = await request(app)
            .put(progressUrl(owned))
            .set(auth(reader))
            .send({ lastChapterIndex: 0, chapterProgress: 0.1, positionUpdatedAt: now - 60000, notes: 'From the phone' });
        expect(stale.status).toBe(200);
        expect(stale.body).toMatchObject({ stale: true, lastChapterIndex: 2, chapterProgress: 0.6, notes: 'From the phone' });
        // A newer one wins.
        const newer = await request(app).put(progressUrl(owned)).set(auth(reader)).send({ lastChapterIndex: 1, chapterProgress: 0.3, positionUpdatedAt: now + 1000 });
        expect(newer.body).toMatchObject({ lastChapterIndex: 1, chapterProgress: 0.3 });
        expect(newer.body.stale).toBeUndefined();
        // A clock far in the future counts as now, so it can't pin the position forever.
        await request(app).put(progressUrl(owned)).set(auth(reader)).send({ lastChapterIndex: 3, positionUpdatedAt: now + 365 * 86400000 });
        const after = await request(app).put(progressUrl(owned)).set(auth(reader)).send({ lastChapterIndex: 1, positionUpdatedAt: Date.now() });
        expect(after.body.lastChapterIndex).toBe(1);
        // Old clients without a timestamp still save (counted as now).
        const legacy = await request(app).put(progressUrl(owned)).set(auth(reader)).send({ lastChapterIndex: 2 });
        expect(legacy.body.lastChapterIndex).toBe(2);
    });

    it('rate-limits progress saves per user', async () => {
        const { reader, owned } = await setup();
        const statuses = [];
        for (let i = 0; i < 245; i++) {
            statuses.push((await request(app).put(progressUrl(owned)).set(auth(reader)).send({ chapterProgress: (i % 100) / 100 })).status);
        }
        expect(statuses.slice(0, 240).every((s) => s === 200)).toBe(true);
        expect(statuses[240]).toBe(429);
        // Another reader is unaffected.
        const other = await createUser();
        await createPurchaseRequest({ reader: other, itemType: 'book', item: owned._id, status: 'approved' });
        expect((await request(app).put(progressUrl(owned)).set(auth(other)).send({ chapterProgress: 0.5 })).status).toBe(200);
        expect(await User.countDocuments()).toBeGreaterThan(0);
    });
});
