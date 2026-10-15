const mongoose = require('mongoose');

// A reader's private highlight or bookmark in a book (see
// controller/annotationController.js). One document per annotation, indexed
// by reader + book so the reader loads all of a book's annotations in one
// query. Private to the reader: every query filters on `reader`, there's no
// admin or public endpoint for them, and they're deleted with the book or
// the reader's account.
//
// Anchoring (frontend/src/utils/annotationAnchor.js): paragraphIndex is the
// index of the paragraph in the reader's rendered block list (the same
// list Listen Mode's block index uses), offsets are character offsets into
// that paragraph's visible text, and quote/prefix/suffix let the reader
// find the text again after the chapter was edited. A highlight stays
// within one paragraph. A bookmark has no offsets (paragraphIndex null =
// the chapter's start).

const NOTE_MAX_LENGTH = 1000;
const LABEL_MAX_LENGTH = 120;
const QUOTE_MAX_LENGTH = 2000;
const CONTEXT_MAX_LENGTH = 64;
const HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink'];

const anchorSchema = new mongoose.Schema(
    {
        paragraphIndex: { type: Number, min: 0, default: null },
        startOffset: { type: Number, min: 0, default: null },
        endOffset: { type: Number, min: 0, default: null },
        quote: { type: String, maxlength: QUOTE_MAX_LENGTH, default: '' },
        prefix: { type: String, maxlength: CONTEXT_MAX_LENGTH, default: '' },
        suffix: { type: String, maxlength: CONTEXT_MAX_LENGTH, default: '' },
    },
    { _id: false }
);

const readerAnnotationSchema = new mongoose.Schema(
    {
        reader: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        book: { type: mongoose.Schema.Types.ObjectId, ref: 'Book', required: true },
        chapterId: { type: mongoose.Schema.Types.ObjectId, required: true },
        // 'original', or a translation language code: a highlight made on a
        // translation belongs to that language only.
        language: { type: String, required: true, default: 'original' },
        type: { type: String, enum: ['highlight', 'bookmark'], required: true },
        color: { type: String, enum: HIGHLIGHT_COLORS, default: 'yellow' },
        note: { type: String, maxlength: NOTE_MAX_LENGTH, default: '' },
        label: { type: String, maxlength: LABEL_MAX_LENGTH, default: '' },
        anchor: { type: anchorSchema, default: () => ({}) },
    },
    { timestamps: true }
);

readerAnnotationSchema.index({ reader: 1, book: 1, createdAt: 1 });

module.exports = mongoose.model('ReaderAnnotation', readerAnnotationSchema);
module.exports.NOTE_MAX_LENGTH = NOTE_MAX_LENGTH;
module.exports.LABEL_MAX_LENGTH = LABEL_MAX_LENGTH;
module.exports.QUOTE_MAX_LENGTH = QUOTE_MAX_LENGTH;
module.exports.CONTEXT_MAX_LENGTH = CONTEXT_MAX_LENGTH;
module.exports.HIGHLIGHT_COLORS = HIGHLIGHT_COLORS;
