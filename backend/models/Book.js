const mongoose = require('mongoose');

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
    author: {
        type: String,
        required: true
    },
    coverImage: {
        type: String,
        default: '',
    },
    chapters: [chapterSchema],
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
    },
},
    {
        timestamps: true
    }
);

module.exports = mongoose.model('Book', bookSchema);