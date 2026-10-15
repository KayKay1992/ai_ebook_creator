const express = require('express');
const rateLimit = require('express-rate-limit');
const { reportClientError, listErrors, updateError, deleteError } = require('../controller/errorController');
const { protect, adminOnly } = require('../middleware/authMiddleware');

const router = express.Router();

// Browser error reports: public (errors happen before and without login),
// so limited per IP (app.js trusts the proxy on Render, so req.ip is the
// visitor's). Over the limit → 429; the frontend also throttles itself.
const reportLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ message: 'Too many reports.' }),
});
router.post('/report', reportLimiter, reportClientError);

// The admin Errors page.
router.get('/', protect, adminOnly, listErrors);
router.put('/:id', protect, adminOnly, updateError);
router.delete('/:id', protect, adminOnly, deleteError);

module.exports = router;
