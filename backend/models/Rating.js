const mongoose = require('mongoose');

// One rating per reader per book (see the compound unique index below) — a
// reader editing their existing rating updates this same document rather
// than creating a second one (see kenlibsController.js's
// createOrUpdateRating, which upserts on {reader, book}). Deliberately
// separate from ReaderProgress (Step 32): progress is private per-reader
// data, a rating is a public-facing artifact (shown in the aggregate/reviews
// list to every visitor, not just the reader who wrote it).
const ratingSchema = new mongoose.Schema(
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
        stars: {
            type: Number,
            required: true,
            min: 1,
            max: 5,
        },
        // Optional written text — a star-only rating (no review) still
        // counts toward the average, but is excluded from the public
        // reviews list (see kenlibsController.js's getRatings).
        review: {
            type: String,
            default: '',
        },
    },
    {
        timestamps: true,
    }
);

// One rating document per reader per book, not multiple — a second POST
// from the same reader for the same book upserts this document instead of
// inserting a duplicate.
ratingSchema.index({ reader: 1, book: 1 }, { unique: true });

module.exports = mongoose.model('Rating', ratingSchema);
