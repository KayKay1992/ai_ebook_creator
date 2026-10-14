// Audiobook narration: admin endpoints, the background job, the daily cap,
// reader access, and that no audio URL or storage id ever reaches a public
// response. Gemini TTS and Cloudinary are mocked (same approach as
// bookTeaser.test.js / purchases.test.js); MP3 encoding is real.
jest.mock('@google/genai', () => {
    const generateContent = jest.fn();
    return {
        GoogleGenAI: jest.fn().mockImplementation(() => ({
            models: { generateContent, generateContentStream: jest.fn() },
        })),
        __generateContent: generateContent,
    };
});

// config/cloudinary is mocked (not utils/cloudinaryUpload), so the real
// uploadBufferToCloudinary runs and the options it passes are checked.
jest.mock('../config/cloudinary', () => {
    let counter = 0;
    return {
        uploader: {
            upload_stream: jest.fn((options, callback) => ({
                end: (buffer) => callback(null, { public_id: `${options.folder}/narration-${++counter}`, bytes: buffer.length }),
            })),
            destroy: jest.fn().mockResolvedValue({ result: 'ok' }),
        },
        utils: {
            private_download_url: jest.fn(
                (publicId, format, options) =>
                    `https://api.cloudinary.com/v1_1/test/video/download?public_id=${encodeURIComponent(publicId)}&format=${format}&type=${options.type}&expires_at=${options.expires_at}&signature=sig`
            ),
        },
    };
});

const request = require('supertest');
const app = require('../app');
const db = require('./dbHandler');
const Book = require('../models/Book');
const AudioUsage = require('../models/AudioUsage');
const cloudinary = require('../config/cloudinary');
const { __generateContent: generateContent } = require('@google/genai');
const { waitForIdle, recoverInterruptedJobs, INTERRUPTED_MESSAGE, kick } = require('../utils/audioJobs');
const { chargeChars } = require('../utils/audioUsage');
const { createUser, tokenFor, createBook, createPurchaseRequest } = require('./helpers');

const pcmResponse = (samples = 2400) => ({
    candidates: [
        {
            content: {
                parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: Buffer.alloc(samples * 2, 3).toString('base64') } }],
            },
        },
    ],
});

// A generateContent call that waits until released, to observe the job
// mid-flight.
const deferred = () => {
    let release;
    const promise = new Promise((resolve) => {
        release = () => resolve(pcmResponse());
    });
    return { promise, release };
};

const spokenTexts = () => generateContent.mock.calls.map(([args]) => args.contents[0].parts[0].text);

const auth = (user) => ({ Authorization: `Bearer ${tokenFor(user)}` });

const CHAPTERS = [
    { title: 'Opening', content: 'The first chapter begins here. It has a few sentences. Then it ends.' },
    { title: 'Middle', content: 'The second chapter is **important**. Read [more](https://example.com).' },
    { title: 'Empty One', content: '' },
];

const setup = async ({ chapters = CHAPTERS } = {}) => {
    const admin = await createUser({ role: 'admin' });
    const book = await createBook({ userId: admin._id, chapters, status: 'published' });
    return { admin, book, chapterIds: book.chapters.map((c) => c._id.toString()) };
};

const generate = (user, bookId, body) =>
    request(app).post(`/api/books/${bookId}/audio/generate`).set(auth(user)).send(body);

const status = async (user, bookId) => (await request(app).get(`/api/books/${bookId}/audio`).set(auth(user))).body;
const chapterStatus = async (user, bookId, chapterId) =>
    (await status(user, bookId)).chapters.find((c) => c.chapterId === chapterId);

beforeAll(async () => {
    process.env.TTS_RETRY_BASE_MS = '1';
    await db.connect();
});
beforeEach(() => {
    delete process.env.AUDIO_DAILY_CHAR_LIMIT;
    generateContent.mockReset();
    generateContent.mockResolvedValue(pcmResponse());
    cloudinary.uploader.upload_stream.mockClear();
    cloudinary.uploader.destroy.mockClear();
    cloudinary.utils.private_download_url.mockClear();
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

describe('admin-only and ownership', () => {
    it('rejects readers, other admins, and anonymous callers on every audio route', async () => {
        const { book, chapterIds } = await setup();
        const reader = await createUser({ role: 'reader' });
        const otherAdmin = await createUser({ role: 'admin' });
        const routes = [
            (u) => request(app).get(`/api/books/${book._id}/audio`).set(u ? auth(u) : {}),
            (u) => request(app).post(`/api/books/${book._id}/audio/generate`).set(u ? auth(u) : {}).send({ chapterId: chapterIds[0] }),
            (u) => request(app).post(`/api/books/${book._id}/audio/preview`).set(u ? auth(u) : {}).send({ voice: 'Kore' }),
            (u) => request(app).delete(`/api/books/${book._id}/audio/${chapterIds[0]}`).set(u ? auth(u) : {}),
        ];

        for (const route of routes) {
            expect((await route(reader)).status).toBe(403);
            expect((await route(otherAdmin)).status).toBe(401);
            expect((await route(null)).status).toBe(401);
        }
        expect(generateContent).not.toHaveBeenCalled();
        expect((await Book.findById(book._id)).audio.chapters).toHaveLength(0);
    });
});

describe('generation', () => {
    it('dry run reports characters, estimated duration and the daily budget without queuing', async () => {
        const { admin, book, chapterIds } = await setup();

        const res = await generate(admin, book._id, { chapterId: 'all-missing', voice: 'Kore', dryRun: true });

        expect(res.status).toBe(200);
        expect(res.body.dryRun).toBe(true);
        expect(res.body.chapters.map((c) => c.chapterId)).toEqual([chapterIds[0], chapterIds[1]]);
        expect(res.body.skipped).toEqual([expect.objectContaining({ chapterId: chapterIds[2] })]);
        expect(res.body.totalChars).toBe(res.body.chapters[0].charCount + res.body.chapters[1].charCount);
        expect(res.body.estimatedDurationSec).toBeGreaterThan(0);
        expect(res.body.usage).toMatchObject({ usedToday: 0, dailyLimit: 100000 });
        expect(res.body.wouldExceedLimit).toBe(false);

        await waitForIdle();
        expect(generateContent).not.toHaveBeenCalled();
        expect((await Book.findById(book._id)).audio.chapters).toHaveLength(0);
    });

    it('responds immediately with the queued state, then goes generating → ready in the background', async () => {
        const { admin, book, chapterIds } = await setup();
        const hold = deferred();
        generateContent.mockReturnValueOnce(hold.promise);

        const res = await generate(admin, book._id, { chapterId: chapterIds[0], voice: 'Charon' });

        expect(res.status).toBe(202);
        expect(res.body.totalChars).toBeGreaterThan(0);
        expect(res.body.estimatedDurationSec).toBeGreaterThan(0);
        expect(['queued', 'generating']).toContain(res.body.status.chapters[0].status);

        // Mid-flight: generating, not ready.
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect((await chapterStatus(admin, book._id, chapterIds[0])).status).toBe('generating');

        hold.release();
        await waitForIdle();

        const done = await chapterStatus(admin, book._id, chapterIds[0]);
        expect(done).toMatchObject({ status: 'ready', hasAudio: true, isStale: false, voice: 'Charon', error: '' });
        expect(done.durationSec).toBeGreaterThan(0);
        expect(done.bytes).toBeGreaterThan(0);

        // Title first, then the cleaned body (no markdown, no URL).
        expect(spokenTexts()[0]).toBe('Opening.');
        expect(spokenTexts()[1]).toBe('The first chapter begins here. It has a few sentences. Then it ends.');
        expect(generateContent.mock.calls[0][0].config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Charon');
        expect(generateContent.mock.calls[0][0].model).toBe('gemini-3.8-flash-tts');

        // Uploaded as an authenticated (not public) audio asset.
        expect(cloudinary.uploader.upload_stream).toHaveBeenCalledTimes(1);
        expect(cloudinary.uploader.upload_stream.mock.calls[0][0]).toMatchObject({
            resource_type: 'video',
            type: 'authenticated',
            format: 'mp3',
            folder: `ebook-creator/audio/${book._id}`,
        });

        const stored = (await Book.findById(book._id)).audio.chapters[0];
        expect(stored.publicId).toMatch(/^ebook-creator\/audio\//);
        expect(stored.textHash).toMatch(/^[a-f0-9]{64}$/);
        expect(stored.generatedAt).toBeInstanceOf(Date);
    });

    it('retries rate limits and transient errors, then succeeds', async () => {
        const { admin, book, chapterIds } = await setup();
        generateContent
            .mockRejectedValueOnce(Object.assign(new Error('429 RESOURCE_EXHAUSTED'), { status: 429 }))
            .mockRejectedValueOnce(Object.assign(new Error('503 UNAVAILABLE'), { status: 503 }))
            .mockResolvedValueOnce({ candidates: [{ content: { parts: [{ text: 'no audio' }] } }] });

        await generate(admin, book._id, { chapterId: chapterIds[0] });
        await waitForIdle();

        expect((await chapterStatus(admin, book._id, chapterIds[0])).status).toBe('ready');
        expect(spokenTexts().filter((t) => t === 'Opening.').length).toBeGreaterThanOrEqual(1);
        expect(generateContent.mock.calls.length).toBe(5); // 3 failed attempts + title + body
    });

    it('marks the chapter failed with a clear message on a non-retryable error, without retrying', async () => {
        const { admin, book, chapterIds } = await setup();
        generateContent.mockRejectedValue(Object.assign(new Error('400 INVALID_ARGUMENT: bad voice'), { status: 400 }));

        await generate(admin, book._id, { chapterId: chapterIds[0] });
        await waitForIdle();

        const failed = await chapterStatus(admin, book._id, chapterIds[0]);
        expect(failed).toMatchObject({ status: 'failed', hasAudio: false });
        expect(failed.error).toMatch(/INVALID_ARGUMENT/);
        expect(generateContent.mock.calls.length).toBeLessThanOrEqual(2); // title and body may both start (concurrency 2)
        expect(cloudinary.uploader.upload_stream).not.toHaveBeenCalled();
    });

    it('"all missing": skips empty chapters, keeps existing audio, and a failure does not stop the rest', async () => {
        const { admin, book, chapterIds } = await setup({
            chapters: [
                { title: 'Has Audio', content: 'Already narrated.' },
                { title: 'Breaks', content: 'FAILME please.' },
                { title: 'Empty', content: '' },
                { title: 'Works', content: 'This one is fine.' },
            ],
        });
        await generate(admin, book._id, { chapterId: chapterIds[0] });
        await waitForIdle();
        generateContent.mockClear();
        generateContent.mockImplementation(async ({ contents }) => {
            if (contents[0].parts[0].text.includes('FAILME')) throw Object.assign(new Error('400 bad input'), { status: 400 });
            return pcmResponse();
        });

        const res = await generate(admin, book._id, { chapterId: 'all-missing' });
        expect(res.status).toBe(202);
        expect(res.body.chapters.map((c) => c.title)).toEqual(['Breaks', 'Works']);
        expect(res.body.skipped.map((c) => c.title)).toEqual(['Empty']);
        await waitForIdle();

        const { chapters } = await status(admin, book._id);
        expect(chapters.map((c) => c.status)).toEqual(['ready', 'failed', 'skipped', 'ready']);
        expect(chapters[2].error).toMatch(/no text to narrate/);
        expect(spokenTexts()).not.toContain('Already narrated.');
    });

    it('refuses a chapter that is already queued or generating', async () => {
        const { admin, book, chapterIds } = await setup();
        const hold = deferred();
        generateContent.mockReturnValueOnce(hold.promise);
        await generate(admin, book._id, { chapterId: chapterIds[0] });

        const again = await generate(admin, book._id, { chapterId: chapterIds[0] });
        expect(again.status).toBe(409);
        hold.release();
    });

    it('validates the voice and chapter', async () => {
        const { admin, book } = await setup();
        expect((await generate(admin, book._id, { chapterId: 'all-missing', voice: 'Nope' })).status).toBe(400);
        expect((await generate(admin, book._id, {})).status).toBe(400);
        expect((await generate(admin, book._id, { chapterId: '64b000000000000000000000' })).status).toBe(404);
    });

    it('detects out-of-date audio via the text hash after the chapter is edited', async () => {
        const { admin, book, chapterIds } = await setup();
        await generate(admin, book._id, { chapterId: chapterIds[0] });
        await waitForIdle();
        expect((await chapterStatus(admin, book._id, chapterIds[0])).isStale).toBe(false);

        // The editor saves the whole book (with chapter _ids preserved).
        const loaded = (await request(app).get(`/api/books/${book._id}`).set(auth(admin))).body;
        expect(loaded.audio).toBeUndefined();
        loaded.chapters[1].content = 'Edited a different chapter.';
        await request(app).put(`/api/books/${book._id}`).set(auth(admin)).send(loaded);
        expect((await chapterStatus(admin, book._id, chapterIds[0])).isStale).toBe(false);

        loaded.chapters[0].content = 'The first chapter was rewritten.';
        await request(app).put(`/api/books/${book._id}`).set(auth(admin)).send(loaded);
        const stale = await chapterStatus(admin, book._id, chapterIds[0]);
        expect(stale).toMatchObject({ status: 'ready', hasAudio: true, isStale: true });
    });

    it('a whole-book PUT from the editor can never overwrite audio state', async () => {
        const { admin, book, chapterIds } = await setup();
        await generate(admin, book._id, { chapterId: chapterIds[0] });
        await waitForIdle();

        await request(app)
            .put(`/api/books/${book._id}`)
            .set(auth(admin))
            .send({ title: 'Renamed', audio: { voice: 'Puck', chapters: [] } });

        const stored = await Book.findById(book._id);
        expect(stored.title).toBe('Renamed');
        expect(stored.audio.chapters).toHaveLength(1);
        expect(stored.audio.chapters[0].publicId).toBeTruthy();
    });
});

describe('daily character cap', () => {
    it('refuses a run that would exceed AUDIO_DAILY_CHAR_LIMIT, with the numbers, and queues nothing', async () => {
        process.env.AUDIO_DAILY_CHAR_LIMIT = '50';
        const { admin, book } = await setup();

        const dry = await generate(admin, book._id, { chapterId: 'all-missing', dryRun: true });
        expect(dry.body.wouldExceedLimit).toBe(true);

        const res = await generate(admin, book._id, { chapterId: 'all-missing' });
        expect(res.status).toBe(429);
        expect(res.body.message).toMatch(/characters/);
        expect(res.body.usage).toMatchObject({ dailyLimit: 50, remaining: 50 });
        await waitForIdle();
        expect(generateContent).not.toHaveBeenCalled();
        expect((await Book.findById(book._id)).audio.chapters).toHaveLength(0);
    });

    it('counts generated characters and fails a chapter that starts after the cap is used up', async () => {
        const { admin, book, chapterIds } = await setup();
        await generate(admin, book._id, { chapterId: chapterIds[0] });
        await waitForIdle();
        const used = (await AudioUsage.findOne({})).chars;
        expect(used).toBe((await chapterStatus(admin, book._id, chapterIds[0])).charCount);

        // Queue under the cap, then someone else uses it up before it starts.
        process.env.AUDIO_DAILY_CHAR_LIMIT = String(used + 200);
        const hold = deferred();
        generateContent.mockReturnValueOnce(hold.promise);
        const otherBook = await createBook({ userId: admin._id, chapters: [{ title: 'Other', content: 'Other text here.' }] });
        await generate(admin, otherBook._id, { chapterId: otherBook.chapters[0]._id.toString() });
        await generate(admin, book._id, { chapterId: chapterIds[1] });
        await AudioUsage.updateOne({}, { $inc: { chars: 200 } });
        hold.release();
        await waitForIdle();

        const capped = await chapterStatus(admin, book._id, chapterIds[1]);
        expect(capped.status).toBe('failed');
        expect(capped.error).toMatch(/Daily narration limit reached/);
    });

    it('chargeChars is atomic against the limit', async () => {
        process.env.AUDIO_DAILY_CHAR_LIMIT = '100';
        expect((await chargeChars(60)).ok).toBe(true);
        expect((await chargeChars(60)).ok).toBe(false);
        expect((await chargeChars(40)).ok).toBe(true);
        expect((await AudioUsage.findOne({})).chars).toBe(100);
    });
});

describe('cleanup', () => {
    it('regenerating replaces the file and deletes the old asset', async () => {
        const { admin, book, chapterIds } = await setup();
        await generate(admin, book._id, { chapterId: chapterIds[0] });
        await waitForIdle();
        const first = (await Book.findById(book._id)).audio.chapters[0].publicId;

        await generate(admin, book._id, { chapterId: chapterIds[0] });
        await waitForIdle();
        const second = (await Book.findById(book._id)).audio.chapters[0].publicId;

        expect(second).not.toBe(first);
        expect(cloudinary.uploader.destroy).toHaveBeenCalledWith(first, expect.objectContaining({ resource_type: 'video', type: 'authenticated' }));
    });

    it('a failed regeneration keeps the previous audio playable', async () => {
        const { admin, book, chapterIds } = await setup();
        await generate(admin, book._id, { chapterId: chapterIds[0] });
        await waitForIdle();
        const first = (await Book.findById(book._id)).audio.chapters[0].publicId;

        generateContent.mockRejectedValue(Object.assign(new Error('400 bad'), { status: 400 }));
        await generate(admin, book._id, { chapterId: chapterIds[0] });
        await waitForIdle();

        const entry = (await Book.findById(book._id)).audio.chapters[0];
        expect(entry.status).toBe('failed');
        expect(entry.publicId).toBe(first);
        expect(cloudinary.uploader.destroy).not.toHaveBeenCalled();
    });

    it('DELETE removes the file and the status; a generating chapter must finish first', async () => {
        const { admin, book, chapterIds } = await setup();
        await generate(admin, book._id, { chapterId: chapterIds[0] });
        await waitForIdle();
        const publicId = (await Book.findById(book._id)).audio.chapters[0].publicId;

        const hold = deferred();
        generateContent.mockReturnValueOnce(hold.promise);
        await generate(admin, book._id, { chapterId: chapterIds[1] });
        await new Promise((resolve) => setTimeout(resolve, 50));
        const busy = await request(app).delete(`/api/books/${book._id}/audio/${chapterIds[1]}`).set(auth(admin));
        expect(busy.status).toBe(409);
        hold.release();

        const res = await request(app).delete(`/api/books/${book._id}/audio/${chapterIds[0]}`).set(auth(admin));
        expect(res.status).toBe(200);
        expect(cloudinary.uploader.destroy).toHaveBeenCalledWith(publicId, expect.anything());
        expect(res.body.chapters[0]).toMatchObject({ status: 'none', hasAudio: false });
        expect((await request(app).delete(`/api/books/${book._id}/audio/${chapterIds[0]}`).set(auth(admin))).status).toBe(404);
    });

    it('deleting a queued chapter cancels it before it runs', async () => {
        const { admin, book, chapterIds } = await setup();
        const hold = deferred();
        generateContent.mockReturnValueOnce(hold.promise);
        await generate(admin, book._id, { chapterId: chapterIds[0] });
        await generate(admin, book._id, { chapterId: chapterIds[1] });

        const res = await request(app).delete(`/api/books/${book._id}/audio/${chapterIds[1]}`).set(auth(admin));
        expect(res.status).toBe(200);
        hold.release();
        await waitForIdle();

        expect(spokenTexts().some((t) => t.includes('second chapter'))).toBe(false);
        expect((await chapterStatus(admin, book._id, chapterIds[1])).status).toBe('none');
    });

    it('deleting the book deletes all of its audio files', async () => {
        const { admin, book, chapterIds } = await setup();
        await generate(admin, book._id, { chapterId: 'all-missing' });
        await waitForIdle();
        const publicIds = (await Book.findById(book._id)).audio.chapters.map((e) => e.publicId).filter(Boolean);
        expect(publicIds).toHaveLength(2);

        const res = await request(app).delete(`/api/books/${book._id}`).set(auth(admin));
        expect(res.status).toBe(200);
        await new Promise((resolve) => setTimeout(resolve, 20));
        const destroyed = cloudinary.uploader.destroy.mock.calls.map(([id]) => id);
        expect(destroyed).toEqual(expect.arrayContaining(publicIds));
        expect(chapterIds).toHaveLength(3);
    });
});

describe('restart recovery', () => {
    it('marks interrupted chapters failed and resumes queued ones', async () => {
        const { admin, book, chapterIds } = await setup();
        await Book.updateOne(
            { _id: book._id },
            {
                $set: {
                    'audio.chapters': [
                        { chapterId: chapterIds[0], status: 'generating', progress: 0.5 },
                        { chapterId: chapterIds[1], status: 'queued', charCount: 50, queuedAt: new Date() },
                    ],
                },
            }
        );

        expect(await recoverInterruptedJobs()).toBe(1);
        await waitForIdle();

        const { chapters } = await status(admin, book._id);
        expect(chapters[0]).toMatchObject({ status: 'failed', error: INTERRUPTED_MESSAGE });
        expect(chapters[1].status).toBe('ready');
    });
});

describe('voice preview', () => {
    it('speaks only the first sentence and returns MP3 audio without storing anything', async () => {
        const { admin, book } = await setup();

        const res = await request(app)
            .post(`/api/books/${book._id}/audio/preview`)
            .set(auth(admin))
            .send({ voice: 'Puck' })
            .buffer(true)
            .parse((response, callback) => {
                const chunks = [];
                response.on('data', (chunk) => chunks.push(chunk));
                response.on('end', () => callback(null, Buffer.concat(chunks)));
            });

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/audio\/mpeg/);
        expect(res.body[0]).toBe(0xff);
        expect(spokenTexts()).toEqual(['The first chapter begins here.']);
        expect(cloudinary.uploader.upload_stream).not.toHaveBeenCalled();
        expect((await AudioUsage.findOne({})).chars).toBe('The first chapter begins here.'.length);
    });
});

describe('reader access', () => {
    const narrate = async () => {
        const ctx = await setup();
        await generate(ctx.admin, ctx.book._id, { chapterId: 'all-missing' });
        await waitForIdle();
        return ctx;
    };

    it('403 without access, signed short-lived URLs with access, admins always', async () => {
        const { admin, book, chapterIds } = await narrate();
        const reader = await createUser({ role: 'reader' });

        const denied = await request(app).get(`/api/kenlibs/audio/${book._id}`).set(auth(reader));
        expect(denied.status).toBe(403);
        expect(JSON.stringify(denied.body)).not.toMatch(/cloudinary|narration-/);

        await createPurchaseRequest({ reader, itemType: 'book', item: book._id, status: 'approved' });
        const res = await request(app).get(`/api/kenlibs/audio/${book._id}`).set(auth(reader));
        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toBe('no-store');
        expect(res.body.chapters.map((c) => c.chapterId)).toEqual([chapterIds[0], chapterIds[1]]);
        const [first] = res.body.chapters;
        expect(first).toMatchObject({ chapterIndex: 0, title: 'Opening' });
        expect(first.durationSec).toBeGreaterThan(0);
        expect(first.url).toMatch(/^https:\/\/api\.cloudinary\.com\/.*type=authenticated.*expires_at=\d+/);
        const ttl = (new Date(first.expiresAt).getTime() - Date.now()) / 1000;
        expect(ttl).toBeGreaterThan(3500);
        expect(ttl).toBeLessThanOrEqual(3600);
        expect(first.publicId).toBeUndefined();

        expect((await request(app).get(`/api/kenlibs/audio/${book._id}`).set(auth(admin))).status).toBe(200);
    });

    it('404 when the book has no audio or does not exist', async () => {
        const { admin, book } = await setup();
        expect((await request(app).get(`/api/kenlibs/audio/${book._id}`).set(auth(admin))).status).toBe(404);
        expect((await request(app).get('/api/kenlibs/audio/64b000000000000000000000').set(auth(admin))).status).toBe(404);
        expect((await request(app).get('/api/kenlibs/audio/not-an-id').set(auth(admin))).status).toBe(404);
    });

    it('requires login', async () => {
        const { book } = await setup();
        expect((await request(app).get(`/api/kenlibs/audio/${book._id}`)).status).toBe(401);
    });

    it('public endpoints expose only hasAudio and a count, never URLs or storage ids', async () => {
        const { book } = await narrate();
        const publicIds = (await Book.findById(book._id)).audio.chapters.map((e) => e.publicId).filter(Boolean);
        const shareId = 'share-audio-test';
        await Book.updateOne({ _id: book._id }, { $set: { shareId } });
        const reader = await createUser({ role: 'reader' });
        await createPurchaseRequest({ reader, itemType: 'book', item: book._id, status: 'approved' });

        const detail = await request(app).get(`/api/public/kenlibs/books/${book._id}`);
        expect(detail.status).toBe(200);
        expect(detail.body).toMatchObject({ hasAudio: true, audioChapterCount: 2 });
        expect(detail.body.audio).toBeUndefined();
        expect(detail.body.chapters).toBeUndefined();

        const storefront = await request(app).get('/api/public/kenlibs');
        const listed = storefront.body.books.find((b) => b._id === book._id.toString());
        expect(listed).toMatchObject({ hasAudio: true, audioChapterCount: 2 });
        expect(listed.audio).toBeUndefined();

        const responses = [
            detail,
            storefront,
            await request(app).get(`/api/public/books/${shareId}`),
            await request(app).get(`/api/kenlibs/read/${book._id}`).set(auth(reader)),
            await request(app)
                .get(`/kenlibs/book/${book._id}`)
                .set('User-Agent', 'facebookexternalhit/1.1'),
        ];
        for (const response of responses) {
            const body = typeof response.body === 'object' && Object.keys(response.body).length ? JSON.stringify(response.body) : response.text;
            for (const id of publicIds) expect(body).not.toContain(id);
            expect(body).not.toMatch(/api\.cloudinary\.com|ebook-creator\/audio/);
        }
    });

    it('a book without audio shows hasAudio false', async () => {
        const { book } = await setup();
        const detail = await request(app).get(`/api/public/kenlibs/books/${book._id}`);
        expect(detail.body).toMatchObject({ hasAudio: false, audioChapterCount: 0 });
    });
});

describe('worker', () => {
    it('kick() with nothing queued resolves quietly', async () => {
        await kick();
        expect(generateContent).not.toHaveBeenCalled();
    });
});
