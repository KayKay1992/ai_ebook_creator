const express = require('express');
const router = express.Router();
const { getBooks, createBook, getBookById, updateBook, deleteBook, updateBookCover, uploadChapterImage } = require('../controller/bookController');
const { protect } = require('../middleware/authMiddleware');
const { uploadCover, uploadChapterImage: uploadChapterImageMiddleware } = require('../middleware/uploadMiddleware');

// Apply the protect middleware to all routes in this router
router.use(protect);

router.route('/')
    .get(getBooks)
    .post(createBook);

router.route('/:id')
    .get(getBookById)
    .put(updateBook)
    .delete(deleteBook);

router.route('/cover/:id')
    .put(uploadCover, updateBookCover);

router.route('/chapter-image/:id')
    .post(uploadChapterImageMiddleware, uploadChapterImage);

module.exports = router;