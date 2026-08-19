const mongoose = require('mongoose');

// A Kenlibs storefront bundle — a priced grouping of existing books. A book
// can belong to multiple bundles simultaneously (no exclusivity constraint);
// see KENLIBS-ARCHITECTURE.md section 9 for why that's the deliberate choice.
const bundleSchema = new mongoose.Schema(
    {
        title: {
            type: String,
            required: true,
        },
        description: {
            type: String,
            default: '',
        },
        // Optional — the public storefront falls back to a generated grid of
        // included book covers when this isn't set (Step 25+).
        coverImage: {
            type: String,
            default: '',
        },
        books: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'Book',
            },
        ],
        price: {
            type: Number,
            required: true,
        },
        isForSale: {
            type: Boolean,
            default: false,
        },
    },
    {
        timestamps: true,
    }
);

module.exports = mongoose.model('Bundle', bundleSchema);
