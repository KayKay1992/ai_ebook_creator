// The public share link returns a preview only, enforced on the server: a
// direct API request must never contain text from locked chapters or from
// beyond the excerpt limit. The owner's editor endpoint and the gated reader
// still get the full book.
const request = require('supertest');
const app = require('../app');
const db = require('./dbHandler');
const Book = require('../models/Book');
const BookTranslation = require('../models/BookTranslation');
const { previewExcerpt, PREVIEW_CHARS } = require('../utils/sharePreview');
const { createUser, tokenFor, createBook, createPurchaseRequest } = require('./helpers');

const auth = (user) => ({ Authorization: `Bearer ${tokenFor(user)}` });

// Paragraphs with unique, searchable markers, so a leak of any one of them
// shows up in the raw response text.
const paragraph = (marker, words = 60) => `${marker} ${Array.from({ length: words }, (_, i) => `word${i}`).join(' ')}.`;
const chapter = (n, paragraphs = 6) => ({
    title: `Chapter ${n} Title`,
    description: `SECRET-DESCRIPTION-${n}`,
    summary: `SECRET-SUMMARY-${n}`,
    content: Array.from({ length: paragraphs }, (_, p) => paragraph(`C${n}P${p}-MARKER`)).join('\n\n'),
});

const SHARE_ID = 'share-preview-test';

const setup = async () => {
    const admin = await createUser({ role: 'admin' });
    const book = await createBook({
        userId: admin._id,
        status: 'published',
        chapters: [chapter(1), chapter(2), chapter(3)],
    });
    await Book.updateOne({ _id: book._id }, { $set: { shareId: SHARE_ID, previewContent: 'SECRET-TEASER-TEXT' } });
    return { admin, book };
};

const fetchShare = () => request(app).get(`/api/public/books/${SHARE_ID}`);

beforeAll(async () => {
    await db.connect();
});
beforeEach(() => {
    delete process.env.SHARE_PREVIEW_CHAPTERS;
});
afterEach(async () => {
    await db.clearDatabase();
});
afterAll(async () => {
    delete process.env.SHARE_PREVIEW_CHAPTERS;
    await db.closeDatabase();
});

describe('GET /api/public/books/:shareId', () => {
    it('returns the first chapter as an excerpt and every other chapter as a locked title', async () => {
        const { book } = await setup();
        const res = await fetchShare();
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ isPreview: true, totalChapters: 3, previewChapters: 1, title: book.title });
        expect(String(res.body._id)).toBe(String(book._id));

        const [first, second, third] = res.body.chapters;
        expect(first).toMatchObject({ title: 'Chapter 1 Title', locked: false, isExcerpt: true });
        expect(first.content.length).toBeLessThanOrEqual(PREVIEW_CHARS);
        expect(first.content).toContain('C1P0-MARKER');
        // Cut at a paragraph boundary: whole paragraphs only.
        expect(first.content.split('\n\n').every((p) => /^C1P\d-MARKER .*\.$/.test(p))).toBe(true);
        expect(second).toEqual({ _id: expect.any(String), title: 'Chapter 2 Title', kind: 'chapter', locked: true });
        expect(third).toEqual({ _id: expect.any(String), title: 'Chapter 3 Title', kind: 'chapter', locked: true });

        // The raw response never contains locked or beyond-limit text, nor
        // anything else that isn't for the public.
        const raw = res.text;
        const keptParagraphs = first.content.split('\n\n').length;
        for (let p = keptParagraphs; p < 6; p++) expect(raw).not.toContain(`C1P${p}-MARKER`);
        expect(raw).not.toMatch(/C2P\d-MARKER|C3P\d-MARKER/);
        expect(raw).not.toMatch(/SECRET-(DESCRIPTION|SUMMARY|TEASER)/);
        expect(raw).not.toMatch(/"(price|isForSale|userId|shareId|audio|voiceProfile|previewContent)"/);
    });

    it('SHARE_PREVIEW_CHAPTERS sets how many chapters get an excerpt (0 = table of contents only)', async () => {
        await setup();
        process.env.SHARE_PREVIEW_CHAPTERS = '2';
        let res = await fetchShare();
        expect(res.body.previewChapters).toBe(2);
        expect(res.body.chapters.map((c) => c.locked)).toEqual([false, false, true]);
        expect(res.text).toContain('C2P0-MARKER');
        expect(res.text).not.toMatch(/C3P\d-MARKER/);

        process.env.SHARE_PREVIEW_CHAPTERS = '0';
        res = await fetchShare();
        expect(res.body.previewChapters).toBe(0);
        expect(res.body.chapters.every((c) => c.locked && c.content === undefined)).toBe(true);
        expect(res.text).not.toMatch(/C\dP\d-MARKER/);

        process.env.SHARE_PREVIEW_CHAPTERS = '99'; // capped
        res = await fetchShare();
        expect(res.body.previewChapters).toBe(3);
        expect(res.body.chapters.every((c) => c.content.length <= PREVIEW_CHARS)).toBe(true);

        process.env.SHARE_PREVIEW_CHAPTERS = 'nonsense'; // default
        expect((await fetchShare()).body.previewChapters).toBe(1);
    });

    it('never includes translations or audio, even when the book has them', async () => {
        const { book } = await setup();
        await BookTranslation.create({
            bookId: book._id,
            language: 'yo',
            chapters: [{ chapterId: book.chapters[0]._id, publishedTitle: 'SECRET-TRANSLATED-TITLE', publishedContent: 'SECRET-TRANSLATED-TEXT', publishedAt: new Date() }],
        });
        await Book.updateOne(
            { _id: book._id },
            { $set: { 'audio.chapters': [{ chapterId: book.chapters[0]._id, status: 'ready', publicId: 'ebook-creator/audio/SECRET-AUDIO-ID' }] } }
        );
        const res = await fetchShare();
        expect(res.text).not.toMatch(/SECRET-|ebook-creator\/audio/);
    });

    it('still 404s for unpublished books and unknown links', async () => {
        const { book } = await setup();
        await Book.updateOne({ _id: book._id }, { $set: { status: 'draft' } });
        expect((await fetchShare()).status).toBe(404);
        expect((await request(app).get('/api/public/books/no-such-link')).status).toBe(404);
    });
});

describe('full text is unaffected where access is granted', () => {
    it('the owner (editor/preview) and readers with access still get every chapter in full', async () => {
        const { admin, book } = await setup();
        const full = chapter(3).content;

        const owner = await request(app).get(`/api/books/${book._id}`).set(auth(admin));
        expect(owner.status).toBe(200);
        expect(owner.body.chapters[2].content).toBe(full);

        const reader = await createUser({ role: 'reader' });
        expect((await request(app).get(`/api/kenlibs/read/${book._id}`).set(auth(reader))).status).toBe(403);
        await createPurchaseRequest({ reader, itemType: 'book', item: book._id, status: 'approved' });
        const read = await request(app).get(`/api/kenlibs/read/${book._id}`).set(auth(reader));
        expect(read.status).toBe(200);
        expect(read.body.chapters.map((c) => c.content)).toEqual([chapter(1).content, chapter(2).content, full]);
    });
});

describe('previewExcerpt', () => {
    it('keeps whole paragraphs up to the limit', () => {
        const text = ['a'.repeat(700), 'b'.repeat(700), 'c'.repeat(700)].join('\n\n');
        const { content, truncated } = previewExcerpt(text, 1500);
        expect(content).toBe(['a'.repeat(700), 'b'.repeat(700)].join('\n\n'));
        expect(truncated).toBe(true);
        expect(previewExcerpt('Short.', 1500)).toEqual({ content: 'Short.', truncated: false });
    });

    it('cuts a single over-long first paragraph at a sentence or word, and never leaves a code fence open', () => {
        const long = `${'First sentence here. '.repeat(100)}`.trim();
        const { content, truncated } = previewExcerpt(long, 1500);
        expect(truncated).toBe(true);
        expect(content.length).toBeLessThanOrEqual(1501);
        expect(content.endsWith('here.…')).toBe(true);

        const code = `\`\`\`js\n${'const x = 1;\n'.repeat(200)}\`\`\``;
        const cut = previewExcerpt(code, 500).content;
        expect(cut.startsWith('```js')).toBe(true);
        expect(cut.trimEnd().endsWith('```')).toBe(true);
    });
});
