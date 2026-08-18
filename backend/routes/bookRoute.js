const express = require('express');
const router = express.Router();
const { getBooks, createBook, getBookById, updateBook, deleteBook, updateBookCover, uploadChapterImage, togglePublishStatus, updateCoverDesignFrontImage, updateCoverDesignAuthorPhoto } = require('../controller/bookController');
const { protect } = require('../middleware/authMiddleware');
const { uploadCover, uploadChapterImage: uploadChapterImageMiddleware, uploadCoverDesignImage } = require('../middleware/uploadMiddleware');

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

router.route('/:id/publish')
    .put(togglePublishStatus);

router.route('/cover-design/front-image/:id')
    .put(uploadCoverDesignImage, updateCoverDesignFrontImage);

router.route('/cover-design/author-photo/:id')
    .put(uploadCoverDesignImage, updateCoverDesignAuthorPhoto);

module.exports = router;