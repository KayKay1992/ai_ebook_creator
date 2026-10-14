const Book = require('../models/Book');
const { chapterNarration, splitIntoChunks, hashText } = require('./narrationText');
const { synthesizeSpeech, describeTtsError, DEFAULT_VOICE } = require('./tts');
const { encodeMp3, silence } = require('./audioEncoding');
const { uploadChapterAudio, deleteAudioAsset } = require('./audioStorage');
const { chargeChars } = require('./audioUsage');

// Background narration jobs. The queue is the database itself: a chapter's
// audio entry with status 'queued' is a job. One in-process worker takes
// them oldest-first, one chapter at a time across all books (keeps memory
// and Gemini usage modest on a small instance), with a few TTS requests in
// flight within a chapter. HTTP handlers only queue work and call kick();
// they never wait for it.
//
// A restart kills whatever was running: recoverInterruptedJobs (server.js,
// after Mongo connects) marks 'generating' chapters failed and resumes the
// still-queued ones.

const TITLE_PAUSE_MS = 1200; // after the chapter title
const CHUNK_GAP_MS = 450; // between chunks (each ends at a sentence or paragraph)

const getConcurrency = () => {
    const n = parseInt(process.env.AUDIO_TTS_CONCURRENCY, 10);
    return Number.isFinite(n) ? Math.min(Math.max(n, 1), 4) : 2;
};

// Runs `fn` over items with at most `limit` in flight; results keep order.
// Stops starting new work after the first failure and rethrows it.
const mapWithConcurrency = async (items, limit, fn) => {
    const results = new Array(items.length);
    let next = 0;
    let failed = null;
    const worker = async () => {
        while (!failed && next < items.length) {
            const index = next++;
            try {
                results[index] = await fn(items[index], index);
            } catch (error) {
                failed = failed || error;
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    if (failed) throw failed;
    return results;
};

// Updates one chapter's audio entry, but only while it's still in
// `expectedStatus` (so a job never resurrects an entry the admin deleted
// meanwhile). Returns true if it matched.
const updateEntry = async (bookId, chapterId, expectedStatus, fields) => {
    const set = {};
    for (const [key, value] of Object.entries(fields)) set[`audio.chapters.$.${key}`] = value;
    const result = await Book.updateOne(
        { _id: bookId, 'audio.chapters': { $elemMatch: { chapterId, status: expectedStatus } } },
        { $set: set }
    );
    return result.matchedCount > 0;
};

// Oldest queued chapter across all books, claimed atomically
// (queued → generating). Returns { bookId, chapterId } or null.
const claimNextJob = async () => {
    const books = await Book.find({ 'audio.chapters.status': 'queued' }).select('audio.chapters').lean();
    const candidates = books
        .flatMap((book) =>
            (book.audio?.chapters || [])
                .filter((entry) => entry.status === 'queued')
                .map((entry) => ({ bookId: book._id, chapterId: entry.chapterId, queuedAt: entry.queuedAt || 0 }))
        )
        .sort((a, b) => new Date(a.queuedAt) - new Date(b.queuedAt));

    for (const candidate of candidates) {
        const claimed = await updateEntry(candidate.bookId, candidate.chapterId, 'queued', {
            status: 'generating',
            startedAt: new Date(),
            progress: 0,
            error: '',
        });
        if (claimed) return candidate;
    }
    return null;
};

const fail = (bookId, chapterId, error) =>
    updateEntry(bookId, chapterId, 'generating', { status: 'failed', progress: 0, error });

const processJob = async ({ bookId, chapterId }) => {
    const book = await Book.findById(bookId).select('chapters audio');
    if (!book) return;
    const chapter = book.chapters.id(chapterId);
    const entry = book.audio?.chapters?.find((e) => e.chapterId.toString() === chapterId.toString());
    if (!entry) return;
    if (!chapter) {
        await fail(bookId, chapterId, 'This chapter no longer exists.');
        return;
    }

    const { title, body, text } = chapterNarration(chapter);
    if (!body) {
        await updateEntry(bookId, chapterId, 'generating', {
            status: 'skipped',
            progress: 0,
            error: 'This chapter has no text to narrate.',
        });
        return;
    }

    const charge = await chargeChars(text.length);
    if (!charge.ok) {
        await fail(
            bookId,
            chapterId,
            `Daily narration limit reached (${charge.usedToday.toLocaleString('en-US')} of ${charge.dailyLimit.toLocaleString('en-US')} characters used today, UTC). Try again tomorrow or raise AUDIO_DAILY_CHAR_LIMIT.`
        );
        return;
    }

    const voice = entry.voice || book.audio?.voice || DEFAULT_VOICE;
    const pieces = [title, ...splitIntoChunks(body)];
    let done = 0;

    let uploadedPublicId = null;
    try {
        const parts = await mapWithConcurrency(pieces, getConcurrency(), async (piece) => {
            const audio = await synthesizeSpeech(piece, { voice });
            done += 1;
            // Progress is cosmetic; never let a failed write fail the job.
            await updateEntry(bookId, chapterId, 'generating', { progress: done / pieces.length }).catch(() => {});
            return audio;
        });

        const { sampleRate } = parts[0];
        if (parts.some((part) => part.sampleRate !== sampleRate)) {
            throw new Error('The speech model returned mixed sample rates.');
        }
        const segments = [];
        parts.forEach((part, i) => {
            segments.push(part.samples);
            if (i === 0) segments.push(silence(sampleRate, TITLE_PAUSE_MS));
            else if (i < parts.length - 1) segments.push(silence(sampleRate, CHUNK_GAP_MS));
        });
        const { buffer, durationSec } = await encodeMp3(segments, { sampleRate });

        const uploaded = await uploadChapterAudio(buffer, bookId.toString());
        uploadedPublicId = uploaded.public_id;

        const saved = await updateEntry(bookId, chapterId, 'generating', {
            status: 'ready',
            publicId: uploaded.public_id,
            durationSec: Math.round(durationSec * 10) / 10,
            bytes: buffer.length,
            textHash: hashText(text),
            voice,
            charCount: text.length,
            progress: 1,
            generatedAt: new Date(),
            error: '',
        });

        if (!saved) {
            // Deleted (or the book removed) while generating: don't leave
            // an orphaned file behind.
            await deleteAudioAsset(uploaded.public_id).catch((error) =>
                console.error(`[audioJobs] Couldn't delete orphaned audio ${uploaded.public_id}:`, error.message)
            );
            return;
        }

        // Replaced: remove the previous file now the new one is live.
        if (entry.publicId && entry.publicId !== uploaded.public_id) {
            await deleteAudioAsset(entry.publicId).catch((error) =>
                console.error(`[audioJobs] Couldn't delete replaced audio ${entry.publicId} (book ${bookId}):`, error.message)
            );
        }
    } catch (error) {
        console.error(`[audioJobs] Book ${bookId} chapter ${chapterId} failed:`, error.message);
        if (uploadedPublicId) await deleteAudioAsset(uploadedPublicId).catch(() => {});
        // The previous audio (if any) is untouched and stays playable.
        await fail(bookId, chapterId, describeTtsError(error)).catch(() => {});
    }
};

let running = null;
let wakeRequested = false;

// Starts the worker if it isn't running, or makes a running one look again
// for new jobs before it stops. Returns a promise for the current run.
const kick = () => {
    wakeRequested = true;
    if (!running) {
        running = (async () => {
            try {
                while (wakeRequested) {
                    wakeRequested = false;
                    let job;
                    while ((job = await claimNextJob())) {
                        await processJob(job).catch((error) =>
                            console.error('[audioJobs] Unexpected job error:', error)
                        );
                    }
                }
            } catch (error) {
                console.error('[audioJobs] Worker stopped:', error.message);
            } finally {
                running = null;
            }
        })();
    }
    return running;
};

// For tests and graceful shutdowns: resolves once the queue is drained.
const waitForIdle = async () => {
    while (running) await running;
};

const INTERRUPTED_MESSAGE =
    'Interrupted: the server restarted while this chapter was generating. Generate it again.';

// Call once after Mongo connects (server.js).
const recoverInterruptedJobs = async () => {
    const result = await Book.updateMany(
        { 'audio.chapters.status': 'generating' },
        {
            $set: {
                'audio.chapters.$[entry].status': 'failed',
                'audio.chapters.$[entry].progress': 0,
                'audio.chapters.$[entry].error': INTERRUPTED_MESSAGE,
            },
        },
        { arrayFilters: [{ 'entry.status': 'generating' }] }
    );
    kick(); // resume anything still queued
    return result.modifiedCount;
};

module.exports = {
    kick,
    waitForIdle,
    recoverInterruptedJobs,
    INTERRUPTED_MESSAGE,
    TITLE_PAUSE_MS,
    CHUNK_GAP_MS,
};
