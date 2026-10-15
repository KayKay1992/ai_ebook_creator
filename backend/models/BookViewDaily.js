const mongoose = require('mongoose');

// Anonymous page-view counts for the public Kenlibs book page, one document
// per book per day (Africa/Lagos day, 'YYYY-MM-DD'). Only a number: no IP,
// user, email, cookie or browser fingerprint is stored or used. The browser
// itself sends at most one view per book per day (localStorage), and the
// endpoint is rate-limited and skips obvious bots (controller/bookViewController.js).
// Feeds the analytics funnel (views → signups → requests → approved).
// Turn off with BOOK_VIEW_TRACKING_ENABLED=false.
const bookViewDailySchema = new mongoose.Schema(
    {
        book: { type: mongoose.Schema.Types.ObjectId, ref: 'Book', required: true },
        day: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
        views: { type: Number, default: 0 },
    },
    { timestamps: false }
);

bookViewDailySchema.index({ book: 1, day: 1 }, { unique: true });
bookViewDailySchema.index({ day: 1 });

module.exports = mongoose.model('BookViewDaily', bookViewDailySchema);
