const mongoose = require('mongoose');

// A royalty payment the admin recorded as made to an author ("mark as
// paid"). Bookkeeping only: Kenlibs never sends money itself. Authors are
// matched by name (authorKey = trimmed, lowercased Book.author), the same
// grouping the royalties report uses (controller/royaltyController.js).
const royaltyPaymentSchema = new mongoose.Schema(
    {
        authorKey: { type: String, required: true, index: true },
        authorName: { type: String, required: true, maxlength: 200 },
        amount: { type: Number, required: true, min: 0.01 },
        paidAt: { type: Date, required: true },
        note: { type: String, default: '', maxlength: 1000 },
        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    },
    { timestamps: true }
);

module.exports = mongoose.model('RoyaltyPayment', royaltyPaymentSchema);
