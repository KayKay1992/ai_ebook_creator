const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { readBook, getProgress, updateProgress, getCertificate, explainInContext } = require('../controller/kenlibsController');
const { protect } = require('../middleware/authMiddleware');

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

router.get('/read/:bookId', readBook);
router.get('/progress/:bookId', getProgress);
router.put('/progress/:bookId', updateProgress);
router.get('/certificate/:bookId', getCertificate);
router.post('/explain/:bookId', explainRateLimiter, explainInContext);

module.exports = router;
