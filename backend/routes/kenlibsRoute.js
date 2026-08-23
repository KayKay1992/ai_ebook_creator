const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const {
    readBook,
    getProgress,
    updateProgress,
    getCertificate,
    explainInContext,
    createOrUpdateRating,
    getRatings,
    getMyRating,
    getBookAccess,
    getMyAccessMap,
} = require('../controller/kenlibsController');
const { protect } = require('../middleware/authMiddleware');

// Genuinely public — same reasoning as the storefront itself (see
// KENLIBS-ARCHITECTURE.md): an aggregate rating is a trust signal shown to
// every visitor, not gated reader content. Registered before router.use
// (protect) below, so it's the one route on this router Express reaches
// without that middleware ever running.
router.get('/ratings/:bookId', getRatings);

// Any authenticated user (reader or admin) — deliberately no adminOnly;
// the actual access decision happens per-book inside each controller
// (hasBookAccess in kenlibsController.js).
router.use(protect);

// Same shape as aiRoute.js's aiRateLimiter (20/user/hour) — explainInContext
// is a real Gemini call, and this reader-facing router has no other rate
// limiting of its own.
const explainRateLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user._id.toString(),
    handler: (req, res) => {
        res.status(429).json({ message: 'Rate limit exceeded, try again later.' });
    },
});

router.get('/my-access-map', getMyAccessMap);
router.get('/access/:bookId', getBookAccess);
router.get('/read/:bookId', readBook);
router.get('/progress/:bookId', getProgress);
router.put('/progress/:bookId', updateProgress);
router.get('/certificate/:bookId', getCertificate);
router.post('/explain/:bookId', explainRateLimiter, explainInContext);
router.post('/ratings/:bookId', createOrUpdateRating);
router.get('/ratings/:bookId/mine', getMyRating);

module.exports = router;
