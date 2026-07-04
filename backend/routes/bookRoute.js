const express = require('express');
const router = express.Router();
const { getBooks, createBook, getBookById, updateBook, deleteBook, updateBookCover } = require('../controller/bookController');
const { protect } = require('../middleware/authMiddleware');
const upload = require('../middleware/uploadMiddleware');

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
    .put(upload, updateBookCover);

module.exports = router;