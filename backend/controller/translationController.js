const mongoose = require('mongoose');
const Book = require('../models/Book');
const BookTranslation = require('../models/BookTranslation');
const { TRANSLATION_LANGUAGES, getLanguage, publicLanguage } = require('../config/translationLanguages');
const { chapterSourceHash } = require('../utils/chapterHash');
const { chapterItems, chunkItemIndexes } = require('../utils/translationText');
const { getTranslationModel } = require('../utils/translate');
const { kick, isActivelyTranslating, INTERRUPTED_MESSAGE } = require('../utils/translationJobs');
const { staleCutoff } = require('../utils/narrationPipeline');

// Admin endpoints for AI translations, under /api/books/:id/translations
// (bookRoute.js applies protect + adminOnly; ownership is checked here like
// every other book endpoint). Translation runs in the background
// (utils/translationJobs.js); these handlers queue work, report status, and
// move a chapter's draft through review to publication:
//   translate → draft → (Mark reviewed) reviewed → (Publish) published
// Only Publish ever changes what readers see. Editing or re-translating a
// published chapter changes its draft only; the published copy stays live
// until the admin publishes again.

const TITLE_MAX_LENGTH = 500;
const CONTENT_MAX_LENGTH = 500000;

const loadOwnedBook = async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
        res.status(404).json({ message: 'Book not found' });
        return null;
    }
    const book = await Book.findById(req.params.id).select('userId title chapters');
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

// Owner check plus a valid language from config/translationLanguages.js.
const loadContext = async (req, res) => {
    const book = await loadOwnedBook(req, res);
    if (!book) return null;
    const language = getLanguage(req.params.lang);
    if (!language) {
        res.status(404).json({ message: `"${req.params.lang}" isn't one of the translation languages.` });
        return null;
    }
    const doc = await BookTranslation.findOne({ bookId: book._id, language: language.code });
    return { book, language, doc };
};

const entryMap = (doc) => new Map((doc?.chapters || []).map((entry) => [entry.chapterId.toString(), entry]));
const isInProgress = (entry) => entry?.jobStatus === 'queued' || isActivelyTranslating(entry);
const hasDraft = (entry) => Boolean(entry?.draftContent || entry?.draftTitle);
const isPublished = (entry) => Boolean(entry?.publishedContent || entry?.publishedTitle);

// Gemini requests a chapter needs (one per ~6,000-character chunk).
const chapterPlan = (chapter) => {
    const { items, translatable } = chapterItems(chapter);
    const chars = items.reduce((sum, item, i) => sum + (translatable[i] ? item.length : 0), 0);
    return { chars, requests: chunkItemIndexes(items, translatable).length };
};

const chapterStatus = (chapter, index, entry) => {
    const sourceHash = chapterSourceHash(chapter);
    const interrupted = entry?.jobStatus === 'translating' && !isActivelyTranslating(entry);
    const jobStatus = interrupted ? 'failed' : entry?.jobStatus || 'none';
    const { chars } = chapterPlan(chapter);
    const unfinished = ['queued', 'translating', 'failed', 'waiting'].includes(jobStatus);
    return {
        chapterId: chapter._id.toString(),
        index,
        title: chapter.title,
        sourceChars: chars,
        hasText: chars > 0,
        jobStatus,
        chunksDone: unfinished ? entry?.chunksDone || 0 : 0,
        chunksTotal: unfinished ? entry?.chunksTotal || 0 : 0,
        error: interrupted ? INTERRUPTED_MESSAGE : entry?.error || '',
        warnings: entry?.warnings || [],
        hasDraft: hasDraft(entry),
        draftTitle: entry?.draftTitle || '',
        reviewStatus: hasDraft(entry) ? entry.reviewStatus : null,
        isPublished: isPublished(entry),
        // The draft (or the published copy) was made from an older version
        // of the chapter.
        isStale: hasDraft(entry) && Boolean(entry.sourceHash) && entry.sourceHash !== sourceHash,
        isPublishedStale: isPublished(entry) && Boolean(entry.publishedSourceHash) && entry.publishedSourceHash !== sourceHash,
        hasUnpublishedChanges: isPublished(entry) && entry.reviewStatus !== 'published',
        editedByAdmin: Boolean(entry?.editedAt),
        translatedAt: entry?.translatedAt || null,
        publishedAt: isPublished(entry) ? entry.publishedAt || null : null,
    };
};

const buildStatus = (book, language, doc) => {
    const entries = entryMap(doc);
    const chapterIds = new Set(book.chapters.map((c) => c._id.toString()));
    const chapters = book.chapters.map((chapter, index) => chapterStatus(chapter, index, entries.get(chapter._id.toString())));
    // Translations of chapters since removed from the book: never shown to
    // readers, kept until the admin deletes them.
    const orphaned = (doc?.chapters || [])
        .filter((entry) => !chapterIds.has(entry.chapterId.toString()))
        .map((entry) => ({
            chapterId: entry.chapterId.toString(),
            draftTitle: entry.draftTitle,
            isPublished: isPublished(entry),
            jobStatus: entry.jobStatus,
        }));
    return {
        language: publicLanguage(language),
        model: getTranslationModel(),
        isWorking: (doc?.chapters || []).some(isInProgress),
        counts: {
            chapters: chapters.length,
            drafted: chapters.filter((c) => c.hasDraft).length,
            reviewed: chapters.filter((c) => c.reviewStatus === 'reviewed').length,
            published: chapters.filter((c) => c.isPublished).length,
        },
        chapters,
        orphaned,
    };
};

const respondWithStatus = async (res, book, language, status = 200) => {
    const doc = await BookTranslation.findOne({ bookId: book._id, language: language.code });
    res.set('Cache-Control', 'no-store');
    res.status(status).json(buildStatus(book, language, doc));
};

const handleError = (res, label) => (error) => {
    res.locals.error = error; // for error monitoring (middleware/errorCapture.js)
    console.error(`[translations] ${label} error:`, error);
    res.status(500).json({ message: 'Server Error' });
};

//@desc    Every language with this book's translation progress (overview).
//@route   GET /api/books/:id/translations
//@access  Private/Admin (owner)
const getTranslationsOverview = async (req, res) => {
    try {
        const book = await loadOwnedBook(req, res);
        if (!book) return;
        const docs = await BookTranslation.find({ bookId: book._id }).lean();
        const byLanguage = new Map(docs.map((doc) => [doc.language, doc]));
        const chapterIds = new Set(book.chapters.map((c) => c._id.toString()));
        res.set('Cache-Control', 'no-store');
        res.status(200).json({
            model: getTranslationModel(),
            languages: TRANSLATION_LANGUAGES.map((language) => {
                const entries = (byLanguage.get(language.code)?.chapters || []).filter((e) => chapterIds.has(e.chapterId.toString()));
                return {
                    ...publicLanguage(language),
                    chapters: book.chapters.length,
                    drafted: entries.filter(hasDraft).length,
                    published: entries.filter(isPublished).length,
                    isWorking: entries.some(isInProgress),
                };
            }),
        });
    } catch (error) {
        handleError(res, 'overview')(error);
    }
};

//@desc    Per-chapter translation status for one language (poll while working).
//@route   GET /api/books/:id/translations/:lang
//@access  Private/Admin (owner)
const getTranslationStatus = async (req, res) => {
    try {
        const ctx = await loadContext(req, res);
        if (!ctx) return;
        res.set('Cache-Control', 'no-store');
        res.status(200).json(buildStatus(ctx.book, ctx.language, ctx.doc));
    } catch (error) {
        handleError(res, 'status')(error);
    }
};

//@desc    One translated chapter's draft and published text, for editing.
//@route   GET /api/books/:id/translations/:lang/:chapterId
//@access  Private/Admin (owner)
const getTranslatedChapter = async (req, res) => {
    try {
        const ctx = await loadContext(req, res);
        if (!ctx) return;
        const chapter = mongoose.isValidObjectId(req.params.chapterId) ? ctx.book.chapters.id(req.params.chapterId) : null;
        if (!chapter) return res.status(404).json({ message: 'Chapter not found in this book.' });
        const entry = entryMap(ctx.doc).get(chapter._id.toString());
        res.set('Cache-Control', 'no-store');
        res.status(200).json({
            ...chapterStatus(chapter, ctx.book.chapters.indexOf(chapter), entry),
            source: { title: chapter.title, content: chapter.content || '' },
            draft: { title: entry?.draftTitle || '', content: entry?.draftContent || '' },
            published: { title: entry?.publishedTitle || '', content: entry?.publishedContent || '' },
        });
    } catch (error) {
        handleError(res, 'chapter')(error);
    }
};

// The language's document, created on first use.
const ensureDoc = async (bookId, code) => {
    try {
        return await BookTranslation.findOneAndUpdate(
            { bookId, language: code },
            { $setOnInsert: { chapters: [] } },
            { upsert: true, returnDocument: 'after' }
        );
    } catch (error) {
        if (error?.code !== 11000) throw error; // a concurrent upsert won the race
        return BookTranslation.findOne({ bookId, language: code });
    }
};

//@desc    Queue translation of one chapter, or every chapter without a
//         draft ("all-missing", which also resumes failed and
//         quota-stopped ones). Body: { chapterId | "all-missing", dryRun?,
//         replaceEdits? }. dryRun returns the plan (characters, Gemini
//         requests) without queuing. Re-translating a chapter whose draft
//         the admin edited needs replaceEdits: true (409 otherwise). Only
//         the draft is ever replaced; a published copy stays live.
//@route   POST /api/books/:id/translations/:lang/translate
//@access  Private/Admin (owner)
const queueTranslation = async (req, res) => {
    try {
        const ctx = await loadContext(req, res);
        if (!ctx) return;
        const { book, language } = ctx;
        const { chapterId, dryRun = false, replaceEdits = false } = req.body || {};
        if (!chapterId) return res.status(400).json({ message: 'chapterId is required (a chapter id, or "all-missing").' });

        const entries = entryMap(ctx.doc);
        let targets;
        if (chapterId === 'all-missing') {
            targets = book.chapters.filter((chapter) => {
                const entry = entries.get(chapter._id.toString());
                return !hasDraft(entry) && !isInProgress(entry);
            });
        } else {
            const chapter = mongoose.isValidObjectId(chapterId) ? book.chapters.id(chapterId) : null;
            if (!chapter) return res.status(404).json({ message: 'Chapter not found in this book.' });
            const entry = entries.get(chapter._id.toString());
            if (isInProgress(entry)) return res.status(409).json({ message: 'This chapter is already queued or translating.' });
            if (entry?.editedAt && hasDraft(entry) && !replaceEdits && !dryRun) {
                return res.status(409).json({
                    code: 'edited',
                    message: 'You edited this translation. Translating again replaces your edits in the draft (the published copy stays live).',
                });
            }
            targets = [chapter];
        }

        const planned = [];
        const skipped = [];
        for (const chapter of targets) {
            const plan = chapterPlan(chapter);
            const item = { chapterId: chapter._id.toString(), title: chapter.title, chars: plan.chars, requests: plan.requests };
            if (plan.requests) planned.push(item);
            else skipped.push({ ...item, reason: 'No text to translate.' });
        }
        const summary = {
            language: publicLanguage(language),
            chapters: planned,
            skipped,
            totalChars: planned.reduce((sum, c) => sum + c.chars, 0),
            totalRequests: planned.reduce((sum, c) => sum + c.requests, 0),
        };
        if (dryRun) return res.status(200).json({ dryRun: true, ...summary });
        if (!planned.length) {
            return res.status(400).json({ message: 'Nothing to translate: every chapter has a draft, is in progress, or has no text.', ...summary });
        }

        const doc = await ensureDoc(book._id, language.code);
        const existing = entryMap(doc);
        const now = Date.now();
        const writes = planned.map((c, i) => {
            const id = new mongoose.Types.ObjectId(c.chapterId);
            const fields = { jobStatus: 'queued', queuedAt: new Date(now + i), error: '' };
            if (existing.has(c.chapterId)) {
                const set = {};
                for (const [key, value] of Object.entries(fields)) set[`chapters.$[entry].${key}`] = value;
                return {
                    updateOne: {
                        filter: { _id: doc._id },
                        update: { $set: set },
                        // Never re-queue something that started meanwhile.
                        // Not if another request queued it meanwhile. (The worker
                        // only ever claims queued entries, so nothing else can
                        // start it between the check above and this write.)
                        arrayFilters: [{ 'entry.chapterId': id, 'entry.jobStatus': { $ne: 'queued' } }],
                    },
                };
            }
            return {
                updateOne: {
                    filter: { _id: doc._id, 'chapters.chapterId': { $ne: id } },
                    update: { $push: { chapters: { chapterId: id, ...fields } } },
                },
            };
        });
        await BookTranslation.bulkWrite(writes);
        kick();

        const fresh = await BookTranslation.findById(doc._id);
        res.status(202).json({ ...summary, status: buildStatus(book, language, fresh) });
    } catch (error) {
        handleError(res, 'queue')(error);
    }
};

// Matches an entry the admin may change right now: not queued, and not
// being translated (a 'translating' entry whose heartbeat stopped was
// interrupted, so it counts as free). Mirrors isInProgress.
const notBusy = () => ({
    $or: [
        { jobStatus: { $nin: ['queued', 'translating'] } },
        { jobStatus: 'translating', heartbeatAt: { $not: { $gte: staleCutoff() } } },
    ],
});

const targetChapter = (ctx, req, res) => {
    const chapter = mongoose.isValidObjectId(req.params.chapterId) ? ctx.book.chapters.id(req.params.chapterId) : null;
    if (!chapter) {
        res.status(404).json({ message: 'Chapter not found in this book.' });
        return null;
    }
    return chapter;
};

const busyResponse = (res, entry) =>
    res.status(409).json({
        message: entry?.jobStatus === 'queued' ? 'This chapter is queued for translation. Wait for it to finish.' : 'This chapter is being translated right now. Wait for it to finish.',
    });

//@desc    Save the admin's edits to a translated chapter's draft (or a
//         translation written by hand). The draft goes back to "draft"
//         (needs review again); a published copy stays live unchanged.
//         Body: { title, content }.
//@route   PUT /api/books/:id/translations/:lang/:chapterId
//@access  Private/Admin (owner)
const updateTranslatedChapter = async (req, res) => {
    try {
        const ctx = await loadContext(req, res);
        if (!ctx) return;
        const chapter = targetChapter(ctx, req, res);
        if (!chapter) return;
        const { title, content } = req.body || {};
        if (typeof title !== 'string' || typeof content !== 'string') {
            return res.status(400).json({ message: 'title and content must be text.' });
        }
        if (!title.trim() && !content.trim()) return res.status(400).json({ message: 'The translation is empty.' });
        if (title.length > TITLE_MAX_LENGTH || content.length > CONTENT_MAX_LENGTH) {
            return res.status(400).json({ message: `The title must be at most ${TITLE_MAX_LENGTH} characters and the text at most ${CONTENT_MAX_LENGTH.toLocaleString('en-US')}.` });
        }

        const entry = entryMap(ctx.doc).get(chapter._id.toString());
        if (isInProgress(entry)) return busyResponse(res, entry);

        const fields = {
            draftTitle: title,
            draftContent: content,
            editedAt: new Date(),
            reviewStatus: 'draft',
            // A first draft written by hand counts as made from the
            // current text; an edited AI draft keeps its original source.
            ...(hasDraft(entry) ? {} : { sourceHash: chapterSourceHash(chapter) }),
        };
        const id = chapter._id;
        const set = {};
        for (const [key, value] of Object.entries(fields)) set[`chapters.$.${key}`] = value;
        let saved = 0;
        if (entry) {
            saved = (
                await BookTranslation.updateOne(
                    { _id: ctx.doc._id, chapters: { $elemMatch: { chapterId: id, ...notBusy() } } },
                    { $set: set }
                )
            ).matchedCount;
        } else {
            const doc = await ensureDoc(ctx.book._id, ctx.language.code);
            saved = (
                await BookTranslation.updateOne(
                    { _id: doc._id, 'chapters.chapterId': { $ne: id } },
                    { $push: { chapters: { chapterId: id, ...fields } } }
                )
            ).matchedCount;
        }
        if (!saved) return busyResponse(res, entry);
        await respondWithStatus(res, ctx.book, ctx.language);
    } catch (error) {
        handleError(res, 'update')(error);
    }
};

// Moves one chapter's review state. `from` lists the states it may move
// from; `fields(entry)` gives what to set.
const transition = (label, { from, fields, requireDraft = true, reject }) => async (req, res) => {
    try {
        const ctx = await loadContext(req, res);
        if (!ctx) return;
        const chapter = targetChapter(ctx, req, res);
        if (!chapter) return;
        const entry = entryMap(ctx.doc).get(chapter._id.toString());
        if (requireDraft && !hasDraft(entry)) return res.status(400).json({ message: 'This chapter has no translation yet.' });
        if (isInProgress(entry)) return busyResponse(res, entry);
        const problem = reject?.(entry);
        if (problem) return res.status(400).json({ message: problem });
        if (!from.includes(entry.reviewStatus)) {
            return res.status(409).json({ message: `Can't ${label} a chapter that is "${entry.reviewStatus}".` });
        }
        const set = {};
        for (const [key, value] of Object.entries(fields(entry))) set[`chapters.$.${key}`] = value;
        const saved = await BookTranslation.updateOne(
            {
                _id: ctx.doc._id,
                chapters: { $elemMatch: { chapterId: chapter._id, reviewStatus: entry.reviewStatus, ...notBusy() } },
            },
            { $set: set }
        );
        if (!saved.matchedCount) return res.status(409).json({ message: 'This chapter changed meanwhile. Reload and try again.' });
        await respondWithStatus(res, ctx.book, ctx.language);
    } catch (error) {
        handleError(res, label)(error);
    }
};

const publishFields = (entry) => ({
    publishedTitle: entry.draftTitle,
    publishedContent: entry.draftContent,
    publishedSourceHash: entry.sourceHash,
    publishedAt: new Date(),
    reviewStatus: 'published',
});

//@desc    Mark a draft as reviewed (required before publishing).
//@route   POST /api/books/:id/translations/:lang/:chapterId/review
const reviewTranslatedChapter = transition('review', {
    from: ['draft'],
    fields: () => ({ reviewStatus: 'reviewed' }),
});

//@desc    Publish a reviewed draft: readers with access see it from now on.
//@route   POST /api/books/:id/translations/:lang/:chapterId/publish
const publishTranslatedChapter = transition('publish', {
    from: ['reviewed'],
    fields: publishFields,
});

//@desc    Take a chapter's translation off the reader (the draft is kept,
//         as reviewed).
//@route   POST /api/books/:id/translations/:lang/:chapterId/unpublish
const unpublishTranslatedChapter = transition('unpublish', {
    from: ['draft', 'reviewed', 'published'],
    reject: (entry) => (isPublished(entry) ? '' : "This chapter's translation isn't published."),
    fields: (entry) => ({
        publishedTitle: '',
        publishedContent: '',
        publishedSourceHash: '',
        publishedAt: null,
        reviewStatus: entry.reviewStatus === 'published' ? 'reviewed' : entry.reviewStatus,
    }),
});

//@desc    Publish every reviewed chapter of this language at once.
//@route   POST /api/books/:id/translations/:lang/publish-reviewed
//@access  Private/Admin (owner)
const publishAllReviewed = async (req, res) => {
    try {
        const ctx = await loadContext(req, res);
        if (!ctx) return;
        const chapterIds = new Set(ctx.book.chapters.map((c) => c._id.toString()));
        const ready = (ctx.doc?.chapters || []).filter(
            (entry) => entry.reviewStatus === 'reviewed' && hasDraft(entry) && !isInProgress(entry) && chapterIds.has(entry.chapterId.toString())
        );
        if (!ready.length) return res.status(400).json({ message: 'No reviewed chapters to publish.' });
        await BookTranslation.bulkWrite(
            ready.map((entry) => {
                const set = {};
                for (const [key, value] of Object.entries(publishFields(entry))) set[`chapters.$[entry].${key}`] = value;
                return {
                    updateOne: {
                        filter: { _id: ctx.doc._id },
                        update: { $set: set },
                        arrayFilters: [{ 'entry.chapterId': entry.chapterId, 'entry.reviewStatus': 'reviewed', 'entry.jobStatus': { $ne: 'queued' } }],
                    },
                };
            })
        );
        await respondWithStatus(res, ctx.book, ctx.language);
    } catch (error) {
        handleError(res, 'publish-reviewed')(error);
    }
};

//@desc    Delete one chapter's translation (draft and published copy).
//         Works for chapters since removed from the book too; a queued
//         chapter is simply cancelled.
//@route   DELETE /api/books/:id/translations/:lang/:chapterId
//@access  Private/Admin (owner)
const deleteTranslatedChapter = async (req, res) => {
    try {
        const ctx = await loadContext(req, res);
        if (!ctx) return;
        const entry = entryMap(ctx.doc).get(String(req.params.chapterId));
        if (!entry) return res.status(404).json({ message: 'This chapter has no translation.' });
        if (isActivelyTranslating(entry)) return busyResponse(res, entry);
        await BookTranslation.updateOne(
            { _id: ctx.doc._id },
            {
                $pull: {
                    chapters: {
                        chapterId: entry.chapterId,
                        $or: [{ jobStatus: { $ne: 'translating' } }, { heartbeatAt: { $not: { $gte: staleCutoff() } } }],
                    },
                },
            }
        );
        await respondWithStatus(res, ctx.book, ctx.language);
    } catch (error) {
        handleError(res, 'delete')(error);
    }
};

module.exports = {
    getTranslationsOverview,
    getTranslationStatus,
    getTranslatedChapter,
    queueTranslation,
    updateTranslatedChapter,
    reviewTranslatedChapter,
    publishTranslatedChapter,
    unpublishTranslatedChapter,
    publishAllReviewed,
    deleteTranslatedChapter,
};
