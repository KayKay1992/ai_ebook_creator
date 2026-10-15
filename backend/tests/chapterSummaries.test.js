// Chapter summaries: the draft endpoint (owner/admin only, never saves),
// its Gemini quota handling, the length limit on save, and where summaries
// may and may not appear (gated reader yes; share link and storefront no).
jest.mock('@google/genai', () => {
    const generateContent = jest.fn();
    return {
        GoogleGenAI: jest.fn().mockImplementation(() => ({ models: { generateContent, generateContentStream: jest.fn() } })),
        __generateContent: generateContent,
    };
});

const request = require('supertest');
const app = require('../app');
const db = require('./dbHandler');
const Book = require('../models/Book');
const { __generateContent: generateContent } = require('@google/genai');
const { chapterSourceHash } = require('../utils/chapterHash');
const { createUser, tokenFor, createBook, createPurchaseRequest } = require('./helpers');

const auth = (user) => ({ Authorization: `Bearer ${tokenFor(user)}` });

const quotaError = (quotaId, retryDelay = '0s') =>
    Object.assign(
        new Error(
            JSON.stringify({
                error: {
                    code: 429,
                    status: 'RESOURCE_EXHAUSTED',
                    details: [
                        { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId }] },
                        { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay },
                    ],
                },
            })
        ),
        { status: 429 }
    );

const RECAP = 'This chapter introduces the main idea. It explains why it matters. It ends with a practical first step.';

const setup = async () => {
    const admin = await createUser({ role: 'admin' });
    const book = await createBook({
        userId: admin._id,
        status: 'published',
        chapters: [
            { title: 'One', content: 'Some real chapter text about budgeting.' },
            { title: 'Empty', content: '   ' },
        ],
    });
    return { admin, book, chapterId: book.chapters[0]._id.toString() };
};

const summarize = (user, body) => {
    const req = request(app).post('/api/ai/chapter-summary');
    if (user) req.set(auth(user));
    return req.send(body);
};

beforeAll(async () => {
    process.env.TTS_RETRY_BASE_MS = '1';
    process.env.TTS_RATE_WAIT_CAP_MS = '5';
    await db.connect();
});
beforeEach(() => {
    generateContent.mockReset();
    generateContent.mockResolvedValue({ text: `  ${RECAP}\n` });
    jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => {
    console.error.mockRestore();
    await db.clearDatabase();
});
afterAll(async () => {
    await db.closeDatabase();
});

describe('POST /api/ai/chapter-summary', () => {
    it('returns a draft and its source hash without saving anything', async () => {
        const { admin, book, chapterId } = await setup();
        const res = await summarize(admin, { bookId: book._id, chapterId });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ chapterId, summary: RECAP, sourceHash: chapterSourceHash(book.chapters[0]) });
        const prompt = generateContent.mock.calls[0][0].contents;
        expect(prompt).toContain('Some real chapter text about budgeting.');
        expect(prompt).toMatch(/No spoilers/);
        expect(generateContent.mock.calls[0][0].model).toBe('gemini-2.5-flash');
        expect((await Book.findById(book._id)).chapters[0].summary).toBe('');
    });

    it('is admin-only and owner-only', async () => {
        const { book, chapterId } = await setup();
        const reader = await createUser({ role: 'reader' });
        const otherAdmin = await createUser({ role: 'admin' });
        expect((await summarize(reader, { bookId: book._id, chapterId })).status).toBe(403);
        expect((await summarize(otherAdmin, { bookId: book._id, chapterId })).status).toBe(401);
        expect((await summarize(null, { bookId: book._id, chapterId })).status).toBe(401);
        expect(generateContent).not.toHaveBeenCalled();
    });

    it('validates the book and chapter', async () => {
        const { admin, book } = await setup();
        expect((await summarize(admin, {})).status).toBe(400);
        expect((await summarize(admin, { bookId: book._id, chapterId: '64b000000000000000000000' })).status).toBe(404);
        const empty = await summarize(admin, { bookId: book._id, chapterId: book.chapters[1]._id });
        expect(empty.status).toBe(400);
        expect(empty.body.message).toMatch(/no text/);
        expect(generateContent).not.toHaveBeenCalled();
    });

    it('a daily Gemini limit answers 429 quota "daily" at once, without retrying', async () => {
        const { admin, book, chapterId } = await setup();
        generateContent.mockRejectedValue(quotaError('GenerateRequestsPerDayPerProjectPerModel-FreeTier'));
        const res = await summarize(admin, { bookId: book._id, chapterId });
        expect(res.status).toBe(429);
        expect(res.body.quota).toBe('daily');
        expect(res.body.message).toMatch(/Daily Gemini limit reached/);
        expect(generateContent).toHaveBeenCalledTimes(1);
    });

    it('waits out a per-minute limit and retries transient errors', async () => {
        const { admin, book, chapterId } = await setup();
        generateContent
            .mockRejectedValueOnce(quotaError('GenerateRequestsPerMinutePerProjectPerModel-FreeTier'))
            .mockRejectedValueOnce(Object.assign(new Error('503 UNAVAILABLE'), { status: 503 }));
        const res = await summarize(admin, { bookId: book._id, chapterId });
        expect(res.status).toBe(200);
        expect(generateContent).toHaveBeenCalledTimes(3);
    });

    it('a per-minute limit that never clears answers 429 quota "minute"', async () => {
        const { admin, book, chapterId } = await setup();
        generateContent.mockRejectedValue(quotaError('GenerateRequestsPerMinutePerProjectPerModel-FreeTier'));
        const res = await summarize(admin, { bookId: book._id, chapterId });
        expect(res.status).toBe(429);
        expect(res.body.quota).toBe('minute');
    });
});

describe('admin-only AI routes', () => {
    it('readers can no longer call the teaser (or any other) AI endpoint', async () => {
        const { book } = await setup();
        const reader = await createUser({ role: 'reader' });
        const res = await request(app).post('/api/ai/generate-teaser').set(auth(reader)).send({ bookId: book._id });
        expect(res.status).toBe(403);
        expect(generateContent).not.toHaveBeenCalled();
    });
});

describe('saving and exposure', () => {
    const saveSummary = async (admin, book, summary, extra = {}) => {
        const loaded = (await request(app).get(`/api/books/${book._id}`).set(auth(admin))).body;
        loaded.chapters[0] = { ...loaded.chapters[0], summary, ...extra };
        return request(app).put(`/api/books/${book._id}`).set(auth(admin)).send(loaded);
    };

    it('saves a summary with the editor save and enforces the length limit', async () => {
        const { admin, book } = await setup();
        const saved = await saveSummary(admin, book, RECAP, { summaryEdited: true, summarySourceHash: 'abc' });
        expect(saved.status).toBe(200);
        const stored = (await Book.findById(book._id)).chapters[0];
        expect(stored).toMatchObject({ summary: RECAP, summaryEdited: true, summarySourceHash: 'abc' });

        const tooLong = await saveSummary(admin, book, 'x'.repeat(1201));
        expect(tooLong.status).toBe(400);
        expect(tooLong.body.message).toMatch(/1200 characters or fewer/);
        expect((await saveSummary(admin, book, { not: 'text' })).status).toBe(400);
        expect((await Book.findById(book._id)).chapters[0].summary).toBe(RECAP);
    });

    it('readers with access get the recap, but not the admin bookkeeping fields', async () => {
        const { admin, book } = await setup();
        await saveSummary(admin, book, RECAP, { summaryEdited: true, summarySourceHash: 'abc' });
        const reader = await createUser({ role: 'reader' });

        expect((await request(app).get(`/api/kenlibs/read/${book._id}`).set(auth(reader))).status).toBe(403);
        await createPurchaseRequest({ reader, itemType: 'book', item: book._id, status: 'approved' });
        const res = await request(app).get(`/api/kenlibs/read/${book._id}`).set(auth(reader));
        expect(res.status).toBe(200);
        expect(res.body.chapters[0].summary).toBe(RECAP);
        expect(res.body.chapters[0].summaryEdited).toBeUndefined();
        expect(res.body.chapters[0].summarySourceHash).toBeUndefined();
        expect(res.body.chapters[0].content).toBeTruthy();
    });

    it('the public share link and the storefront never include summaries', async () => {
        const { admin, book } = await setup();
        await saveSummary(admin, book, RECAP);
        await Book.updateOne({ _id: book._id }, { $set: { shareId: 'share-summary-test' } });

        const shared = await request(app).get('/api/public/books/share-summary-test');
        expect(shared.status).toBe(200);
        expect(shared.body.chapters[0].content).toBeTruthy();
        expect(JSON.stringify(shared.body)).not.toContain(RECAP);
        expect(shared.body.chapters[0]).not.toHaveProperty('summary');

        const detail = await request(app).get(`/api/public/kenlibs/books/${book._id}`);
        const storefront = await request(app).get('/api/public/kenlibs');
        expect(JSON.stringify(detail.body)).not.toContain(RECAP);
        expect(JSON.stringify(storefront.body)).not.toContain(RECAP);
    });
});
