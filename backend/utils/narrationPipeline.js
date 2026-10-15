const Book = require('../models/Book');
const { chapterNarration, splitIntoChunks, hashText } = require('./narrationText');
const { encodeMp3, silence } = require('./audioEncoding');
const { uploadChapterAudio, uploadAudioPart, downloadAudioAsset, deleteAudioAsset } = require('./audioStorage');
const { chargeChars } = require('./audioUsage');
const { QuotaExhaustedError, DAILY_QUOTA_MESSAGE } = require('./tts');
const { captureError } = require('./errorLogger');

// Narrates one chapter into book.audio, whichever engine (provider) makes
// the speech and whoever runs it: the server's job worker
// (utils/audioJobs.js) or scripts/narrate-book.js on the admin's own PC.
// Both write exactly the same fields, so the editor and the reader player
// can't tell the difference.
//
// Resumable at chunk level: the chapter (title, then ~1,800-character
// chunks of the body) is narrated chunk by chunk, and each finished chunk
// is encoded and stored straight away as its own authenticated MP3 "part"
// (entry.parts). If the run fails, is interrupted, or stops for Gemini's
// daily quota, generating again reuses every part whose text, voice and
// engine still match and only makes the missing ones ("5 of 7 done"). The
// finished chapter is the parts' MP3 frames joined in order (all parts
// share one encoder setting, so this is a valid MP3), uploaded as one file;
// then the parts are deleted.
//
// Audio entries are only ever changed with targeted per-entry updates,
// guarded on the entry's status, never book.save(): the editor, the admin
// endpoints and other jobs touch the same book concurrently.

const TITLE_PAUSE_MS = 1200; // after the chapter title
const CHUNK_GAP_MS = 450; // between chunks (each ends at a sentence or paragraph)

const HEARTBEAT_MS = 15 * 1000;
// A 'generating' entry not heard from for this long was interrupted (its
// process died) and may be taken over or reported as failed.
const STALE_AFTER_MS = 3 * 60 * 1000;

const INTERRUPTED_MESSAGE =
    'Interrupted before it finished (the server or narration script stopped). Generate it again; finished parts are kept.';

const staleCutoff = () => new Date(Date.now() - STALE_AFTER_MS);

// True while someone is genuinely working on this entry.
const isActivelyGenerating = (entry) =>
    entry?.status === 'generating' && Boolean(entry.heartbeatAt) && new Date(entry.heartbeatAt) >= staleCutoff();

const setFields = (fields) => {
    const set = {};
    for (const [key, value] of Object.entries(fields)) set[`audio.chapters.$.${key}`] = value;
    return set;
};

const entryFilter = (bookId, chapterId, expectedStatus) => ({
    _id: bookId,
    'audio.chapters': { $elemMatch: { chapterId, status: expectedStatus } },
});

// Updates one chapter's audio entry, but only while it's still in
// `expectedStatus` (so a job never resurrects an entry the admin deleted
// meanwhile). Returns true if it matched.
const updateEntry = async (bookId, chapterId, expectedStatus, fields) => {
    const result = await Book.updateOne(entryFilter(bookId, chapterId, expectedStatus), { $set: setFields(fields) });
    return result.matchedCount > 0;
};

// Takes a chapter for narration (used by scripts/narrate-book.js; the
// server worker claims from its queue instead). Succeeds unless someone
// else is actively generating it. Returns true if claimed.
const claimChapter = async (bookId, chapterId, { voice, charCount = 0 } = {}) => {
    const now = new Date();
    const fields = { status: 'generating', voice, charCount, startedAt: now, heartbeatAt: now, progress: 0, error: '' };
    const takeover = await Book.updateOne(
        {
            _id: bookId,
            'audio.chapters': {
                $elemMatch: {
                    chapterId,
                    $or: [{ status: { $ne: 'generating' } }, { heartbeatAt: { $not: { $gte: staleCutoff() } } }],
                },
            },
        },
        { $set: setFields(fields) }
    );
    if (takeover.matchedCount) return true;
    const created = await Book.updateOne(
        { _id: bookId, 'audio.chapters.chapterId': { $ne: chapterId } },
        { $push: { 'audio.chapters': { chapterId, ...fields } } }
    );
    return created.matchedCount > 0;
};

// Gemini's daily quota is shared by everything, so once it's gone every
// queued chapter would only fail the same way: park them all as waiting.
const parkQueuedForQuota = () =>
    Book.updateMany(
        { 'audio.chapters.status': 'queued' },
        {
            $set: {
                'audio.chapters.$[entry].status': 'waiting',
                'audio.chapters.$[entry].error': DAILY_QUOTA_MESSAGE,
                'audio.chapters.$[entry].progress': 0,
            },
        },
        { arrayFilters: [{ 'entry.status': 'queued' }] }
    );

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

class EntryGoneError extends Error {}
class StoppedError extends Error {}

const deleteQuietly = (publicIds, context) =>
    Promise.all(
        publicIds.filter(Boolean).map((publicId) =>
            deleteAudioAsset(publicId).catch((error) =>
                console.error(`[narration] Couldn't delete ${context} audio ${publicId}:`, error.message)
            )
        )
    );

// Narrates a chapter whose entry the caller has already claimed (status
// 'generating'). Never throws for narration problems; resolves to
//   { outcome: 'ready', durationSec, bytes, chunksTotal, reusedChunks }
//   { outcome: 'failed' | 'waiting' | 'skipped', error, chunksDone, chunksTotal }
//   { outcome: 'gone' }   the entry was deleted or taken over meanwhile
// Options: onProgress({ done, total, reused }) after each chunk, onWait
// (Gemini per-minute waits), shouldStop() checked before each chunk.
const narrateClaimedChapter = async ({ bookId, chapterId, provider, onProgress, onWait, shouldStop }) => {
    const book = await Book.findById(bookId).select('chapters audio');
    if (!book) return { outcome: 'gone' };
    const chapter = book.chapters.id(chapterId);
    const entry = book.audio?.chapters?.find((e) => e.chapterId.toString() === chapterId.toString());
    if (!entry || entry.status !== 'generating') return { outcome: 'gone' };

    const finish = async (status, error, extra = {}) => {
        await updateEntry(bookId, chapterId, 'generating', { status, progress: 0, error, ...extra }).catch(() => {});
        return { outcome: status, error, ...extra };
    };

    if (!chapter) return finish('failed', 'This chapter no longer exists.');
    const { title, body, text } = chapterNarration(chapter);
    if (!body) return finish('skipped', 'This chapter has no text to narrate.');

    const voice = [entry.voice, book.audio?.voice].find((v) => provider.isValidVoice(v)) || provider.defaultVoice;
    const pieces = [title, ...splitIntoChunks(body)];
    const total = pieces.length;
    const gaps = pieces.map((_, i) => (i === 0 ? TITLE_PAUSE_MS : i < total - 1 ? CHUNK_GAP_MS : 0));
    const engine = provider.engineKey();
    const keys = pieces.map((piece, i) => hashText(`${engine}\n${voice}\n${gaps[i]}\n${piece}`));

    // Parts from an earlier run that still match this exact chunk.
    const parts = new Map();
    const staleParts = [];
    for (const part of entry.parts || []) {
        if (keys[part.index] === part.key && !parts.has(part.index)) parts.set(part.index, part.toObject?.() || part);
        else staleParts.push(part.publicId);
    }
    const reused = parts.size;
    const todo = pieces.map((_, i) => i).filter((i) => !parts.has(i));

    if (provider.chargesQuota && todo.length) {
        // A fresh run is charged the whole narration text, a resumed one
        // only the chunks it still has to make.
        const chars = reused ? todo.reduce((sum, i) => sum + pieces[i].length, 0) : text.length;
        const charge = await chargeChars(chars);
        if (!charge.ok) {
            return finish(
                'failed',
                `Daily narration limit reached (${charge.usedToday.toLocaleString('en-US')} of ${charge.dailyLimit.toLocaleString('en-US')} characters used today, UTC). Try again tomorrow or raise AUDIO_DAILY_CHAR_LIMIT.`
            );
        }
    }

    const started = await updateEntry(bookId, chapterId, 'generating', {
        voice,
        parts: [...parts.values()],
        chunksTotal: total,
        chunksDone: reused,
        progress: reused / total,
        heartbeatAt: new Date(),
        error: '',
    });
    if (!started) return { outcome: 'gone' };
    await deleteQuietly(staleParts, 'outdated part');
    if (onProgress) onProgress({ done: reused, total, reused });

    const heartbeat = setInterval(() => {
        updateEntry(bookId, chapterId, 'generating', { heartbeatAt: new Date() }).catch(() => {});
    }, HEARTBEAT_MS);
    heartbeat.unref?.();

    const fresh = new Map(); // index → MP3 buffer made in this run
    let done = reused;
    let finalPublicId = null;
    try {
        await mapWithConcurrency(todo, provider.concurrency(), async (i) => {
            if (shouldStop?.()) throw new StoppedError();
            const { samples, sampleRate } = await provider.synthesize(pieces[i], { voice, onWait });
            const segments = gaps[i] ? [samples, silence(sampleRate, gaps[i])] : [samples];
            const { buffer, durationSec } = await encodeMp3(segments, { sampleRate });
            const uploaded = await uploadAudioPart(buffer, bookId.toString());
            const part = { index: i, key: keys[i], publicId: uploaded.public_id, durationSec, bytes: buffer.length };
            done += 1;
            const saved = await Book.updateOne(entryFilter(bookId, chapterId, 'generating'), {
                $push: { 'audio.chapters.$.parts': part },
                $set: setFields({ chunksDone: done, progress: done / total, heartbeatAt: new Date() }),
            });
            if (!saved.matchedCount) {
                await deleteQuietly([uploaded.public_id], 'orphaned part');
                throw new EntryGoneError();
            }
            parts.set(i, part);
            fresh.set(i, buffer);
            if (onProgress) onProgress({ done, total, reused });
        });

        const buffers = [];
        for (let i = 0; i < total; i++) buffers.push(fresh.get(i) || (await downloadAudioAsset(parts.get(i).publicId)));
        const buffer = Buffer.concat(buffers);
        const durationSec = [...parts.values()].reduce((sum, part) => sum + part.durationSec, 0);

        const uploaded = await uploadChapterAudio(buffer, bookId.toString());
        finalPublicId = uploaded.public_id;

        const saved = await updateEntry(bookId, chapterId, 'generating', {
            status: 'ready',
            source: provider.name,
            publicId: uploaded.public_id,
            durationSec: Math.round(durationSec * 10) / 10,
            bytes: buffer.length,
            textHash: hashText(text),
            voice,
            charCount: text.length,
            progress: 1,
            chunksDone: total,
            chunksTotal: total,
            parts: [],
            generatedAt: new Date(),
            error: '',
        });
        const partIds = [...parts.values()].map((part) => part.publicId);
        if (!saved) {
            // Deleted (or the book removed) while generating: don't leave
            // orphaned files behind.
            await deleteQuietly([uploaded.public_id, ...partIds], 'orphaned');
            return { outcome: 'gone' };
        }
        await deleteQuietly(partIds, 'assembled part');
        // Replaced: remove the previous file now the new one is live.
        if (entry.publicId && entry.publicId !== uploaded.public_id) {
            await deleteQuietly([entry.publicId], `replaced (book ${bookId})`);
        }
        return { outcome: 'ready', durationSec, bytes: buffer.length, chunksTotal: total, reusedChunks: reused };
    } catch (error) {
        if (finalPublicId) await deleteQuietly([finalPublicId], 'unsaved');
        if (error instanceof EntryGoneError) return { outcome: 'gone' };

        const progress = { chunksDone: done, chunksTotal: total };
        // The previous audio (if any) is untouched and stays playable.
        if (error instanceof QuotaExhaustedError) {
            const result = await finish('waiting', DAILY_QUOTA_MESSAGE, progress);
            await parkQueuedForQuota().catch(() => {});
            return result;
        }
        const kept = done > 0 ? ` ${done} of ${total} parts are saved; generating again continues from there.` : '';
        if (error instanceof StoppedError) return finish('failed', `Stopped before it finished.${kept}`, progress);
        console.error(`[narration] Book ${bookId} chapter ${chapterId} failed:`, error.message);
        // A real failure (not a quota stop or a deliberate stop): monitored.
        captureError({ source: 'job', jobType: `audio-${provider.name}`, bookId, chapterId, error });
        return finish('failed', `${provider.describeError(error)}${kept}`, progress);
    } finally {
        clearInterval(heartbeat);
    }
};

// Every part asset recorded on a book's audio entries (for deletes).
const partPublicIds = (entries = []) => entries.flatMap((entry) => (entry.parts || []).map((part) => part.publicId));

module.exports = {
    TITLE_PAUSE_MS,
    CHUNK_GAP_MS,
    STALE_AFTER_MS,
    INTERRUPTED_MESSAGE,
    staleCutoff,
    isActivelyGenerating,
    updateEntry,
    claimChapter,
    narrateClaimedChapter,
    partPublicIds,
};
