const mongoose = require('mongoose');

// AI translations of a book, one document per (book, language), kept out of
// the Book document on purpose: five languages of a long book would
// multiply its size, and many endpoints load Book documents whole. See
// utils/translationJobs.js (the background job) and
// controller/translationController.js (admin endpoints).
//
// Each translated chapter carries two copies of the text:
//   draft*      what the AI job and the admin's edits change
//   published*  what readers see (GET /api/kenlibs/read/:bookId/translation/:lang)
// reviewStatus describes the draft: 'draft' (needs review) → 'reviewed'
// (admin approved it) → 'published' (it is the live copy). Nothing is ever
// published automatically: only the admin's Publish action copies the
// draft to published*. Editing or re-translating changes only the draft,
// so a published chapter stays live, unchanged, until republished.

// A finished chunk of a chapter still being translated (resume after a
// failure or quota stop). `key` identifies the chunk's source text, model
// and language; a part whose key no longer matches is discarded.
const translationPartSchema = new mongoose.Schema(
    {
        index: { type: Number, required: true },
        key: { type: String, required: true },
        items: { type: [String], default: [] },
    },
    { _id: false }
);

const translatedChapterSchema = new mongoose.Schema(
    {
        chapterId: { type: mongoose.Schema.Types.ObjectId, required: true },

        // Background job state.
        //   none → queued → translating → done | failed | waiting
        // 'waiting' = stopped by Gemini's daily quota; parts are kept and
        // translating again continues from there.
        jobStatus: {
            type: String,
            enum: ['none', 'queued', 'translating', 'done', 'failed', 'waiting'],
            default: 'none',
        },
        chunksDone: { type: Number, default: 0 },
        chunksTotal: { type: Number, default: 0 },
        parts: { type: [translationPartSchema], default: [] },
        queuedAt: { type: Date },
        startedAt: { type: Date },
        // Refreshed while translating; a 'translating' entry whose
        // heartbeat went quiet was interrupted.
        heartbeatAt: { type: Date },
        error: { type: String, default: '' },
        // Things for the admin to check (e.g. a number that didn't come
        // through unchanged). Cleared by the next translation.
        warnings: { type: [String], default: [] },

        // The draft (AI output, then admin edits).
        draftTitle: { type: String, default: '' },
        draftContent: { type: String, default: '' },
        // utils/chapterHash.js hash of the source chapter the draft was
        // translated from: differs from the current one → "Out of date".
        sourceHash: { type: String, default: '' },
        translatedAt: { type: Date },
        // Set when the admin edits the draft by hand, so re-translating
        // asks before replacing their work.
        editedAt: { type: Date },
        reviewStatus: {
            type: String,
            enum: ['draft', 'reviewed', 'published'],
            default: 'draft',
        },

        // The live copy readers get. Empty = not published.
        publishedTitle: { type: String, default: '' },
        publishedContent: { type: String, default: '' },
        publishedSourceHash: { type: String, default: '' },
        publishedAt: { type: Date },
    },
    { _id: false }
);

const bookTranslationSchema = new mongoose.Schema(
    {
        bookId: { type: mongoose.Schema.Types.ObjectId, ref: 'Book', required: true },
        language: { type: String, required: true },
        chapters: { type: [translatedChapterSchema], default: [] },
    },
    { timestamps: true }
);

bookTranslationSchema.index({ bookId: 1, language: 1 }, { unique: true });
// The job worker looks for queued chapters across all books.
bookTranslationSchema.index({ 'chapters.jobStatus': 1 });

module.exports = mongoose.model('BookTranslation', bookTranslationSchema);
