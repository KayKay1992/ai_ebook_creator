const mongoose = require('mongoose');

// Audit trail of destructive admin actions (today: deleting a book, see
// controller/bookController.js deleteBook and utils/bookDeletion.js). A
// snapshot of what was deleted, by whom and when, so a deletion can be
// traced (and matched with a backup) after the book itself is gone. Only
// the acting admin's id, never readers' ids or emails; buyer numbers are
// counts. Kept indefinitely (small, rare records). Not the error log
// (models/ErrorLog.js) and not AuthEvent (passkeys).
const adminEventSchema = new mongoose.Schema({
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ['book_deleted'], required: true },
    bookId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    title: { type: String, default: '', maxlength: 300 },
    author: { type: String, default: '', maxlength: 200 },
    status: { type: String, default: '' },
    chapterCount: { type: Number, default: 0 },
    // Readers who had access: their own approved purchase, or an approved bundle containing it.
    buyerCount: { type: Number, default: 0 },
    pendingCount: { type: Number, default: 0 },
    bundleTitles: { type: [String], default: [] },
    createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('AdminEvent', adminEventSchema);
