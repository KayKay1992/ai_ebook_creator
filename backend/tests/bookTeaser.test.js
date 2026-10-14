// Gemini is mocked at the SDK level, same idea as cloudinaryUpload/sendEmail
// elsewhere in this suite: no test ever calls the real API. aiController.js
// builds one GoogleGenAI client at require time, so every call it makes goes
// through the single shared `generateContent` mock exposed here.
jest.mock('@google/genai', () => {
    const generateContent = jest.fn();
    return {
        GoogleGenAI: jest.fn().mockImplementation(() => ({
            models: { generateContent, generateContentStream: jest.fn() },
        })),
        __generateContent: generateContent,
    };
});

const request = require('supertest');
const app = require('../app');
const db = require('./dbHandler');
const Book = require('../models/Book');
const { __generateContent: generateContent } = require('@google/genai');
const { createUser, createBook, tokenFor } = require('./helpers');

const MOCK_TEASER = 'What if everything you knew about money was backwards?\n\nThis book shows you how to fix it.\n\nTurn the page and start.';

beforeAll(async () => db.connect());
beforeEach(() => {
    generateContent.mockReset();
    generateContent.mockResolvedValue({ text: MOCK_TEASER });
});
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

const createOwnedBook = async (overrides = {}) => {
    const admin = await createUser({ role: 'admin' });
    const book = await createBook({ userId: admin._id, ...overrides });
    return { admin, book };
};

describe('public previewContent visibility', () => {
    it('returns previewContent on the single-book detail endpoint', async () => {
        const { book } = await createOwnedBook();
        await Book.updateOne({ _id: book._id }, { previewContent: 'A gripping teaser.' });

        const res = await request(app).get(`/api/public/kenlibs/books/${book._id}`);

        expect(res.status).toBe(200);
        expect(res.body.previewContent).toBe('A gripping teaser.');
        // Never any chapter content in a public storefront response.
        expect(res.body.chapters).toBeUndefined();
    });

    it('leaves previewContent (and chapters) out of the storefront listing', async () => {
        const { book } = await createOwnedBook();
        await Book.updateOne({ _id: book._id }, { previewContent: 'A gripping teaser.' });

        const res = await request(app).get('/api/public/kenlibs');

        expect(res.status).toBe(200);
        const listed = res.body.books.find((b) => b._id === book._id.toString());
        expect(listed).toBeDefined();
        expect(listed.previewContent).toBeUndefined();
        expect(listed.chapters).toBeUndefined();
    });

    it('still 404s a draft book on the detail endpoint, teaser or not', async () => {
        const { book } = await createOwnedBook({ status: 'draft' });
        await Book.updateOne({ _id: book._id }, { previewContent: 'Should never be seen.' });

        const res = await request(app).get(`/api/public/kenlibs/books/${book._id}`);

        expect(res.status).toBe(404);
        expect(res.body.previewContent).toBeUndefined();
    });
});

describe('saving previewContent through PUT /api/books/:id', () => {
    it('saves a teaser within the limit', async () => {
        const { admin, book } = await createOwnedBook();

        const res = await request(app)
            .put(`/api/books/${book._id}`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`)
            .send({ previewContent: 'Short and catchy.' });

        expect(res.status).toBe(200);
        expect(res.body.previewContent).toBe('Short and catchy.');
        expect((await Book.findById(book._id)).previewContent).toBe('Short and catchy.');
    });

    it('rejects an over-length teaser with a clear 400 and saves nothing', async () => {
        const { admin, book } = await createOwnedBook();

        const res = await request(app)
            .put(`/api/books/${book._id}`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`)
            .send({ previewContent: 'x'.repeat(Book.PREVIEW_CONTENT_MAX_LENGTH + 1) });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/2000 characters or fewer/);
        expect((await Book.findById(book._id)).previewContent).toBe('');
    });

    it('rejects a non-string teaser with a 400', async () => {
        const { admin, book } = await createOwnedBook();

        const res = await request(app)
            .put(`/api/books/${book._id}`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`)
            .send({ previewContent: { nested: 'object' } });

        expect(res.status).toBe(400);
    });
});

describe('POST /api/ai/generate-teaser', () => {
    it('returns the generated teaser without saving it', async () => {
        const { admin, book } = await createOwnedBook();

        const res = await request(app)
            .post('/api/ai/generate-teaser')
            .set('Authorization', `Bearer ${tokenFor(admin)}`)
            .send({ bookId: book._id });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ teaser: MOCK_TEASER });
        // The admin reviews and saves; the endpoint itself never writes.
        expect((await Book.findById(book._id)).previewContent).toBe('');
    });

    it('builds the prompt from titles/descriptions only, never chapter content', async () => {
        const { admin, book } = await createOwnedBook({
            chapters: [
                {
                    title: 'The Hidden Ledger',
                    description: 'Why budgets fail',
                    content: 'SECRET-CHAPTER-BODY-THAT-MUST-NOT-LEAK',
                },
            ],
        });

        await request(app)
            .post('/api/ai/generate-teaser')
            .set('Authorization', `Bearer ${tokenFor(admin)}`)
            .send({ bookId: book._id });

        expect(generateContent).toHaveBeenCalledTimes(1);
        const prompt = generateContent.mock.calls[0][0].contents;
        expect(prompt).toContain('The Hidden Ledger');
        expect(prompt).toContain('Why budgets fail');
        expect(prompt).not.toContain('SECRET-CHAPTER-BODY-THAT-MUST-NOT-LEAK');
    });

    it("rejects generating a teaser for another user's book", async () => {
        const { book } = await createOwnedBook();
        const otherAdmin = await createUser({ role: 'admin' });

        const res = await request(app)
            .post('/api/ai/generate-teaser')
            .set('Authorization', `Bearer ${tokenFor(otherAdmin)}`)
            .send({ bookId: book._id });

        expect(res.status).toBe(401);
        expect(generateContent).not.toHaveBeenCalled();
    });

    it('requires authentication', async () => {
        const { book } = await createOwnedBook();
        const res = await request(app).post('/api/ai/generate-teaser').send({ bookId: book._id });
        expect(res.status).toBe(401);
    });

    it('shares the 20-requests-per-hour AI rate limit with the other AI routes', async () => {
        const { admin, book } = await createOwnedBook();
        const auth = `Bearer ${tokenFor(admin)}`;
        generateContent.mockResolvedValue({ text: 'Generated copy.' });

        // 10 blurb + 10 teaser requests use up the shared budget of 20...
        for (let i = 0; i < 10; i++) {
            const blurbRes = await request(app).post('/api/ai/generate-blurb').set('Authorization', auth).send({ bookId: book._id });
            expect(blurbRes.status).toBe(200);
            const teaserRes = await request(app).post('/api/ai/generate-teaser').set('Authorization', auth).send({ bookId: book._id });
            expect(teaserRes.status).toBe(200);
        }

        // ...so the 21st AI request of any kind is refused.
        const limited = await request(app).post('/api/ai/generate-teaser').set('Authorization', auth).send({ bookId: book._id });
        expect(limited.status).toBe(429);
        expect(limited.body.message).toMatch(/rate limit/i);
    });
});

describe('link previews (ogPreviewRoute) with a teaser', () => {
    const CRAWLER_UA = 'facebookexternalhit/1.1';

    it("uses the teaser's short opening paragraph as og:description", async () => {
        const { book } = await createOwnedBook();
        await Book.updateOne({ _id: book._id }, { previewContent: 'A short hook.\n\nMore detail follows here.' });

        const res = await request(app).get(`/kenlibs/book/${book._id}`).set('User-Agent', CRAWLER_UA);

        expect(res.status).toBe(200);
        expect(res.text).toContain('<meta property="og:description" content="A short hook." />');
    });

    it('falls back to the blurb when the opening paragraph is too long for a preview', async () => {
        const { book } = await createOwnedBook();
        await Book.updateOne(
            { _id: book._id },
            { previewContent: 'y'.repeat(400), 'coverDesign.back.blurb': 'The back-cover blurb.' }
        );

        const res = await request(app).get(`/kenlibs/book/${book._id}`).set('User-Agent', CRAWLER_UA);

        expect(res.text).toContain('content="The back-cover blurb."');
    });

    it('still redirects ordinary visitors straight to the SPA', async () => {
        const { book } = await createOwnedBook();
        const res = await request(app)
            .get(`/kenlibs/book/${book._id}`)
            .set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0');
        expect(res.status).toBe(302);
    });
});
