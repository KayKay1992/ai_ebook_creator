const mongoose = require('mongoose');
const Book = require('../models/Book');
const { chapterNarration, hashText, splitSentences, estimateDurationSec, ESTIMATED_CHARS_PER_SECOND } = require('../utils/narrationText');
const { VOICES, DEFAULT_VOICE, isValidVoice, getTtsModel, synthesizeSpeech, describeTtsError } = require('../utils/tts');
const { encodeMp3 } = require('../utils/audioEncoding');
const { deleteAudioAsset } = require('../utils/audioStorage');
const { getDailyCharLimit, getUsedToday, chargeChars } = require('../utils/audioUsage');
const { kick } = require('../utils/audioJobs');

// Admin-only audiobook endpoints under /api/books/:id/audio (bookRoute.js
// applies protect + adminOnly to the whole router). Ownership is checked
// here the same way every other book endpoint does it. None of these
// responses include a publicId or a URL; playback URLs only come from the
// reader endpoint (kenlibsController.js's getBookAudio).

const IN_PROGRESS = new Set(['queued', 'generating']);
const PREVIEW_MAX_CHARS = 200;

const loadOwnedBook = async (req, res, select) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
        res.status(404).json({ message: 'Book not found' });
        return null;
    }
    const book = await Book.findById(req.params.id).select(`userId ${select}`);
    if (!book) {
        res.status(404).json({ message: 'Book not found' });
        return null;
    }
    if (book.userId.toString() !== req.user._id.toString()) {
        res.status(401).json({ message: 'Unauthorized' });
        return null;
    }
    return book;
};

const entryMap = (book) => new Map((book.audio?.chapters || []).map((entry) => [entry.chapterId.toString(), entry]));

// Characters waiting in the queue (reserved against today's cap but not
// charged yet; chapters are charged when they start generating).
const queuedChars = async () => {
    const books = await Book.find({ 'audio.chapters.status': 'queued' }).select('audio.chapters').lean();
    return books
        .flatMap((book) => book.audio.chapters)
        .filter((entry) => entry.status === 'queued')
        .reduce((sum, entry) => sum + (entry.charCount || 0), 0);
};

const usageSnapshot = async () => {
    const [usedToday, reserved] = await Promise.all([getUsedToday(), queuedChars()]);
    const dailyLimit = getDailyCharLimit();
    return { usedToday, queuedChars: reserved, dailyLimit, remaining: Math.max(0, dailyLimit - usedToday - reserved) };
};

const buildStatus = async (book) => {
    const entries = entryMap(book);
    const chapterIds = new Set();

    const chapters = book.chapters.map((chapter, index) => {
        const id = chapter._id.toString();
        chapterIds.add(id);
        const entry = entries.get(id);
        const { text } = chapterNarration(chapter);
        const hasAudio = Boolean(entry?.publicId);
        return {
            chapterId: id,
            index,
            title: chapter.title,
            hasText: Boolean(text),
            charCount: text.length,
            estimatedDurationSec: estimateDurationSec(text.length),
            status: entry?.status || 'none',
            hasAudio,
            // Edited since its audio was made.
            isStale: hasAudio && Boolean(entry.textHash) && entry.textHash !== hashText(text),
            durationSec: hasAudio ? entry.durationSec : 0,
            bytes: hasAudio ? entry.bytes : 0,
            voice: entry?.voice || '',
            generatedAt: hasAudio ? entry.generatedAt || null : null,
            progress: entry?.status === 'generating' ? entry.progress || 0 : 0,
            error: entry?.error || '',
        };
    });

    // Audio whose chapter was removed from the book: still stored (and
    // billed) until the admin deletes it, never offered to readers.
    const orphaned = (book.audio?.chapters || [])
        .filter((entry) => !chapterIds.has(entry.chapterId.toString()))
        .map((entry) => ({
            chapterId: entry.chapterId.toString(),
            status: entry.status,
            hasAudio: Boolean(entry.publicId),
            durationSec: entry.durationSec || 0,
            bytes: entry.bytes || 0,
            generatedAt: entry.generatedAt || null,
        }));

    return {
        voice: book.audio?.voice || DEFAULT_VOICE,
        defaultVoice: DEFAULT_VOICE,
        voices: VOICES,
        model: getTtsModel(),
        estimatedCharsPerSecond: ESTIMATED_CHARS_PER_SECOND,
        isWorking: chapters.some((c) => IN_PROGRESS.has(c.status)) || orphaned.some((c) => IN_PROGRESS.has(c.status)),
        usage: await usageSnapshot(),
        chapters,
        orphaned,
    };
};

//@desc    Narration status of every chapter (poll while any is queued/generating)
//@route   GET /api/books/:id/audio
//@access  Private/Admin (owner)
const getAudioStatus = async (req, res) => {
    try {
        const book = await loadOwnedBook(req, res, 'chapters audio');
        if (!book) return;
        res.set('Cache-Control', 'no-store');
        res.status(200).json(await buildStatus(book));
    } catch (error) {
        console.error('[audio] status error:', error);
        res.status(500).json({ message: 'Server Error' });
    }
};

//@desc    Queue narration for one chapter, or every chapter without audio.
//         Body: { chapterId: <id> | "all-missing", voice?, dryRun? }.
//         dryRun returns the character count, estimated duration and the
//         daily-cap position without queuing anything (the admin confirms
//         from that). The real call returns the same numbers, 202, and the
//         new status; the work itself runs in the background.
//@route   POST /api/books/:id/audio/generate
//@access  Private/Admin (owner)
const generateAudio = async (req, res) => {
    try {
        const book = await loadOwnedBook(req, res, 'chapters audio');
        if (!book) return;

        const { chapterId, dryRun = false } = req.body || {};
        const voice = req.body?.voice ?? book.audio?.voice ?? DEFAULT_VOICE;
        if (!isValidVoice(voice)) {
            return res.status(400).json({ message: `Unknown voice "${voice}".` });
        }
        if (!chapterId) {
            return res.status(400).json({ message: 'chapterId is required (a chapter id, or "all-missing").' });
        }

        const entries = entryMap(book);
        let targets;
        if (chapterId === 'all-missing') {
            // Missing = no playable audio and not already in progress.
            // Out-of-date chapters keep their audio; regenerate those one
            // by one so nothing is replaced in bulk by accident.
            targets = book.chapters.filter((chapter) => {
                const entry = entries.get(chapter._id.toString());
                return !entry?.publicId && !IN_PROGRESS.has(entry?.status);
            });
        } else {
            const chapter = mongoose.isValidObjectId(chapterId) ? book.chapters.id(chapterId) : null;
            if (!chapter) return res.status(404).json({ message: 'Chapter not found in this book.' });
            if (IN_PROGRESS.has(entries.get(chapter._id.toString())?.status)) {
                return res.status(409).json({ message: 'This chapter is already queued or generating.' });
            }
            targets = [chapter];
        }

        const planned = [];
        const skipped = [];
        for (const chapter of targets) {
            const { text } = chapterNarration(chapter);
            const item = { chapterId: chapter._id.toString(), title: chapter.title, charCount: text.length };
            if (text) planned.push({ ...item, estimatedDurationSec: estimateDurationSec(text.length) });
            else skipped.push({ ...item, reason: 'This chapter has no text to narrate.' });
        }

        const totalChars = planned.reduce((sum, c) => sum + c.charCount, 0);
        const usage = await usageSnapshot();
        const summary = {
            voice,
            chapters: planned,
            skipped,
            totalChars,
            estimatedDurationSec: estimateDurationSec(totalChars),
            usage,
            wouldExceedLimit: totalChars > usage.remaining,
        };

        if (dryRun) return res.status(200).json({ dryRun: true, ...summary });

        if (planned.length === 0 && skipped.length === 0) {
            return res.status(400).json({ message: 'Every chapter already has audio or is in progress.', ...summary });
        }
        if (summary.wouldExceedLimit) {
            return res.status(429).json({
                message: `This run needs ${totalChars.toLocaleString('en-US')} characters, but only ${usage.remaining.toLocaleString('en-US')} of today's ${usage.dailyLimit.toLocaleString('en-US')} are left (UTC day). Try fewer chapters, wait until tomorrow, or raise AUDIO_DAILY_CHAR_LIMIT.`,
                ...summary,
            });
        }

        const now = new Date();
        // Per-entry atomic updates, never book.save(): the worker may be
        // updating another chapter's entry of this same book right now.
        const writes = [{ updateOne: { filter: { _id: book._id }, update: { $set: { 'audio.voice': voice } } } }];
        const upsertEntry = (id, fields) => {
            const objectId = new mongoose.Types.ObjectId(id);
            if (entries.has(id)) {
                const set = {};
                for (const [key, value] of Object.entries(fields)) set[`audio.chapters.$[entry].${key}`] = value;
                writes.push({
                    updateOne: {
                        filter: { _id: book._id },
                        update: { $set: set },
                        arrayFilters: [{ 'entry.chapterId': objectId }],
                    },
                });
            } else {
                writes.push({
                    updateOne: {
                        filter: { _id: book._id, 'audio.chapters.chapterId': { $ne: objectId } },
                        update: { $push: { 'audio.chapters': { chapterId: objectId, ...fields } } },
                    },
                });
            }
        };
        planned.forEach((c, i) =>
            upsertEntry(c.chapterId, {
                status: 'queued',
                voice,
                charCount: c.charCount,
                // Keeps the run in chapter order.
                queuedAt: new Date(now.getTime() + i),
                progress: 0,
                error: '',
            })
        );
        skipped.forEach((c) =>
            upsertEntry(c.chapterId, { status: 'skipped', voice, charCount: 0, progress: 0, error: c.reason })
        );
        await Book.bulkWrite(writes);

        if (planned.length) kick();

        const fresh = await Book.findById(book._id).select('userId chapters audio');
        res.status(202).json({ ...summary, status: await buildStatus(fresh) });
    } catch (error) {
        console.error('[audio] generate error:', error);
        res.status(500).json({ message: 'Server Error' });
    }
};

//@desc    Delete one chapter's narration (file and status). Works for
//         chapters since removed from the book too. A queued chapter is
//         simply cancelled; a generating one must finish first.
//@route   DELETE /api/books/:id/audio/:chapterId
//@access  Private/Admin (owner)
const deleteChapterAudio = async (req, res) => {
    try {
        const book = await loadOwnedBook(req, res, 'chapters audio');
        if (!book) return;
        const entry = entryMap(book).get(String(req.params.chapterId));
        if (!entry) return res.status(404).json({ message: 'This chapter has no audio.' });
        if (entry.status === 'generating') {
            return res.status(409).json({ message: 'This chapter is generating right now. Wait for it to finish, then delete.' });
        }

        if (entry.publicId) {
            try {
                await deleteAudioAsset(entry.publicId);
            } catch (error) {
                console.error(`[audio] Couldn't delete ${entry.publicId} (book ${book._id}):`, error.message);
                return res.status(502).json({ message: "Couldn't delete the audio file from storage. Please try again." });
            }
        }

        await Book.updateOne(
            { _id: book._id },
            { $pull: { 'audio.chapters': { chapterId: entry.chapterId, status: { $ne: 'generating' } } } }
        );
        const fresh = await Book.findById(book._id).select('userId chapters audio');
        res.status(200).json(await buildStatus(fresh));
    } catch (error) {
        console.error('[audio] delete error:', error);
        res.status(500).json({ message: 'Server Error' });
    }
};

// First sentence of the first chapter that has text (capped at
// PREVIEW_MAX_CHARS, cut between words), else the book title.
const previewTextFor = (book) => {
    for (const chapter of book.chapters) {
        const { body } = chapterNarration(chapter);
        if (!body) continue;
        let sentence = splitSentences(body.split(/\n\s*\n/)[0])[0] || '';
        if (sentence.length > PREVIEW_MAX_CHARS) {
            sentence = `${sentence.slice(0, PREVIEW_MAX_CHARS).replace(/\s+\S*$/, '')}…`;
        }
        if (sentence) return sentence;
    }
    return book.title;
};

//@desc    Hear a voice: synthesizes only the book's first sentence and
//         returns it as audio/mpeg (nothing is stored). Counts toward the
//         daily character cap.
//@route   POST /api/books/:id/audio/preview   Body: { voice }
//@access  Private/Admin (owner)
const previewVoice = async (req, res) => {
    try {
        const book = await loadOwnedBook(req, res, 'title chapters');
        if (!book) return;
        const voice = req.body?.voice || DEFAULT_VOICE;
        if (!isValidVoice(voice)) return res.status(400).json({ message: `Unknown voice "${voice}".` });

        const text = previewTextFor(book);
        const charge = await chargeChars(text.length);
        if (!charge.ok) {
            return res.status(429).json({ message: "Today's narration character limit has been reached (UTC day)." });
        }

        let audio;
        try {
            audio = await synthesizeSpeech(text, { voice, retries: 1 });
        } catch (error) {
            console.error('[audio] preview TTS error:', error.message);
            return res.status(502).json({ message: `Couldn't generate the preview: ${describeTtsError(error)}` });
        }
        const { buffer } = await encodeMp3([audio.samples], { sampleRate: audio.sampleRate });
        res.set({ 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'X-Preview-Text-Length': String(text.length) });
        res.status(200).send(buffer);
    } catch (error) {
        console.error('[audio] preview error:', error);
        res.status(500).json({ message: 'Server Error' });
    }
};

module.exports = { getAudioStatus, generateAudio, deleteChapterAudio, previewVoice };
