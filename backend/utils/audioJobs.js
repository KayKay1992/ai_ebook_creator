const Book = require('../models/Book');
const { getProvider } = require('./narrationProviders');
const {
    updateEntry,
    narrateClaimedChapter,
    staleCutoff,
    INTERRUPTED_MESSAGE,
    TITLE_PAUSE_MS,
    CHUNK_GAP_MS,
} = require('./narrationPipeline');

// Background narration jobs. The queue is the database itself: a chapter's
// audio entry with status 'queued' is a job. One in-process worker takes
// them oldest-first, one chapter at a time across all books (keeps memory
// and TTS usage modest on a small instance), and hands each to the shared
// narration pipeline (utils/narrationPipeline.js) with the provider
// AUDIO_PROVIDER selects. HTTP handlers only queue work and call kick();
// they never wait for it.
//
// A restart kills whatever was running: recoverInterruptedJobs (server.js,
// after Mongo connects) marks 'generating' chapters failed (unless their
// heartbeat shows scripts/narrate-book.js is still working on them; their
// finished parts are kept either way) and resumes the still-queued ones.

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
        const now = new Date();
        const claimed = await updateEntry(candidate.bookId, candidate.chapterId, 'queued', {
            status: 'generating',
            startedAt: now,
            heartbeatAt: now,
            progress: 0,
            error: '',
        });
        if (claimed) return candidate;
    }
    return null;
};

const processJob = async ({ bookId, chapterId }) => {
    let provider;
    try {
        provider = getProvider();
    } catch (error) {
        await updateEntry(bookId, chapterId, 'generating', { status: 'failed', progress: 0, error: error.message });
        return;
    }
    await narrateClaimedChapter({ bookId, chapterId, provider });
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

// Call once after Mongo connects (server.js). Nothing in this process can
// be generating yet, so a 'generating' entry is either dead or owned by a
// narrate-book.js run that is still sending heartbeats; only the dead ones
// are failed.
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
        { arrayFilters: [{ 'entry.status': 'generating', 'entry.heartbeatAt': { $not: { $gte: staleCutoff() } } }] }
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
