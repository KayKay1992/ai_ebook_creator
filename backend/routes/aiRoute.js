const express = require('express');
const rateLimit = require('express-rate-limit');

const { generateOutline, extendOutline, generateIntroConclusion, generateChapterContent, editSelection, generateBlurb, generateTeaser, generateChapterSummary } = require('../controller/aiController');
const { protect, adminOnly } = require('../middleware/authMiddleware');


const router = express.Router();

// Every AI generation route is an admin authoring tool (the controllers
// also check book ownership). Readers' AI feature, word explanations, lives
// in kenlibsController.js behind hasBookAccess instead.
router.use(protect, adminOnly);

const AI_RATE_LIMIT_MAX = 20; // requests per user per hour
const AI_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

const makeLimiter = (max) =>
    rateLimit({
        windowMs: AI_RATE_LIMIT_WINDOW_MS,
        max,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => req.user._id.toString(),
        handler: (req, res) => {
            res.status(429).json({ message: 'Rate limit exceeded, try again later.' });
        },
    });

const aiRateLimiter = makeLimiter(AI_RATE_LIMIT_MAX);
// Chapter summaries are one small request per chapter and "Generate for
// all" walks a whole book, so they get their own, larger budget rather than
// using up the shared one above (a 22-chapter book alone would exceed it).
const summaryRateLimiter = makeLimiter(120);

router.post('/generate-outline', aiRateLimiter, generateOutline);
router.post('/extend-outline/:bookId', aiRateLimiter, extendOutline);
router.post('/generate-intro-conclusion/:bookId', aiRateLimiter, generateIntroConclusion);
router.post('/generate-chapter-content', aiRateLimiter, generateChapterContent);
router.post('/edit-selection', aiRateLimiter, editSelection);
router.post('/generate-blurb', aiRateLimiter, generateBlurb);
router.post('/generate-teaser', aiRateLimiter, generateTeaser);
router.post('/chapter-summary', summaryRateLimiter, generateChapterSummary);

module.exports = router;
