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
    shareId: {
        type: String,
        default: null,
        unique: true,
        sparse: true,
    },
    templateId: {
        type: String,
        enum: ['classic', 'modern', 'manuscript'],
        default: 'classic',
    },
},
    {
        timestamps: true
    }
);

module.exports = mongoose.model('Book', bookSchema);