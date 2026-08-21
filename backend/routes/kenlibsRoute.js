const express = require('express');
const router = express.Router();
const { readBook, getProgress, updateProgress, getCertificate } = require('../controller/kenlibsController');
const { protect } = require('../middleware/authMiddleware');

// Any authenticated user (reader or admin) — deliberately no adminOnly;
// the actual access decision happens per-book inside each controller
// (hasBookAccess in kenlibsController.js).
router.use(protect);

router.get('/read/:bookId', readBook);
router.get('/progress/:bookId', getProgress);
router.put('/progress/:bookId', updateProgress);
router.get('/certificate/:bookId', getCertificate);

module.exports = router;
