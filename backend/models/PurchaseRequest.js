const mongoose = require('mongoose');

// One entry per status-changing review event (reject, approve, revoke, or a
// reader's resubmit). Additive, never rewritten — the top-level
// status/adminNote/reviewedAt/reviewedBy fields still reflect the *current*
// state for convenience, but reviewHistory is the full back-and-forth, e.g.
// a request that was rejected, resubmitted, then approved.
const reviewHistoryEntrySchema = new mongoose.Schema(
    {
        status: {
            type: String,
            enum: ['pending', 'approved', 'rejected', 'revoked'],
            required: true,
        },
        note: {
            type: String,
            default: '',
        },
        // Unset for a reader's own resubmit entry — that's not an admin
        // review, just the reader resetting the request back to pending.
        reviewedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
        },
        reviewedAt: {
            type: Date,
            default: Date.now,
        },
    },
    { _id: false }
);

// A reader's request to buy a Book or Bundle — reviewed manually by an admin
// via evidence of an off-platform payment (see KENLIBS-ARCHITECTURE.md
// section 3's access-resolution rule: an approved request here is what
// eventually grants read access, checked server-side on every read).
const purchaseRequestSchema = new mongoose.Schema(
    {
        reader: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        itemType: {
            type: String,
            enum: ['book', 'bundle'],
            required: true,
        },
        // Points at a Book or Bundle depending on itemType — not a Mongoose
        // refPath field on purpose, since the controller already validates
        // the referenced document's existence/purchasability itself.
        item: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
        },
        // Snapshot of the item's price at request time, set server-side.
        // Never recomputed from the live Book/Bundle price later — if the
        // admin changes the price after this request, this value still
        // reflects what the reader actually agreed to pay.
        amount: {
            type: Number,
            required: true,
        },
        evidenceImage: {
            type: String,
            required: true,
        },
        // 'revoked' is deliberately distinct from 'rejected' — a revoked
        // request was once genuinely approved and later pulled, which
        // matters for records even though the access effect (no access) is
        // identical to rejected/pending.
        status: {
            type: String,
            enum: ['pending', 'approved', 'rejected', 'revoked'],
            default: 'pending',
        },
        adminNote: {
            type: String,
            default: '',
        },
        reviewedAt: {
            type: Date,
        },
        reviewedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
        },
        reviewHistory: {
            type: [reviewHistoryEntrySchema],
            default: [],
        },
    },
    {
        timestamps: true,
    }
);

module.exports = mongoose.model('PurchaseRequest', purchaseRequestSchema);
