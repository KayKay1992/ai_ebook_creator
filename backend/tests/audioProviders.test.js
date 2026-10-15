// Narration providers (Gemini / local Kokoro), chunk-level resume, Gemini
// quota handling, uploaded MP3s, and the claim/heartbeat rules that let
// scripts/narrate-book.js and the server share book.audio. Gemini,
// Cloudinary and the Kokoro model are mocked; chunking, MP3 encoding,
// MP3 parsing and the pipeline are real.
jest.mock('@google/genai', () => {
    const generateContent = jest.fn();
    return {
        GoogleGenAI: jest.fn().mockImplementation(() => ({ models: { generateContent } })),
        __generateContent: generateContent,
    };
});

// Keeps every uploaded buffer, so resumed runs can download their parts.
jest.mock('../config/cloudinary', () => {
    let counter = 0;
    const stored = new Map();
    return {
        __stored: stored,
        uploader: {
            upload_stream: jest.fn((options, callback) => ({
                end: (buffer) => {
                    const publicId = `${options.folder}/a-${++counter}`;
                    stored.set(publicId, buffer);
                    callback(null, { public_id: publicId, bytes: buffer.length });
                },
            })),
            destroy: jest.fn(async (publicId) => {
                stored.delete(publicId);
                return { result: 'ok' };
            }),
        },
        utils: {
            private_download_url: jest.fn(
                (publicId, format, options) =>
                    `https://api.cloudinary.com/download?public_id=${encodeURIComponent(publicId)}&type=${options.type}&expires_at=${options.expires_at}`
            ),
        },
    };
});

// A stand-in for Kokoro: 0.1s of a fixed tone per sentence group.
jest.mock('../utils/kokoroEngine', () => {
    const spoken = [];
    class FakeSplitter {
        push(text) {
            this.text = text;
        }
        close() {}
    }
    const tts = {
        stream: async function* (splitter, { voice }) {
            spoken.push({ text: splitter.text, voice });
            yield { text: splitter.text, audio: { audio: new Float32Array(2400).fill(0.1), sampling_rate: 24000 } };
        },
    };
    class LocalTtsUnavailableError extends Error {}
    return {
        __spoken: spoken,
        LocalTtsUnavailableError,
        getEngine: jest.fn(async () => ({ tts, TextSplitterStream: FakeSplitter, dtype: 'fp32' })),
        engineKey: () => 'kokoro-test',
    };
});

const request = require('supertest');
const app = require('../app');
const db = require('./dbHandler');
const Book = require('../models/Book');
const AudioUsage = require('../models/AudioUsage');
const cloudinary = require('../config/cloudinary');
const kokoro = require('../utils/kokoroEngine');
const { __generateContent: generateContent } = require('@google/genai');
const { waitForIdle, recoverInterruptedJobs } = require('../utils/audioJobs');
const { claimChapter, narrateClaimedChapter, INTERRUPTED_MESSAGE } = require('../utils/narrationPipeline');
const { getProvider } = require('../utils/narrationProviders');
const { parseQuotaError, DAILY_QUOTA_MESSAGE } = require('../utils/tts');
const { encodeMp3 } = require('../utils/audioEncoding');
const { readMp3Info } = require('../utils/mp3Info');
const { chapterNarration, splitIntoChunks } = require('../utils/narrationText');
const { createUser, tokenFor, createBook } = require('./helpers');

const pcmResponse = (samples = 2400) => ({
    candidates: [
        {
            content: {
                parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: Buffer.alloc(samples * 2, 3).toString('base64') } }],
            },
        },
    ],
});

const quotaError = (quotaId, retryDelay = '0s') =>
    Object.assign(
        new Error(
            JSON.stringify({
                error: {
                    code: 429,
                    status: 'RESOURCE_EXHAUSTED',
                    message: 'You exceeded your current quota, please check your plan and billing details.',
                    details: [
                        {
                            '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
                            violations: [{ quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests', quotaId }],
                        },
                        { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay },
                    ],
                },
            })
        ),
        { status: 429 }
    );
const PER_DAY = 'GenerateRequestsPerDayPerProjectPerModel-FreeTier';
const PER_MINUTE = 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier';

const spokenTexts = () => generateContent.mock.calls.map(([args]) => args.contents[0].parts[0].text);
const auth = (user) => ({ Authorization: `Bearer ${tokenFor(user)}` });

// Two ~1,000-character paragraphs: title + 2 body chunks = 3 parts.
const paragraph = (word) => Array.from({ length: 100 }, (_, i) => `${word} sentence ${i}.`).join(' ').slice(0, 1000);
const LONG_CHAPTER = { title: 'Long', content: `${paragraph('Alpha')}\n\n${paragraph('Beta')}` };

const setup = async ({ chapters = [LONG_CHAPTER, { title: 'Short', content: 'A short chapter.' }] } = {}) => {
    const admin = await createUser({ role: 'admin' });
    const book = await createBook({ userId: admin._id, chapters, status: 'published' });
    return { admin, book, chapterIds: book.chapters.map((c) => c._id.toString()) };
};

const generate = (user, bookId, body) => request(app).post(`/api/books/${bookId}/audio/generate`).set(auth(user)).send(body);
const status = async (user, bookId) => (await request(app).get(`/api/books/${bookId}/audio`).set(auth(user))).body;
const entryOf = async (bookId, chapterId) =>
    (await Book.findById(bookId)).audio.chapters.find((e) => e.chapterId.toString() === chapterId);
const uploadsTo = (suffix) =>
    cloudinary.uploader.upload_stream.mock.calls.filter(([options]) => options.folder.endsWith(suffix)).length;

let fetchSpy;
beforeAll(async () => {
    process.env.TTS_RETRY_BASE_MS = '1';
    process.env.TTS_RATE_WAIT_CAP_MS = '5';
    await db.connect();
});
beforeEach(() => {
    delete process.env.AUDIO_PROVIDER;
    delete process.env.AUDIO_TTS_CONCURRENCY;
    delete process.env.AUDIO_TTS_MIN_INTERVAL_MS;
    delete process.env.AUDIO_DAILY_CHAR_LIMIT;
    generateContent.mockReset();
    generateContent.mockResolvedValue(pcmResponse());
    cloudinary.uploader.upload_stream.mockClear();
    cloudinary.uploader.destroy.mockClear();
    kokoro.__spoken.length = 0;
    // Parts from earlier runs are downloaded through their signed URL.
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
        const publicId = decodeURIComponent(/public_id=([^&]+)/.exec(String(url))[1]);
        const buffer = cloudinary.__stored.get(publicId);
        return buffer
            ? { ok: true, status: 200, arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.length) }
            : { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
    });
    jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => {
    await waitForIdle();
    fetchSpy.mockRestore();
    console.error.mockRestore();
    await db.clearDatabase();
});
afterAll(async () => {
    await waitForIdle();
    await db.closeDatabase();
});

describe('provider switch', () => {
    it('defaults to Gemini: its voices, model, and quota charging', async () => {
        const { admin, book } = await setup();
        const body = await status(admin, book._id);
        expect(body.provider).toEqual({ name: 'gemini', label: 'Gemini', chargesQuota: true });
        expect(body.defaultVoice).toBe('Sulafat');
        expect(body.voices.map((v) => v.name)).toContain('Kore');
        expect(body.model).toBe('gemini-3.8-flash-tts');
    });

    it('AUDIO_PROVIDER=local narrates with Kokoro: no Gemini calls, no quota charged, source "local"', async () => {
        process.env.AUDIO_PROVIDER = 'local';
        const { admin, book, chapterIds } = await setup();

        const body = await status(admin, book._id);
        expect(body.provider).toMatchObject({ name: 'local', chargesQuota: false });
        expect(body.voice).toBe('af_heart'); // the book's saved Gemini voice doesn't apply
        expect(body.voices.map((v) => v.name)).toEqual(expect.arrayContaining(['af_heart', 'bm_george']));

        expect((await generate(admin, book._id, { chapterId: chapterIds[1], voice: 'Kore' })).status).toBe(400);
        const res = await generate(admin, book._id, { chapterId: chapterIds[1], voice: 'bf_emma' });
        expect(res.status).toBe(202);
        await waitForIdle();

        const entry = await entryOf(book._id, chapterIds[1]);
        expect(entry).toMatchObject({ status: 'ready', source: 'local', voice: 'bf_emma', chunksDone: 2, chunksTotal: 2 });
        expect(entry.textHash).toMatch(/^[a-f0-9]{64}$/);
        expect(entry.durationSec).toBeGreaterThan(0);
        expect(entry.parts).toHaveLength(0);
        expect(kokoro.__spoken.map((s) => s.text)).toEqual(['Short.', 'A short chapter.']);
        expect(kokoro.__spoken.every((s) => s.voice === 'bf_emma')).toBe(true);
        expect(generateContent).not.toHaveBeenCalled();
        expect(await AudioUsage.findOne({})).toBeNull();

        // Readers get it like any other audio.
        expect((await status(admin, book._id)).chapters[1]).toMatchObject({ hasAudio: true, source: 'local' });
    });

    it('local runs never trip the daily character cap', async () => {
        process.env.AUDIO_PROVIDER = 'local';
        process.env.AUDIO_DAILY_CHAR_LIMIT = '10';
        const { admin, book } = await setup();
        const dry = await generate(admin, book._id, { chapterId: 'all-missing', dryRun: true });
        expect(dry.body.wouldExceedLimit).toBe(false);
        expect((await generate(admin, book._id, { chapterId: 'all-missing' })).status).toBe(202);
        await waitForIdle();
        expect((await status(admin, book._id)).chapters.map((c) => c.status)).toEqual(['ready', 'ready']);
    });

    it('an unknown AUDIO_PROVIDER falls back to Gemini', () => {
        process.env.AUDIO_PROVIDER = 'parrot';
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        expect(getProvider().name).toBe('gemini');
        console.warn.mockRestore();
        expect(() => getProvider('parrot')).toThrow(/Unknown narration provider/);
    });
});

describe('chunk-level resume', () => {
    it('a failed run keeps finished parts; generating again only makes the missing ones', async () => {
        const { admin, book, chapterIds } = await setup();
        const { body, text } = chapterNarration(LONG_CHAPTER);
        const [chunk1, chunk2] = splitIntoChunks(body);
        expect(splitIntoChunks(body)).toHaveLength(2);

        generateContent
            .mockResolvedValueOnce(pcmResponse())
            .mockResolvedValueOnce(pcmResponse())
            .mockRejectedValueOnce(Object.assign(new Error('400 INVALID_ARGUMENT'), { status: 400 }));
        await generate(admin, book._id, { chapterId: chapterIds[0] });
        await waitForIdle();

        const failed = (await status(admin, book._id)).chapters[0];
        expect(failed).toMatchObject({ status: 'failed', chunksDone: 2, chunksTotal: 3, hasAudio: false });
        expect(failed.error).toMatch(/2 of 3 parts are saved/);
        expect((await entryOf(book._id, chapterIds[0])).parts.map((p) => p.index)).toEqual([0, 1]);
        expect((await AudioUsage.findOne({})).chars).toBe(text.length);

        generateContent.mockClear();
        await generate(admin, book._id, { chapterId: chapterIds[0] });
        await waitForIdle();

        expect(spokenTexts()).toEqual([chunk2]); // only the missing chunk
        const entry = await entryOf(book._id, chapterIds[0]);
        expect(entry).toMatchObject({ status: 'ready', chunksDone: 3, chunksTotal: 3 });
        expect(entry.parts).toHaveLength(0);
        // Charged only for what it still had to make.
        expect((await AudioUsage.findOne({})).chars).toBe(text.length + chunk2.length);
        // The assembled file is all three parts in order: valid MP3, full length.
        const assembled = cloudinary.__stored.get(entry.publicId);
        expect(assembled.length).toBe(entry.bytes);
        expect(readMp3Info(assembled).durationSec).toBeCloseTo(entry.durationSec, 0);
        // Parts are cleaned up once assembled.
        const partIds = [...cloudinary.__stored.keys()].filter((id) => id.includes('/parts/'));
        expect(partIds).toHaveLength(0);
        expect(chunk1).toContain('Alpha');
    });

    it('a part whose text changed is discarded and remade', async () => {
        const { admin, book, chapterIds } = await setup();
        generateContent
            .mockResolvedValueOnce(pcmResponse())
            .mockResolvedValueOnce(pcmResponse())
            .mockRejectedValueOnce(Object.assign(new Error('400 bad'), { status: 400 }));
        await generate(admin, book._id, { chapterId: chapterIds[0] });
        await waitForIdle();
        const oldParts = (await entryOf(book._id, chapterIds[0])).parts.map((p) => p.publicId);

        // Edit the first paragraph: the title part still matches, chunk 1 doesn't.
        await Book.updateOne({ _id: book._id, 'chapters._id': chapterIds[0] }, { $set: { 'chapters.$.content': `${paragraph('Gamma')}\n\n${paragraph('Beta')}` } });
        generateContent.mockClear();
        await generate(admin, book._id, { chapterId: chapterIds[0] });
        await waitForIdle();

        expect(spokenTexts()).toHaveLength(2);
        expect(spokenTexts()[0]).toContain('Gamma');
        expect(cloudinary.uploader.destroy).toHaveBeenCalledWith(oldParts[1], expect.anything());
        expect((await entryOf(book._id, chapterIds[0])).status).toBe('ready');
    });

    it('a different voice starts over instead of mixing voices', async () => {
        const { admin, book, chapterIds } = await setup();
        generateContent.mockResolvedValueOnce(pcmResponse()).mockRejectedValueOnce(Object.assign(new Error('400 bad'), { status: 400 }));
        await generate(admin, book._id, { chapterId: chapterIds[0], voice: 'Kore' });
        await waitForIdle();
        generateContent.mockClear();
        await generate(admin, book._id, { chapterId: chapterIds[0], voice: 'Puck' });
        await waitForIdle();
        expect(spokenTexts()).toHaveLength(3);
    });

    it('deleting an unfinished chapter deletes its saved parts', async () => {
        const { admin, book, chapterIds } = await setup();
        generateContent.mockResolvedValueOnce(pcmResponse()).mockRejectedValueOnce(Object.assign(new Error('400 bad'), { status: 400 }));
        await generate(admin, book._id, { chapterId: chapterIds[0] });
        await waitForIdle();
        const [part] = (await entryOf(book._id, chapterIds[0])).parts;

        const res = await request(app).delete(`/api/books/${book._id}/audio/${chapterIds[0]}`).set(auth(admin));
        expect(res.status).toBe(200);
        expect(cloudinary.uploader.destroy).toHaveBeenCalledWith(part.publicId, expect.anything());
    });
});

describe('Gemini quota handling', () => {
    it('reads quota details from the error body', () => {
        expect(parseQuotaError(quotaError(PER_DAY, '20s'))).toMatchObject({ kind: 'daily', retryAfterMs: 20000, quotaId: expect.stringContaining('PerDay') });
        expect(parseQuotaError(quotaError(PER_MINUTE, '39s'))).toMatchObject({ kind: 'minute', retryAfterMs: 39000 });
        expect(parseQuotaError(Object.assign(new Error('429 RESOURCE_EXHAUSTED'), { status: 429 }))).toMatchObject({ kind: 'unknown', retryAfterMs: null });
        expect(parseQuotaError(Object.assign(new Error('400 bad'), { status: 400 }))).toBeNull();
    });

    it('waits out per-minute limits and continues, without using up retries', async () => {
        const { admin, book, chapterIds } = await setup();
        // More per-minute errors in a row than the normal retry budget (4).
        for (let i = 0; i < 6; i++) generateContent.mockRejectedValueOnce(quotaError(PER_MINUTE, '0s'));
        await generate(admin, book._id, { chapterId: chapterIds[1] });
        await waitForIdle();
        expect((await status(admin, book._id)).chapters[1]).toMatchObject({ status: 'ready', error: '' });
        expect(generateContent).toHaveBeenCalledTimes(8); // 6 waits + title + body
    });

    it('a daily limit stops at once: the chapter and the rest of the queue wait for quota, not fail', async () => {
        const { admin, book, chapterIds } = await setup();
        generateContent.mockResolvedValueOnce(pcmResponse()).mockRejectedValue(quotaError(PER_DAY));

        await generate(admin, book._id, { chapterId: 'all-missing' });
        await waitForIdle();

        expect(generateContent).toHaveBeenCalledTimes(2); // never retried
        const { chapters, isWorking } = await status(admin, book._id);
        expect(isWorking).toBe(false);
        expect(chapters.map((c) => c.status)).toEqual(['waiting', 'waiting']);
        expect(chapters[0]).toMatchObject({ chunksDone: 1, chunksTotal: 3, error: DAILY_QUOTA_MESSAGE });
        expect(chapters[1].error).toBe(DAILY_QUOTA_MESSAGE);
        expect(DAILY_QUOTA_MESSAGE).toMatch(/Daily Gemini limit reached.*local narration/);

        // After the reset: "Generate all missing" picks both up again and
        // the first continues from its saved part.
        generateContent.mockReset();
        generateContent.mockResolvedValue(pcmResponse());
        const again = await generate(admin, book._id, { chapterId: 'all-missing' });
        expect(again.body.chapters).toHaveLength(2);
        await waitForIdle();
        expect((await status(admin, book._id)).chapters.map((c) => c.status)).toEqual(['ready', 'ready']);
        expect(generateContent).toHaveBeenCalledTimes(2 + 2); // 2 missing parts of chapter 1 + chapter 2
    });

    it('defaults to one request at a time; AUDIO_TTS_CONCURRENCY raises it', async () => {
        const { admin, book, chapterIds } = await setup();
        let inFlight = 0;
        let maxInFlight = 0;
        generateContent.mockImplementation(async () => {
            maxInFlight = Math.max(maxInFlight, ++inFlight);
            await new Promise((resolve) => setTimeout(resolve, 15));
            inFlight -= 1;
            return pcmResponse();
        });
        await generate(admin, book._id, { chapterId: chapterIds[0] });
        await waitForIdle();
        expect(maxInFlight).toBe(1);

        process.env.AUDIO_TTS_CONCURRENCY = '3';
        maxInFlight = 0;
        await generate(admin, book._id, { chapterId: chapterIds[0] });
        await waitForIdle();
        expect(maxInFlight).toBe(3);
    });

    it('AUDIO_TTS_MIN_INTERVAL_MS spaces requests out', async () => {
        process.env.AUDIO_TTS_MIN_INTERVAL_MS = '60';
        const { admin, book, chapterIds } = await setup();
        const startedAt = [];
        generateContent.mockImplementation(async () => {
            startedAt.push(Date.now());
            return pcmResponse();
        });
        await generate(admin, book._id, { chapterId: chapterIds[0] });
        await waitForIdle();
        expect(startedAt).toHaveLength(3);
        for (let i = 1; i < startedAt.length; i++) expect(startedAt[i] - startedAt[i - 1]).toBeGreaterThanOrEqual(55);
    });
});

describe('uploaded audio', () => {
    let mp3;
    beforeAll(async () => {
        // 3 seconds of real MP3 from the app's own encoder.
        ({ buffer: mp3 } = await encodeMp3([new Int16Array(24000 * 3).fill(500)], { sampleRate: 24000 }));
    });

    const upload = (user, bookId, chapterId, buffer = mp3, filename = 'chapter.mp3', contentType = 'audio/mpeg') => {
        const req = request(app).post(`/api/books/${bookId}/audio/${chapterId}/upload`);
        if (user) req.set(auth(user));
        return req.attach('audio', buffer, { filename, contentType });
    };

    it('attaches an MP3 as ready audio with source "uploaded", its real duration, stored authenticated', async () => {
        const { admin, book, chapterIds } = await setup();
        const res = await upload(admin, book._id, chapterIds[1]);
        expect(res.status).toBe(200);
        expect(res.body.chapters[1]).toMatchObject({ status: 'ready', hasAudio: true, source: 'uploaded', isStale: false, durationSec: 3, bytes: mp3.length });

        const [options] = cloudinary.uploader.upload_stream.mock.calls[0];
        expect(options).toMatchObject({ resource_type: 'video', type: 'authenticated', format: 'mp3', folder: `ebook-creator/audio/${book._id}` });
        const entry = await entryOf(book._id, chapterIds[1]);
        expect(cloudinary.__stored.get(entry.publicId).equals(mp3)).toBe(true);
        expect(JSON.stringify(res.body)).not.toContain(entry.publicId);

        // Plays for readers like generated audio.
        const reader = await request(app).get(`/api/kenlibs/audio/${book._id}`).set(auth(admin));
        expect(reader.body.chapters).toEqual([expect.objectContaining({ chapterId: chapterIds[1], durationSec: 3 })]);

        // Editing the chapter marks it out of date.
        await Book.updateOne({ _id: book._id, 'chapters._id': chapterIds[1] }, { $set: { 'chapters.$.content': 'Rewritten.' } });
        expect((await status(admin, book._id)).chapters[1].isStale).toBe(true);
    });

    it('replacing deletes the old file; deleting works like generated audio', async () => {
        const { admin, book, chapterIds } = await setup();
        await generate(admin, book._id, { chapterId: chapterIds[1] });
        await waitForIdle();
        const generated = (await entryOf(book._id, chapterIds[1])).publicId;

        expect((await upload(admin, book._id, chapterIds[1])).status).toBe(200);
        const uploaded = (await entryOf(book._id, chapterIds[1])).publicId;
        expect(uploaded).not.toBe(generated);
        expect(cloudinary.uploader.destroy).toHaveBeenCalledWith(generated, expect.anything());

        const del = await request(app).delete(`/api/books/${book._id}/audio/${chapterIds[1]}`).set(auth(admin));
        expect(del.status).toBe(200);
        expect(cloudinary.uploader.destroy).toHaveBeenCalledWith(uploaded, expect.anything());
        expect(del.body.chapters[1]).toMatchObject({ status: 'none', hasAudio: false });
    });

    it('replaces an unfinished run and removes its saved parts', async () => {
        const { admin, book, chapterIds } = await setup();
        generateContent.mockResolvedValueOnce(pcmResponse()).mockRejectedValue(quotaError(PER_DAY));
        await generate(admin, book._id, { chapterId: chapterIds[0] });
        await waitForIdle();
        const [part] = (await entryOf(book._id, chapterIds[0])).parts;

        expect((await upload(admin, book._id, chapterIds[0])).status).toBe(200);
        const entry = await entryOf(book._id, chapterIds[0]);
        expect(entry).toMatchObject({ status: 'ready', source: 'uploaded', error: '' });
        expect(entry.parts).toHaveLength(0);
        expect(cloudinary.uploader.destroy).toHaveBeenCalledWith(part.publicId, expect.anything());
    });

    it('rejects files that are not MP3, fake MP3s, and oversized files', async () => {
        const { admin, book, chapterIds } = await setup();
        const wav = await upload(admin, book._id, chapterIds[1], Buffer.from('RIFF....WAVEfmt '), 'chapter.wav', 'audio/wav');
        expect(wav.status).toBe(400);
        expect(wav.body.message).toMatch(/Only MP3/);

        const fake = await upload(admin, book._id, chapterIds[1], Buffer.from('definitely not audio '.repeat(500)));
        expect(fake.status).toBe(400);
        expect(fake.body.message).toMatch(/isn't MP3 audio/);

        const tiny = await upload(admin, book._id, chapterIds[1], mp3.subarray(0, 300));
        expect(tiny.status).toBe(400);

        const huge = await upload(admin, book._id, chapterIds[1], Buffer.alloc(50 * 1024 * 1024 + 1));
        expect(huge.status).toBe(400);
        expect(huge.body.message).toMatch(/smaller than 50MB/);

        const none = await request(app).post(`/api/books/${book._id}/audio/${chapterIds[1]}/upload`).set(auth(admin));
        expect(none.status).toBe(400);

        expect(cloudinary.uploader.upload_stream).not.toHaveBeenCalled();
        expect((await Book.findById(book._id)).audio.chapters).toHaveLength(0);
    });

    it('is admin-only and owner-only, and the chapter must belong to the book', async () => {
        const { admin, book, chapterIds } = await setup();
        const reader = await createUser({ role: 'reader' });
        const otherAdmin = await createUser({ role: 'admin' });
        expect((await upload(reader, book._id, chapterIds[1])).status).toBe(403);
        expect((await upload(otherAdmin, book._id, chapterIds[1])).status).toBe(401);
        expect((await upload(null, book._id, chapterIds[1])).status).toBe(401);
        expect((await upload(admin, book._id, '64b000000000000000000000')).status).toBe(404);
        expect((await upload(admin, '64b000000000000000000000', chapterIds[1])).status).toBe(404);
        expect(cloudinary.uploader.upload_stream).not.toHaveBeenCalled();
    });

    it('is refused while the chapter is generating', async () => {
        const { admin, book, chapterIds } = await setup();
        await claimChapter(book._id, book.chapters[1]._id, { voice: 'af_heart' });
        const res = await upload(admin, book._id, chapterIds[1]);
        expect(res.status).toBe(409);
        expect(cloudinary.uploader.upload_stream).not.toHaveBeenCalled();
    });
});

describe('narrate-book.js path: claim, heartbeat and takeover', () => {
    it('claims a chapter and writes exactly the fields the server job writes', async () => {
        const { admin, book, chapterIds } = await setup();
        const progress = [];
        expect(await claimChapter(book._id, book.chapters[1]._id, { voice: 'bm_george', charCount: 20 })).toBe(true);
        const result = await narrateClaimedChapter({
            bookId: book._id,
            chapterId: book.chapters[1]._id,
            provider: getProvider('local'),
            onProgress: (p) => progress.push(p),
        });

        expect(result).toMatchObject({ outcome: 'ready', chunksTotal: 2, reusedChunks: 0 });
        expect(progress.map((p) => p.done)).toEqual([0, 1, 2]);
        const entry = await entryOf(book._id, chapterIds[1]);
        expect(entry).toMatchObject({ status: 'ready', source: 'local', voice: 'bm_george', progress: 1, error: '' });
        expect((await status(admin, book._id)).chapters[1]).toMatchObject({ hasAudio: true, isStale: false, source: 'local' });
    });

    it('will not take a chapter someone is actively generating, but takes over a dead run', async () => {
        const { book } = await setup();
        const chapterId = book.chapters[1]._id;
        expect(await claimChapter(book._id, chapterId, { voice: 'af_heart' })).toBe(true);
        expect(await claimChapter(book._id, chapterId, { voice: 'af_heart' })).toBe(false);

        await Book.updateOne(
            { _id: book._id },
            { $set: { 'audio.chapters.$[e].heartbeatAt': new Date(Date.now() - 10 * 60 * 1000) } },
            { arrayFilters: [{ 'e.chapterId': chapterId }] }
        );
        expect(await claimChapter(book._id, chapterId, { voice: 'af_heart' })).toBe(true);
    });

    it('stopping (Ctrl+C) keeps finished parts and says how to continue', async () => {
        const { book } = await setup();
        const chapterId = book.chapters[0]._id;
        await claimChapter(book._id, chapterId, { voice: 'af_heart' });
        let parts = 0;
        const result = await narrateClaimedChapter({
            bookId: book._id,
            chapterId,
            provider: getProvider('local'),
            onProgress: ({ done }) => (parts = done),
            shouldStop: () => parts >= 1,
        });
        expect(result.outcome).toBe('failed');
        expect(result.error).toMatch(/Stopped before it finished\. 1 of 3 parts are saved/);
        expect((await entryOf(book._id, chapterId.toString())).parts).toHaveLength(1);
    });

    it('server restart recovery leaves a live script run alone and fails dead ones', async () => {
        const { admin, book, chapterIds } = await setup();
        const now = new Date();
        await Book.updateOne(
            { _id: book._id },
            {
                $set: {
                    'audio.chapters': [
                        { chapterId: chapterIds[0], status: 'generating', heartbeatAt: now },
                        { chapterId: chapterIds[1], status: 'generating', heartbeatAt: new Date(now - 10 * 60 * 1000) },
                    ],
                },
            }
        );
        expect(await recoverInterruptedJobs()).toBe(1);
        const { chapters, isWorking } = await status(admin, book._id);
        expect(chapters[0].status).toBe('generating');
        expect(chapters[1]).toMatchObject({ status: 'failed', error: INTERRUPTED_MESSAGE });
        expect(isWorking).toBe(true);
    });

    it('a run whose heartbeat stopped shows as interrupted and can be deleted or regenerated', async () => {
        const { admin, book, chapterIds } = await setup();
        await Book.updateOne(
            { _id: book._id },
            { $set: { 'audio.chapters': [{ chapterId: chapterIds[1], status: 'generating', heartbeatAt: new Date(Date.now() - 10 * 60 * 1000) }] } }
        );
        const { chapters, isWorking } = await status(admin, book._id);
        expect(isWorking).toBe(false);
        expect(chapters[1]).toMatchObject({ status: 'failed', error: INTERRUPTED_MESSAGE });
        expect((await generate(admin, book._id, { chapterId: chapterIds[1] })).status).toBe(202);
        await waitForIdle();
        expect((await entryOf(book._id, chapterIds[1])).status).toBe('ready');
    });
});

describe('MP3 parsing', () => {
    it('measures the duration of the app-encoded MP3 and skips an ID3 tag', async () => {
        const { buffer } = await encodeMp3([new Int16Array(24000 * 2)], { sampleRate: 24000 });
        const info = readMp3Info(buffer);
        expect(info).toMatchObject({ sampleRate: 24000, channels: 1, averageKbps: 64 });
        expect(info.durationSec).toBeGreaterThanOrEqual(2);
        expect(info.durationSec).toBeLessThan(2.2);

        // ID3v2 header with a 20-byte (syncsafe) body in front.
        const id3 = Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 20]), Buffer.alloc(20)]);
        expect(readMp3Info(Buffer.concat([id3, buffer])).frames).toBe(info.frames);
    });

    it('rejects non-audio and broken streams', () => {
        expect(() => readMp3Info(Buffer.from('hello'))).toThrow(/isn't MP3/);
        expect(() => readMp3Info(Buffer.alloc(0))).toThrow();
    });
});
