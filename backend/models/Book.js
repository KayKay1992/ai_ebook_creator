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
},
    {
        timestamps: true
    }
);

module.exports = mongoose.model('Book', bookSchema);