const express = require('express');
const router = express.Router();
const { getBooks, createBook, getBookById, updateBook, deleteBook, getDeleteImpact, updateBookCover, uploadChapterImage, togglePublishStatus, unpublishBook, updateBookRights, updateCoverDesignFrontImage, updateCoverDesignAuthorPhoto, updateRender3DFrontImage, updateRender3DBackImage } = require('../controller/bookController');
const { getAudioStatus, generateAudio, deleteChapterAudio, previewVoice, uploadChapterAudioFile } = require('../controller/audioController');
const {
    getTranslationsOverview,
    getTranslationStatus,
    getTranslatedChapter,
    queueTranslation,
    updateTranslatedChapter,
    reviewTranslatedChapter,
    publishTranslatedChapter,
    unpublishTranslatedChapter,
    publishAllReviewed,
    deleteTranslatedChapter,
} = require('../controller/translationController');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const rateLimit = require('express-rate-limit');
const { uploadCover, uploadChapterImage: uploadChapterImageMiddleware, uploadCoverDesignImage, uploadChapterAudio } = require('../middleware/uploadMiddleware');

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

// Deleting needs the typed title and, for published or bought books,
// explicit flags (utils/bookDeletion.js). Rate-limited per admin.
const perAdminHour = (max) =>
    rateLimit({
        windowMs: 60 * 60 * 1000,
        max,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => req.user._id.toString(),
        handler: (req, res) => res.status(429).json({ code: 'rate_limited', message: 'Too many deletions in an hour. Try again later.' }),
    });
const deleteBookLimiter = perAdminHour(30);
const deleteImpactLimiter = perAdminHour(300);

router.get('/:id/delete-impact', deleteImpactLimiter, getDeleteImpact);

router.route('/:id')
    .get(getBookById)
    .put(updateBook)
    .delete(deleteBookLimiter, deleteBook);

// AI audiobook narration (admin-only like the rest of this router; the
// controller checks ownership). Generation and previews call Gemini TTS, so
// they get their own per-user hourly limits on top of the daily character
// cap (AUDIO_DAILY_CHAR_LIMIT).
const audioLimiter = (max) =>
    rateLimit({
        windowMs: 60 * 60 * 1000,
        max,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => req.user._id.toString(),
        handler: (req, res) => res.status(429).json({ message: 'Rate limit exceeded, try again later.' }),
    });
const generateAudioLimiter = audioLimiter(60);
const previewVoiceLimiter = audioLimiter(30);
const uploadAudioLimiter = audioLimiter(60);
// Queuing translations (each queued chapter is a few Gemini requests in the
// background, paced by the job itself).
const translateLimiter = audioLimiter(60);

router.get('/:id/audio', getAudioStatus);
router.post('/:id/audio/generate', generateAudioLimiter, generateAudio);
router.post('/:id/audio/preview', previewVoiceLimiter, previewVoice);
router.delete('/:id/audio/:chapterId', deleteChapterAudio);
// MP3 made elsewhere (e.g. scripts/narrate-book.js output, a studio recording).
router.post('/:id/audio/:chapterId/upload', uploadAudioLimiter, uploadChapterAudio, uploadChapterAudioFile);

// AI translations (controller/translationController.js; owner-checked there).
router.get('/:id/translations', getTranslationsOverview);
router.get('/:id/translations/:lang', getTranslationStatus);
router.post('/:id/translations/:lang/translate', translateLimiter, queueTranslation);
router.post('/:id/translations/:lang/publish-reviewed', publishAllReviewed);
router.get('/:id/translations/:lang/:chapterId', getTranslatedChapter);
router.put('/:id/translations/:lang/:chapterId', updateTranslatedChapter);
router.delete('/:id/translations/:lang/:chapterId', deleteTranslatedChapter);
router.post('/:id/translations/:lang/:chapterId/review', reviewTranslatedChapter);
router.post('/:id/translations/:lang/:chapterId/publish', publishTranslatedChapter);
router.post('/:id/translations/:lang/:chapterId/unpublish', unpublishTranslatedChapter);

router.route('/cover/:id')
    .put(uploadCover, updateBookCover);

router.route('/chapter-image/:id')
    .post(uploadChapterImageMiddleware, uploadChapterImage);

router.route('/:id/publish')
    .put(togglePublishStatus);
// Takedown ("Unpublish immediately") and rights/royalty details.
router.post('/:id/unpublish', unpublishBook);
router.put('/:id/rights', updateBookRights);

router.route('/cover-design/front-image/:id')
    .put(uploadCoverDesignImage, updateCoverDesignFrontImage);

router.route('/cover-design/author-photo/:id')
    .put(uploadCoverDesignImage, updateCoverDesignAuthorPhoto);

router.route('/cover-design/render3d-front/:id')
    .put(uploadCoverDesignImage, updateRender3DFrontImage);

router.route('/cover-design/render3d-back/:id')
    .put(uploadCoverDesignImage, updateRender3DBackImage);

module.exports = router;