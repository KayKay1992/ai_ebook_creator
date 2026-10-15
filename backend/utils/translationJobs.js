const crypto = require('crypto');
const Book = require('../models/Book');
const BookTranslation = require('../models/BookTranslation');
const { getLanguage } = require('../config/translationLanguages');
const { chapterSourceHash } = require('./chapterHash');
const { staleCutoff } = require('./narrationPipeline');
const { QuotaExhaustedError } = require('./geminiRetry');
const {
    chapterItems,
    chunkItemIndexes,
    missingNumbers,
    restoreLeadingMarker,
    assembleChapter,
} = require('./translationText');
const { translateItems, getTranslationModel, describeTranslationError, DAILY_QUOTA_MESSAGE } = require('./translate');

// Background translation jobs: the same design as audiobook narration
// (utils/audioJobs.js + utils/narrationPipeline.js).
//   - The queue is the database: a translated-chapter entry with jobStatus
//     'queued' is a job. One in-process worker, one chapter at a time,
//     one Gemini request at a time. HTTP handlers only queue and kick().
//   - Resumable at chunk level: a chapter is split by paragraph into
//     ~6,000-character chunks (utils/translationText.js); each finished
//     chunk is saved straight away in entry.parts, so after a failure,
//     restart or quota stop, translating again only does the missing ones.
//   - Gemini's daily quota → this chapter and every queued one become
//     'waiting' ("Waiting for quota"), not failed.
//   - The finished translation only ever replaces the *draft*; reviewStatus
//     goes back to 'draft' and the published copy is untouched. Nothing is
//     ever published here.
// Entries are only changed with targeted per-entry updates guarded on
// jobStatus, never doc.save(), since the admin endpoints edit other
// entries of the same document concurrently.

const HEARTBEAT_MS = 15 * 1000;

const INTERRUPTED_MESSAGE =
    'Interrupted before it finished (the server restarted). Translate it again; finished parts are kept.';

const isActivelyTranslating = (entry) =>
    entry?.jobStatus === 'translating' && Boolean(entry.heartbeatAt) && new Date(entry.heartbeatAt) >= staleCutoff();

const setFields = (fields) => {
    const set = {};
    for (const [key, value] of Object.entries(fields)) set[`chapters.$.${key}`] = value;
    return set;
};

const entryFilter = (translationId, chapterId, jobStatus) => ({
    _id: translationId,
    chapters: { $elemMatch: { chapterId, jobStatus } },
});

// Updates one translated chapter, only while its jobStatus is still
// `expected` (never resurrects an entry deleted meanwhile).
const updateEntry = async (translationId, chapterId, expected, fields) => {
    const result = await BookTranslation.updateOne(entryFilter(translationId, chapterId, expected), { $set: setFields(fields) });
    return result.matchedCount > 0;
};

const partKey = (model, language, items) =>
    crypto.createHash('sha256').update(`${model}\n${language}\n${JSON.stringify(items)}`, 'utf8').digest('hex');

const parkQueuedForQuota = () =>
    BookTranslation.updateMany(
        { 'chapters.jobStatus': 'queued' },
        { $set: { 'chapters.$[entry].jobStatus': 'waiting', 'chapters.$[entry].error': DAILY_QUOTA_MESSAGE } },
        { arrayFilters: [{ 'entry.jobStatus': 'queued' }] }
    );

// Translates one chunk; if a number didn't come through unchanged, asks
// once more and keeps whichever reply lost fewer.
const translateChunk = async (sourceItems, options) => {
    const check = (translated) =>
        translated.reduce((count, text, i) => count + missingNumbers(sourceItems[i], text).length, 0);
    let best = await translateItems(sourceItems, options);
    if (check(best) > 0) {
        const second = await translateItems(sourceItems, options);
        if (check(second) < check(best)) best = second;
    }
    return best.map((text, i) => restoreLeadingMarker(sourceItems[i], text));
};

// For the admin to check: paragraphs whose numbers changed.
const numberWarnings = (items, translatedByIndex) => {
    const warnings = [];
    for (const [index, text] of translatedByIndex) {
        const missing = missingNumbers(items[index], text);
        if (missing.length) {
            const where = index === 0 ? 'Title' : `Paragraph ${index}`;
            warnings.push(`${where}: check ${[...new Set(missing)].join(', ')} (not found unchanged in the translation).`);
        }
    }
    return warnings.slice(0, 20);
};

const processJob = async ({ translationId, chapterId }) => {
    const doc = await BookTranslation.findById(translationId);
    if (!doc) return;
    const entry = doc.chapters.find((e) => e.chapterId.toString() === chapterId.toString());
    if (!entry || entry.jobStatus !== 'translating') return;

    const fail = (error, extra = {}) =>
        updateEntry(translationId, chapterId, 'translating', { jobStatus: 'failed', error, ...extra }).catch(() => {});

    const language = getLanguage(doc.language);
    if (!language) return fail(`"${doc.language}" is no longer in the list of translation languages.`);
    const book = await Book.findById(doc.bookId).select('title chapters');
    const chapter = book?.chapters.id(chapterId);
    if (!chapter) return fail('This chapter no longer exists.');

    const { items, translatable } = chapterItems(chapter);
    const chunks = chunkItemIndexes(items, translatable);
    if (!chunks.length) return fail('This chapter has no text to translate.');

    const sourceHash = chapterSourceHash(chapter);
    const model = getTranslationModel();
    const keys = chunks.map((indexes) => partKey(model, language.code, indexes.map((i) => items[i])));

    const parts = new Map();
    for (const part of entry.parts || []) {
        if (keys[part.index] === part.key && !parts.has(part.index)) parts.set(part.index, part.toObject?.() || part);
    }
    const reused = parts.size;
    const total = chunks.length;
    const started = await updateEntry(translationId, chapterId, 'translating', {
        parts: [...parts.values()],
        chunksTotal: total,
        chunksDone: reused,
        heartbeatAt: new Date(),
        error: '',
    });
    if (!started) return;

    const heartbeat = setInterval(() => {
        updateEntry(translationId, chapterId, 'translating', { heartbeatAt: new Date() }).catch(() => {});
    }, HEARTBEAT_MS);
    heartbeat.unref?.();

    let done = reused;
    try {
        for (let c = 0; c < total; c++) {
            if (parts.has(c)) continue;
            const sourceItems = chunks[c].map((i) => items[i]);
            const translated = await translateChunk(sourceItems, { language, bookTitle: book.title });
            const part = { index: c, key: keys[c], items: translated };
            done += 1;
            const saved = await BookTranslation.updateOne(entryFilter(translationId, chapterId, 'translating'), {
                $push: { 'chapters.$.parts': part },
                $set: setFields({ chunksDone: done, heartbeatAt: new Date() }),
            });
            if (!saved.matchedCount) return; // deleted meanwhile
            parts.set(c, part);
        }

        const translatedByIndex = new Map();
        chunks.forEach((indexes, c) => indexes.forEach((itemIndex, k) => translatedByIndex.set(itemIndex, parts.get(c).items[k])));
        const { title, content } = assembleChapter(items, translatedByIndex);

        await updateEntry(translationId, chapterId, 'translating', {
            jobStatus: 'done',
            draftTitle: title,
            draftContent: content,
            sourceHash,
            translatedAt: new Date(),
            editedAt: null,
            reviewStatus: 'draft',
            warnings: numberWarnings(items, translatedByIndex),
            parts: [],
            chunksDone: total,
            chunksTotal: total,
            error: '',
        });
    } catch (error) {
        if (error instanceof QuotaExhaustedError) {
            await updateEntry(translationId, chapterId, 'translating', { jobStatus: 'waiting', error: DAILY_QUOTA_MESSAGE }).catch(() => {});
            await parkQueuedForQuota().catch(() => {});
            return;
        }
        console.error(`[translationJobs] ${doc.language} book ${doc.bookId} chapter ${chapterId} failed:`, error.message);
        const kept = done > 0 ? ` ${done} of ${total} parts are saved; translating again continues from there.` : '';
        await fail(`${describeTranslationError(error)}${kept}`);
    } finally {
        clearInterval(heartbeat);
    }
};

// Oldest queued chapter across all translations, claimed atomically.
const claimNextJob = async () => {
    const docs = await BookTranslation.find({ 'chapters.jobStatus': 'queued' }).select('chapters').lean();
    const candidates = docs
        .flatMap((doc) =>
            doc.chapters
                .filter((e) => e.jobStatus === 'queued')
                .map((e) => ({ translationId: doc._id, chapterId: e.chapterId, queuedAt: e.queuedAt || 0 }))
        )
        .sort((a, b) => new Date(a.queuedAt) - new Date(b.queuedAt));
    for (const candidate of candidates) {
        const now = new Date();
        const claimed = await updateEntry(candidate.translationId, candidate.chapterId, 'queued', {
            jobStatus: 'translating',
            startedAt: now,
            heartbeatAt: now,
            error: '',
        });
        if (claimed) return candidate;
    }
    return null;
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
                        await processJob(job).catch((error) => console.error('[translationJobs] Unexpected job error:', error));
                    }
                }
            } catch (error) {
                console.error('[translationJobs] Worker stopped:', error.message);
            } finally {
                running = null;
            }
        })();
    }
    return running;
};

const waitForIdle = async () => {
    while (running) await running;
};

// Call once after Mongo connects (server.js): translations that were
// running when the server stopped are marked failed (their parts are
// kept), and queued ones resume.
const recoverInterruptedTranslations = async () => {
    const result = await BookTranslation.updateMany(
        { 'chapters.jobStatus': 'translating' },
        { $set: { 'chapters.$[entry].jobStatus': 'failed', 'chapters.$[entry].error': INTERRUPTED_MESSAGE } },
        { arrayFilters: [{ 'entry.jobStatus': 'translating', 'entry.heartbeatAt': { $not: { $gte: staleCutoff() } } }] }
    );
    kick();
    return result.modifiedCount;
};

module.exports = { kick, waitForIdle, recoverInterruptedTranslations, isActivelyTranslating, INTERRUPTED_MESSAGE };
