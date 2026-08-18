const express = require('express');
const rateLimit = require('express-rate-limit');

const { generateOutline, generateChapterContent, editSelection, generateBlurb } = require('../controller/aiController');
const { protect } = require('../middleware/authMiddleware');


const router = express.Router();

//Apply the protect middleware to all routes in this router
router.use(protect);

const AI_RATE_LIMIT_MAX = 20; // requests per user per hour
const AI_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

const aiRateLimiter = rateLimit({
    windowMs: AI_RATE_LIMIT_WINDOW_MS,
    max: AI_RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user._id.toString(),
    handler: (req, res) => {
        res.status(429).json({ message: 'Rate limit exceeded, try again later.' });
    },
});

router.post('/generate-outline', aiRateLimiter, generateOutline);
router.post('/generate-chapter-content', aiRateLimiter, generateChapterContent);
router.post('/edit-selection', aiRateLimiter, editSelection);
router.post('/generate-blurb', aiRateLimiter, generateBlurb);

module.exports = router;