// AI translations: the background job (chunking, resume, quota handling,
// alignment and number checks), stale detection, the draft → reviewed →
// published flow (nothing auto-publishes), and reader/public access.
// Gemini is mocked: it "translates" by upper-casing letters, which keeps
// markdown and numbers intact so structure can be checked exactly.
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
const BookTranslation = require('../models/BookTranslation');
const { __generateContent: generateContent } = require('@google/genai');
const { waitForIdle, recoverInterruptedTranslations, INTERRUPTED_MESSAGE } = require('../utils/translationJobs');
const {
    splitBlocks,
    chapterItems,
    chunkItemIndexes,
    missingNumbers,
    restoreLeadingMarker,
} = require('../utils/translationText');
const { createUser, tokenFor, createBook, createPurchaseRequest } = require('./helpers');

const auth = (user) => ({ Authorization: `Bearer ${tokenFor(user)}` });

// The strings Gemini was asked to translate in call `n`.
const inputOf = (args) => JSON.parse(args.contents.slice(args.contents.indexOf('Input:\n') + 'Input:\n'.length));
const sentItems = () => generateContent.mock.calls.flatMap(([args]) => inputOf(args));
const upper = (s) => s.replace(/\p{L}+/gu, (w) => w.toUpperCase());
const translateMock = async (args) => ({ text: JSON.stringify(inputOf(args).map(upper)) });

const quotaError = (quotaId) =>
    Object.assign(
        new Error(
            JSON.stringify({
                error: {
                    code: 429,
                    status: 'RESOURCE_EXHAUSTED',
                    details: [
                        { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId }] },
                        { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '0s' },
                    ],
                },
            })
        ),
        { status: 429 }
    );

const CHAPTER_ONE = {
    title: 'Money Basics',
    content: [
        '# Getting started',
        'Ada saved ₦5,000 every month for 12 months.',
        '- First, track spending\n- Then, cut costs',
        '```js\nconst total = 5000;\n\nconsole.log(total);\n```',
        '---',
        'She shops at Shoprite in Lagos.',
    ].join('\n\n'),
};

const setup = async ({ chapters = [CHAPTER_ONE, { title: 'Second', content: 'A short second chapter.' }] } = {}) => {
    const admin = await createUser({ role: 'admin' });
    const book = await createBook({ userId: admin._id, chapters, status: 'published' });
    return { admin, book, chapterIds: book.chapters.map((c) => c._id.toString()) };
};

const api = (admin, book) => {
    const base = `/api/books/${book._id}/translations`;
    return {
        translate: (lang, body) => request(app).post(`${base}/${lang}/translate`).set(auth(admin)).send(body),
        status: async (lang) => (await request(app).get(`${base}/${lang}`).set(auth(admin))).body,
        chapter: async (lang, id) => (await request(app).get(`${base}/${lang}/${id}`).set(auth(admin))).body,
        edit: (lang, id, body) => request(app).put(`${base}/${lang}/${id}`).set(auth(admin)).send(body),
        action: (lang, id, action) => request(app).post(`${base}/${lang}/${id}/${action}`).set(auth(admin)),
        publishReviewed: (lang) => request(app).post(`${base}/${lang}/publish-reviewed`).set(auth(admin)),
        remove: (lang, id) => request(app).delete(`${base}/${lang}/${id}`).set(auth(admin)),
    };
};

const translateAndWait = async (admin, book, lang, chapterId, extra = {}) => {
    const res = await api(admin, book).translate(lang, { chapterId, ...extra });
    await waitForIdle();
    return res;
};

beforeAll(async () => {
    process.env.TTS_RETRY_BASE_MS = '1';
    process.env.TTS_RATE_WAIT_CAP_MS = '5';
    await db.connect();
});
beforeEach(() => {
    delete process.env.TRANSLATION_CHUNK_CHARS;
    generateContent.mockReset();
    generateContent.mockImplementation(translateMock);
    jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => {
    await waitForIdle();
    console.error.mockRestore();
    await db.clearDatabase();
});
afterAll(async () => {
    await waitForIdle();
    await db.closeDatabase();
});

describe('translationText', () => {
    it('keeps a fenced code block (with blank lines) as one block', () => {
        const blocks = splitBlocks(CHAPTER_ONE.content);
        expect(blocks).toHaveLength(6);
        expect(blocks[3]).toBe('```js\nconst total = 5000;\n\nconsole.log(total);\n```');
        const { translatable } = chapterItems(CHAPTER_ONE);
        expect(translatable).toEqual([true, true, true, true, false, false, true]);
    });

    it('chunks translatable items up to the size limit, in order', () => {
        const items = ['a'.repeat(600), 'b'.repeat(600), 'skip', 'c'.repeat(1500)];
        expect(chunkItemIndexes(items, [true, true, false, true], 1000)).toEqual([[0], [1], [3]]);
        expect(chunkItemIndexes(items, [true, true, false, true], 1300)).toEqual([[0, 1], [3]]);
    });

    it('checks numbers and naira amounts as a multiset, and restores dropped markdown markers', () => {
        expect(missingNumbers('₦5,000 for 12 months', 'Fún oṣù 12, ₦5,000')).toEqual([]);
        expect(missingNumbers('N5,000 and NGN 200', '₦5,000 àti ₦200')).toEqual([]);
        expect(missingNumbers('₦5,000 and 12', '₦5000 and 12')).toEqual(['₦5,000']);
        expect(missingNumbers('5 and 5', '5')).toEqual(['5']);
        expect(restoreLeadingMarker('## Title', 'Àkọlé')).toBe('## Àkọlé');
        expect(restoreLeadingMarker('- item', '- nkan')).toBe('- nkan');
        expect(restoreLeadingMarker('Plain', 'Ọ̀rọ̀')).toBe('Ọ̀rọ̀');
    });
});

describe('translation job', () => {
    it('dry run plans without queuing; the job writes a draft that keeps structure, code and numbers', async () => {
        const { admin, book, chapterIds } = await setup();
        const dry = await api(admin, book).translate('yo', { chapterId: 'all-missing', dryRun: true });
        expect(dry.status).toBe(200);
        expect(dry.body.chapters.map((c) => c.chapterId)).toEqual(chapterIds);
        expect(dry.body.totalRequests).toBe(2);
        expect(await BookTranslation.countDocuments()).toBe(0);

        const res = await api(admin, book).translate('yo', { chapterId: 'all-missing' });
        expect(res.status).toBe(202);
        await waitForIdle();

        // Code blocks and rules are never sent; the title is.
        expect(sentItems()).toContain('Money Basics');
        expect(sentItems().some((s) => s.includes('console.log'))).toBe(false);
        expect(sentItems()).not.toContain('---');
        // The prompt carries the house rules.
        const prompt = generateContent.mock.calls[0][0].contents;
        expect(prompt).toMatch(/Yoruba/);
        expect(prompt).toMatch(/naira amounts/);
        expect(prompt).toMatch(/Do not translate the names of people, brands/);
        expect(generateContent.mock.calls[0][0].config.responseMimeType).toBe('application/json');

        const chapter = await api(admin, book).chapter('yo', chapterIds[0]);
        expect(chapter).toMatchObject({ jobStatus: 'done', hasDraft: true, reviewStatus: 'draft', isPublished: false, isStale: false });
        expect(chapter.draft.title).toBe('MONEY BASICS');
        const blocks = splitBlocks(chapter.draft.content);
        expect(blocks).toHaveLength(splitBlocks(CHAPTER_ONE.content).length);
        expect(blocks[0]).toBe('# GETTING STARTED');
        expect(blocks[1]).toContain('₦5,000');
        expect(blocks[3]).toBe('```js\nconst total = 5000;\n\nconsole.log(total);\n```');
        expect(blocks[4]).toBe('---');
        expect(chapter.warnings).toEqual([]);

        // Nothing is visible to readers until published.
        const reader = await createUser({ role: 'reader' });
        await createPurchaseRequest({ reader, itemType: 'book', item: book._id, status: 'approved' });
        expect((await request(app).get(`/api/kenlibs/read/${book._id}/translation/yo`).set(auth(reader))).status).toBe(404);
        expect((await request(app).get(`/api/kenlibs/translations/${book._id}`).set(auth(reader))).body.languages).toEqual([]);
    });

    it('resumes a failed chapter from its saved parts, translating only the missing chunks', async () => {
        process.env.TRANSLATION_CHUNK_CHARS = '1000';
        const para = (word) => `${word} ${'word '.repeat(170)}`.trim(); // ~900 chars
        const { admin, book, chapterIds } = await setup({
            chapters: [{ title: 'Long', content: [para('Alpha'), para('Beta'), para('Gamma')].join('\n\n') }],
        });
        generateContent
            .mockImplementationOnce(translateMock)
            .mockRejectedValueOnce(Object.assign(new Error('400 INVALID_ARGUMENT'), { status: 400 }));

        await translateAndWait(admin, book, 'fr', chapterIds[0]);
        let status = (await api(admin, book).status('fr')).chapters[0];
        expect(status).toMatchObject({ jobStatus: 'failed', chunksDone: 1, chunksTotal: 3, hasDraft: false });
        expect(status.error).toMatch(/1 of 3 parts are saved/);

        generateContent.mockClear();
        await translateAndWait(admin, book, 'fr', chapterIds[0]);
        expect(generateContent).toHaveBeenCalledTimes(2); // only the 2 missing chunks
        expect(sentItems().some((s) => s.startsWith('Alpha'))).toBe(false);
        status = (await api(admin, book).status('fr')).chapters[0];
        expect(status).toMatchObject({ jobStatus: 'done', hasDraft: true });
        const { draft } = await api(admin, book).chapter('fr', chapterIds[0]);
        expect(splitBlocks(draft.content).map((b) => b.split(' ')[0])).toEqual(['ALPHA', 'BETA', 'GAMMA']);
        expect((await BookTranslation.findOne()).chapters[0].parts).toHaveLength(0);
    });

    it('a daily quota stop leaves this chapter and the queue "waiting"; translating again continues', async () => {
        const { admin, book } = await setup();
        generateContent.mockRejectedValue(quotaError('GenerateRequestsPerDayPerProjectPerModel-FreeTier'));

        await translateAndWait(admin, book, 'ha', 'all-missing');
        expect(generateContent).toHaveBeenCalledTimes(1); // stopped at once
        const { chapters, isWorking } = await api(admin, book).status('ha');
        expect(isWorking).toBe(false);
        expect(chapters.map((c) => c.jobStatus)).toEqual(['waiting', 'waiting']);
        expect(chapters[0].error).toMatch(/Daily Gemini limit reached/);

        generateContent.mockReset();
        generateContent.mockImplementation(translateMock);
        const again = await translateAndWait(admin, book, 'ha', 'all-missing');
        expect(again.body.chapters).toHaveLength(2);
        expect((await api(admin, book).status('ha')).chapters.map((c) => c.jobStatus)).toEqual(['done', 'done']);
    });

    it('waits out per-minute limits and retries a misaligned reply', async () => {
        const { admin, book, chapterIds } = await setup();
        generateContent
            .mockRejectedValueOnce(quotaError('GenerateRequestsPerMinutePerProjectPerModel-FreeTier'))
            .mockResolvedValueOnce({ text: JSON.stringify(['only one']) })
            .mockResolvedValueOnce({ text: 'not json' });
        await translateAndWait(admin, book, 'ig', chapterIds[1]);
        expect((await api(admin, book).status('ig')).chapters[1].jobStatus).toBe('done');
        expect(generateContent).toHaveBeenCalledTimes(4);
    });

    it('fails clearly (never misaligned) when Gemini keeps returning the wrong number of paragraphs', async () => {
        const { admin, book, chapterIds } = await setup();
        generateContent.mockResolvedValue({ text: JSON.stringify(['just one']) });
        await translateAndWait(admin, book, 'ig', chapterIds[0]);
        const status = (await api(admin, book).status('ig')).chapters[0];
        expect(status).toMatchObject({ jobStatus: 'failed', hasDraft: false });
        expect(status.error).toMatch(/misaligned/);
    });

    it('asks again when a number changed, and flags it for review if it still did', async () => {
        const { admin, book, chapterIds } = await setup();
        generateContent.mockImplementation(async (args) => ({
            text: JSON.stringify(inputOf(args).map((s) => upper(s).replace('₦5,000', '₦5000'))),
        }));
        await translateAndWait(admin, book, 'pcm', chapterIds[0]);
        expect(generateContent).toHaveBeenCalledTimes(2);
        const { warnings, jobStatus } = (await api(admin, book).status('pcm')).chapters[0];
        expect(jobStatus).toBe('done');
        expect(warnings).toEqual([expect.stringMatching(/Paragraph 2: check ₦5,000/)]);
    });

    it('server restart recovery fails dead runs (parts kept) and leaves live ones alone', async () => {
        const { admin, book, chapterIds } = await setup();
        await BookTranslation.create({
            bookId: book._id,
            language: 'fr',
            chapters: [
                { chapterId: chapterIds[0], jobStatus: 'translating', heartbeatAt: new Date(Date.now() - 10 * 60 * 1000) },
                { chapterId: chapterIds[1], jobStatus: 'translating', heartbeatAt: new Date() },
            ],
        });
        expect(await recoverInterruptedTranslations()).toBe(1);
        const { chapters } = await api(admin, book).status('fr');
        expect(chapters[0]).toMatchObject({ jobStatus: 'failed', error: INTERRUPTED_MESSAGE });
        expect(chapters[1].jobStatus).toBe('translating');
    });
});

describe('review and publishing', () => {
    const translated = async () => {
        const ctx = await setup();
        await translateAndWait(ctx.admin, ctx.book, 'yo', 'all-missing');
        return ctx;
    };

    it('draft → reviewed → published; only published text reaches readers with access', async () => {
        const { admin, book, chapterIds } = await translated();
        const a = api(admin, book);
        expect((await a.action('yo', chapterIds[0], 'publish')).status).toBe(409); // must be reviewed first
        expect((await a.action('yo', chapterIds[0], 'review')).status).toBe(200);
        const published = await a.action('yo', chapterIds[0], 'publish');
        expect(published.status).toBe(200);
        expect(published.body.counts).toMatchObject({ published: 1 });

        const reader = await createUser({ role: 'reader' });
        expect((await request(app).get(`/api/kenlibs/read/${book._id}/translation/yo`).set(auth(reader))).status).toBe(403);
        expect((await request(app).get(`/api/kenlibs/translations/${book._id}`).set(auth(reader))).status).toBe(403);
        await createPurchaseRequest({ reader, itemType: 'book', item: book._id, status: 'approved' });

        const languages = (await request(app).get(`/api/kenlibs/translations/${book._id}`).set(auth(reader))).body.languages;
        expect(languages).toEqual([expect.objectContaining({ code: 'yo', name: 'Yoruba', listenMode: false, publishedChapters: 1 })]);
        const res = await request(app).get(`/api/kenlibs/read/${book._id}/translation/yo`).set(auth(reader));
        expect(res.status).toBe(200);
        expect(res.body.chapters).toEqual([expect.objectContaining({ chapterId: chapterIds[0], title: 'MONEY BASICS' })]);
        expect(JSON.stringify(res.body)).not.toMatch(/draft|reviewStatus|jobStatus|SECOND/);
    });

    it('editing or re-translating a published chapter never changes what readers see until republished', async () => {
        const { admin, book, chapterIds } = await translated();
        const a = api(admin, book);
        await a.action('yo', chapterIds[0], 'review');
        await a.action('yo', chapterIds[0], 'publish');

        const edited = await a.edit('yo', chapterIds[0], { title: 'Ìpìlẹ̀ Owó', content: 'Ọ̀rọ̀ tuntun.' });
        expect(edited.status).toBe(200);
        expect(edited.body.chapters[0]).toMatchObject({ reviewStatus: 'draft', isPublished: true, hasUnpublishedChanges: true, editedByAdmin: true });

        const readerView = async () => (await request(app).get(`/api/kenlibs/read/${book._id}/translation/yo`).set(auth(admin))).body.chapters[0];
        expect((await readerView()).title).toBe('MONEY BASICS');

        // Re-translating an edited draft asks first.
        const refused = await a.translate('yo', { chapterId: chapterIds[0] });
        expect(refused.status).toBe(409);
        expect(refused.body.code).toBe('edited');
        await translateAndWait(admin, book, 'yo', chapterIds[0], { replaceEdits: true });
        expect((await a.chapter('yo', chapterIds[0])).draft.title).toBe('MONEY BASICS');
        expect((await readerView()).title).toBe('MONEY BASICS');

        await a.edit('yo', chapterIds[0], { title: 'Ìpìlẹ̀ Owó', content: 'Ọ̀rọ̀ tuntun.' });
        await a.action('yo', chapterIds[0], 'review');
        expect((await a.publishReviewed('yo')).status).toBe(200);
        expect((await readerView()).title).toBe('Ìpìlẹ̀ Owó');

        expect((await a.action('yo', chapterIds[0], 'unpublish')).status).toBe(200);
        expect((await request(app).get(`/api/kenlibs/read/${book._id}/translation/yo`).set(auth(admin))).status).toBe(404);
        expect((await a.status('yo')).chapters[0]).toMatchObject({ reviewStatus: 'reviewed', isPublished: false });
    });

    it('editing the source chapter marks the draft and the published copy out of date', async () => {
        const { admin, book, chapterIds } = await translated();
        const a = api(admin, book);
        await a.action('yo', chapterIds[0], 'review');
        await a.action('yo', chapterIds[0], 'publish');
        expect((await a.status('yo')).chapters[0]).toMatchObject({ isStale: false, isPublishedStale: false });

        await Book.updateOne({ _id: book._id, 'chapters._id': chapterIds[0] }, { $set: { 'chapters.$.content': 'Rewritten source.' } });
        expect((await a.status('yo')).chapters[0]).toMatchObject({ isStale: true, isPublishedStale: true });
        expect((await a.status('yo')).chapters[1].isStale).toBe(false);
    });

    it('the public book page lists published languages by name only; the share link has no translations', async () => {
        const { admin, book, chapterIds } = await translated();
        await api(admin, book).action('yo', chapterIds[0], 'review');
        await api(admin, book).action('yo', chapterIds[0], 'publish');
        await Book.updateOne({ _id: book._id }, { $set: { shareId: 'share-translation-test' } });

        const detail = await request(app).get(`/api/public/kenlibs/books/${book._id}`);
        expect(detail.body.translationLanguages).toEqual([{ code: 'yo', name: 'Yoruba', nativeName: 'Yorùbá' }]);
        const shared = await request(app).get('/api/public/books/share-translation-test');
        for (const body of [detail.body, shared.body]) expect(JSON.stringify(body)).not.toContain('MONEY BASICS');
    });

    it('admin endpoints are admin- and owner-only, and validate the language', async () => {
        const { book, chapterIds } = await setup();
        const reader = await createUser({ role: 'reader' });
        const otherAdmin = await createUser({ role: 'admin' });
        expect((await api(reader, book).translate('yo', { chapterId: 'all-missing' })).status).toBe(403);
        expect((await api(otherAdmin, book).translate('yo', { chapterId: 'all-missing' })).status).toBe(401);
        expect((await request(app).get(`/api/books/${book._id}/translations/yo`)).status).toBe(401);
        const { admin } = await setup();
        expect((await request(app).get(`/api/books/${book._id}/translations/xx`).set(auth(otherAdmin))).status).toBe(401);
        const ownerBook = await createBook({ userId: admin._id, chapters: [{ title: 'T', content: 'Text.' }] });
        expect((await request(app).get(`/api/books/${ownerBook._id}/translations/xx`).set(auth(admin))).status).toBe(404);
        expect(generateContent).not.toHaveBeenCalled();
        expect(chapterIds).toHaveLength(2);
    });

    it('a queued or translating chapter cannot be edited or published; deleting the book removes its translations', async () => {
        const { admin, book, chapterIds } = await setup();
        let release;
        generateContent.mockImplementationOnce((args) => new Promise((resolve) => (release = () => resolve(translateMock(args)))));
        await api(admin, book).translate('fr', { chapterId: chapterIds[0] });
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect((await api(admin, book).edit('fr', chapterIds[0], { title: 'x', content: 'y' })).status).toBe(409);
        expect((await api(admin, book).translate('fr', { chapterId: chapterIds[0] })).status).toBe(409);
        release();
        await waitForIdle();

        expect(await BookTranslation.countDocuments({ bookId: book._id })).toBe(1);
        expect((await request(app).delete(`/api/books/${book._id}`).set(auth(admin)).send({ confirmTitle: book.title, confirmPublished: true, acknowledgeBuyers: true })).status).toBe(200);
        expect(await BookTranslation.countDocuments({ bookId: book._id })).toBe(0);
    });
});
