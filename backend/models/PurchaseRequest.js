const mongoose = require('mongoose');

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
        status: {
            type: String,
            enum: ['pending', 'approved', 'rejected'],
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
    },
    {
        timestamps: true,
    }
);

module.exports = mongoose.model('PurchaseRequest', purchaseRequestSchema);
