const mongoose = require('mongoose');

// Shared with bookController.js's updateBook, which enforces it explicitly:
// findByIdAndUpdate skips schema validators, so maxlength alone would never
// actually reject an over-length update.
const PREVIEW_CONTENT_MAX_LENGTH = 2000;
// Same story for chapter summaries (3-5 sentences fit comfortably).
const CHAPTER_SUMMARY_MAX_LENGTH = 1200;
// What a chapter is: a numbered chapter, or front/back matter and part
// dividers, which keep their own title and get no chapter number in the
// reader (Preface, not "Chapter 1: Preface"). Set by "Import a book" and
// the editor; enforced in updateBook (findByIdAndUpdate skips validators).
const CHAPTER_KINDS = ['chapter', 'front', 'back', 'part'];

// Mirrors utils/tts.js's DEFAULT_VOICE (not imported, to keep the model free
// of the TTS client).
const DEFAULT_AUDIO_VOICE = 'Sulafat';

// A finished chunk of a chapter that is still being narrated (see
// utils/narrationPipeline.js): its own authenticated MP3 asset, so a retry
// after a failure or a quota stop only redoes the chunks that are missing.
// `key` identifies the chunk's text, voice and engine; a part whose key no
// longer matches is discarded. Cleared (and the assets deleted) once the
// chapter's full file is uploaded.
const audioPartSchema = new mongoose.Schema(
    {
        index: { type: Number, required: true },
        key: { type: String, required: true },
        publicId: { type: String, required: true },
        durationSec: { type: Number, default: 0 },
        bytes: { type: Number, default: 0 },
    },
    { _id: false }
);

// One entry per chapter that has (or had) narration — see
// utils/narrationPipeline.js for the lifecycle. Keyed by the chapter's _id,
// not its index, so reordering chapters never mixes up their audio.
//   queued → generating → ready | failed | waiting   (skipped: no text)
// 'waiting' = stopped by Gemini's daily quota; finished parts are kept and
// generating again continues from there. An admin upload goes straight to
// ready (source 'uploaded').
// publicId is the authenticated Cloudinary asset. It's kept while a
// regeneration is queued, running, waiting or has failed, so the previous
// audio stays playable until a replacement is uploaded. NEVER returned by
// any public or reader endpoint: readers only get short-lived signed URLs
// from GET /api/kenlibs/audio/:bookId, and the storefront only hasAudio + a
// count.
const audioChapterSchema = new mongoose.Schema(
    {
        chapterId: { type: mongoose.Schema.Types.ObjectId, required: true },
        status: {
            type: String,
            enum: ['queued', 'generating', 'ready', 'failed', 'waiting', 'skipped'],
            required: true,
        },
        // How the current audio was made: 'gemini' | 'local' | 'uploaded'
        // ('' for audio made before this field existed, which was Gemini).
        source: { type: String, default: '' },
        publicId: { type: String, default: '' },
        durationSec: { type: Number, default: 0 },
        bytes: { type: Number, default: 0 },
        // sha256 of the exact narration text the audio was made from
        // (utils/narrationText.js). Differs from the current text's hash →
        // the chapter was edited afterwards → "Out of date" in the editor.
        textHash: { type: String, default: '' },
        voice: { type: String, default: '' },
        charCount: { type: Number, default: 0 },
        // 0..1 while generating (chunks done / total).
        progress: { type: Number, default: 0 },
        // Chunk-level progress of the current or last unfinished run
        // ("5 of 7 done"); parts holds the finished chunks' audio.
        chunksDone: { type: Number, default: 0 },
        chunksTotal: { type: Number, default: 0 },
        parts: { type: [audioPartSchema], default: [] },
        queuedAt: { type: Date },
        startedAt: { type: Date },
        // Refreshed every few seconds by whoever is generating (server
        // worker or scripts/narrate-book.js). A 'generating' entry whose
        // heartbeat has gone quiet was interrupted and may be taken over.
        heartbeatAt: { type: Date },
        generatedAt: { type: Date },
        error: { type: String, default: '' },
    },
    { _id: false }
);

const chapterSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true
    },
    description: {
        type: String,
        default: ''
    },
    content: {
        type: String,
        default: ''
    },
    kind: {
        type: String,
        enum: CHAPTER_KINDS,
        default: 'chapter'
    },
    // Reader-facing "Chapter recap" (3-5 sentences), drafted by AI via
    // POST /api/ai/chapter-summary or written by hand, and only ever saved
    // by the admin's own editor save (an AI draft pauses autosave until
    // reviewed). Shown only in the gated reader (readBook); stripped from
    // the public share-link endpoint. Length is enforced in updateBook,
    // since findByIdAndUpdate skips schema validators.
    summary: {
        type: String,
        default: '',
        maxlength: CHAPTER_SUMMARY_MAX_LENGTH
    },
    // True once the admin has typed in the summary, so regenerating it asks
    // first. Admin bookkeeping: never sent to readers.
    summaryEdited: {
        type: Boolean,
        default: false
    },
    // utils/chapterHash.js hash of the chapter the summary was drafted
    // from; differs from the current one → "chapter changed since summary".
    summarySourceHash: {
        type: String,
        default: ''
    },
});

const bookSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    title: {
        type: String,
        required: true
    },
    subtitle: {
        type: String,
        default: ''
    },
    // The book's specific angle, argument, audience, or premise — distinct
    // from coverDesign.back.blurb (storefront sales copy) and from the
    // one-off `topic` sent to /api/ai/generate-outline (a broad
    // category/genre hint, never persisted). This is guiding context fed
    // into outline generation (see aiController.js) and is editable later
    // in BookDetailsTab.jsx, same as subtitle.
    description: {
        type: String,
        default: ''
    },
    // Storefront teaser: short, admin-authored sales copy shown on the public
    // Kenlibs book detail page (KenlibsBookDetailPage.jsx's "About this
    // book" section). Deliberately NOT an excerpt of the book, and separate
    // from coverDesign.back.blurb: the blurb is back-cover copy sized for
    // the cover layout (shown clamped on flip-card backs), while this is
    // longer-form page copy with a hook, the book's promise, and a closing
    // invitation. Drafted via /api/ai/generate-teaser (title, description,
    // and chapter titles/descriptions only) and always reviewed and saved
    // by the admin. Only ever returned by the single-book public detail
    // endpoint, never the storefront listing.
    previewContent: {
        type: String,
        default: '',
        maxlength: PREVIEW_CONTENT_MAX_LENGTH,
    },
    // Whether outline generation (generateOutline) and "Generate More
    // Chapters" (extendOutline) should enforce the Introduction-first /
    // Conclusion-last convention. Default true so existing books behave the
    // same as new ones unless an admin deliberately turns it off. See
    // aiController.js for where this actually shapes the prompt, and
    // extendOutline's conclusion-detection (checks the last chapter's title
    // for the literal word "Conclusion" — the same word generateOutline is
    // instructed to put there when this is on, so the two stay consistent).
    useIntroConclusionStructure: {
        type: Boolean,
        default: true
    },
    author: {
        type: String,
        required: true
    },
    coverImage: {
        type: String,
        default: '',
    },
    chapters: [chapterSchema],
    // AI audiobook narration (admin-generated, see audioController.js).
    // Only ever changed through the audio endpoints and the background job
    // — updateBook strips `audio` from the request body, since the editor
    // PUTs the whole book back and would otherwise overwrite job state.
    audio: {
        voice: { type: String, default: DEFAULT_AUDIO_VOICE },
        chapters: { type: [audioChapterSchema], default: [] },
    },
    status: {
        type: String,
        enum: ['draft', 'published'],
        default: 'draft',
    },
    // Public share identifier — generated the first time a book is
    // published (see controller/bookController.js's togglePublishStatus).
    // Deliberately not the Mongo _id: a short random token gives basic
    // obscurity so share links aren't guessable/enumerable from a book's id.
    // No `default` here on purpose: a sparse unique index only skips
    // documents where the field is truly *absent*, not ones storing an
    // explicit `null` — a `default: null` would make every draft book
    // write a literal null, and the second such book in the whole
    // collection would collide with the first on insert.
    shareId: {
        type: String,
        unique: true,
        sparse: true,
    },
    templateId: {
        type: String,
        enum: ['classic', 'modern', 'manuscript'],
        default: 'classic',
    },
    // Kenlibs storefront pricing (see KENLIBS-ARCHITECTURE.md). `price` and
    // `isForSale` are deliberately independent — an admin can price a book
    // ahead of time without listing it yet, and unlisting it (isForSale:
    // false) doesn't need to also clear the price.
    price: {
        type: Number,
        default: null,
    },
    isForSale: {
        type: Boolean,
        default: false,
    },
    // Persistent multi-tone voice profile, applied consistently to every
    // AI-generated chapter (see backend/utils/voiceProfile.js). `instruction`
    // is always derived server-side from `tones` — never trust a
    // client-supplied instruction string (see bookController.js).
    voiceProfile: {
        tones: {
            type: [String],
            default: [],
        },
        instruction: {
            type: String,
            default: '',
        },
    },
    // Full front/back cover design, edited on the dedicated Cover Designer
    // page (frontend/src/pages/CoverDesignerPage.jsx). All leaf fields have
    // defaults so `book.coverDesign` is always a populated object, never
    // undefined — components read it directly without null-guarding, and
    // the defaults (titleColor '#ffffff', titleAlign 'left', showSubtitle
    // true, backgroundStyle 'image') reproduce Step 15's original
    // CoverPreview look exactly, so books that never touch this page still
    // render the same as before.
    coverDesign: {
        front: {
            backgroundImage: { type: String, default: '' },
            backgroundStyle: {
                type: String,
                enum: ['image', 'gradient', 'solid'],
                default: 'image',
            },
            titleColor: { type: String, default: '#ffffff' },
            titleAlign: {
                type: String,
                enum: ['left', 'center', 'right'],
                default: 'left',
            },
            showSubtitle: { type: Boolean, default: true },
            genreTag: { type: String, default: '' },
            // Colors for backgroundStyle: 'gradient'. Left empty ('') by
            // default on purpose — CoverPreview.jsx treats an empty value as
            // "use the theme's --color-accent/--color-accent-secondary",
            // so books that picked gradient style before this field existed
            // (or never touched it) keep looking exactly the same.
            gradientFrom: { type: String, default: '' },
            gradientTo: { type: String, default: '' },
        },
        back: {
            blurb: { type: String, default: '' },
            authorBio: { type: String, default: '' },
            authorPhoto: { type: String, default: '' },
            reviewQuotes: {
                type: [
                    {
                        quote: { type: String, required: true },
                        attribution: { type: String, default: '' },
                    },
                ],
                default: [],
                validate: {
                    validator: (arr) => arr.length <= 3,
                    message: 'A cover can have at most 3 review quotes.',
                },
            },
            genreTag: { type: String, default: '' },
        },
        // Pre-rendered 3D cover mockup (Step 40) — an alternative to the
        // generated flat front/back design above, for a finished render made
        // externally (AI image tools, mockup generators, Photoshop) and
        // uploaded as-is. `isActive` is the single either/or switch: true
        // means frontImage/backImage supersede the flat coverDesign.front/
        // back everywhere a cover is shown (see CoverPreview.jsx), exactly
        // the same way coverDesign.front.backgroundImage already supersedes
        // the legacy top-level coverImage. Defaults keep this always a
        // populated object, same reasoning as the rest of coverDesign.
        render3D: {
            frontImage: { type: String, default: '' },
            backImage: { type: String, default: '' },
            isActive: { type: Boolean, default: false },
        },
    },
    // Client/author publishing-service tracking — for books the admin
    // publishes on behalf of another author for a flat one-time fee. There's
    // no separate author role in this app (the admin handles everything),
    // so `author` above is what displays publicly everywhere (storefront,
    // cover, exports, certificates) while these fields are purely the
    // admin's own bookkeeping. Deliberately never selected by any
    // reader-facing endpoint (storefront, book detail, certificate, the
    // reader's own readBook) — see kenlibsController.js/
    // publicBookController.js's explicit field allowlists.
    isClientPublished: {
        type: Boolean,
        default: false,
    },
    clientName: {
        type: String,
        default: '',
    },
    clientContact: {
        type: String,
        default: '',
    },
    publishingFee: {
        amount: { type: Number, default: null },
        paid: { type: Boolean, default: false },
        paidDate: { type: Date, default: null },
        notes: { type: String, default: '' },
    },
    // Rights and royalties for books by other authors (admin-only, never in
    // any public or reader response: every public/reader query selects an
    // explicit field list, and tests/bookImport.test.js proves it). The
    // displayed author is `author` above. Absent = "own" work, so existing
    // books need no migration. Edited only via PUT /api/books/:id/rights;
    // the general book update strips this. Publishing a non-own book needs
    // an explicit rights confirmation (togglePublishStatus).
    rights: {
        type: { type: String, enum: ['own', 'licensed', 'public_domain'], default: 'own' },
        holderName: { type: String, default: '', maxlength: 200 },
        holderContact: { type: String, default: '', maxlength: 300 },
        // Licence terms; for public domain, why the work is public domain.
        licenceNotes: { type: String, default: '', maxlength: 4000 },
        licenceReference: { type: String, default: '', maxlength: 200 },
        licenceExpiresAt: { type: Date, default: null },
        territory: { type: String, default: '', maxlength: 500 },
        // Share of CASH revenue (amount − creditApplied) owed to the holder.
        royaltyPercent: { type: Number, default: 0, min: 0, max: 100 },
        // Set when the admin ticks "I have the rights or written permission
        // to sell this book" while publishing.
        confirmedAt: { type: Date, default: null },
        confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        // Takedown: when/who unpublished it and an optional private note.
        takedownNote: { type: String, default: '', maxlength: 2000 },
        unpublishedAt: { type: Date, default: null },
        unpublishedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    },
    // Set when the book was created by "Import a book" (the uploaded file
    // itself is never stored).
    importedFrom: {
        format: { type: String, default: '' },
        fileName: { type: String, default: '' },
        importedAt: { type: Date, default: null },
    },
},
    {
        timestamps: true
    }
);

// Backs the Kenlibs storefront query (publicBookController.js's
// getKenlibsStorefront: find({ status: 'published' }).sort({ createdAt: -1 }))
// so it's an index scan in already-sorted order instead of a full
// collection scan plus in-memory sort over every book, drafts included.
bookSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Book', bookSchema);
module.exports.PREVIEW_CONTENT_MAX_LENGTH = PREVIEW_CONTENT_MAX_LENGTH;
module.exports.CHAPTER_SUMMARY_MAX_LENGTH = CHAPTER_SUMMARY_MAX_LENGTH;
module.exports.CHAPTER_KINDS = CHAPTER_KINDS;
