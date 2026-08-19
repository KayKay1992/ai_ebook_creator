const express = require('express');
const router = express.Router();
const { getBooks, createBook, getBookById, updateBook, deleteBook, updateBookCover, uploadChapterImage, togglePublishStatus, updateCoverDesignFrontImage, updateCoverDesignAuthorPhoto } = require('../controller/bookController');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const { uploadCover, uploadChapterImage: uploadChapterImageMiddleware, uploadCoverDesignImage } = require('../middleware/uploadMiddleware');

// Every book route is admin-only per KENLIBS-ARCHITECTURE.md's route map
// ("Existing (admin-only from now on)"). This also closes a real gap: a
// reader with a valid token could otherwise still call these directly
// (e.g. POST / to create a book they'd own, then PUT /:id to set its
// price) even though the frontend never lets them navigate here — the
// ownership check alone doesn't stop someone from creating their own
// resource to own.
router.use(protect, adminOnly);

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