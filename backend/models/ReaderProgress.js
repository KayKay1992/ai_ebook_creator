const mongoose = require('mongoose');

// One document per reader+book — resume position and the reader's own
// private notes for that book. Deliberately as access-sensitive as the
// book content itself (see kenlibsController.js's hasBookAccess): a reader
// without an approved purchase for a book has no business reading or
// writing progress/notes for it either.
const readerProgressSchema = new mongoose.Schema(
    {
        reader: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        book: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Book',
            required: true,
        },
        lastChapterIndex: {
            type: Number,
            default: 0,
        },
        notes: {
            type: String,
            default: '',
        },
    },
    {
        timestamps: true,
    }
);

// One progress/notes document per reader per book, not multiple.
readerProgressSchema.index({ reader: 1, book: 1 }, { unique: true });

module.exports = mongoose.model('ReaderProgress', readerProgressSchema);
