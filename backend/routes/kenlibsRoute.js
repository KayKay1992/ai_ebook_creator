const express = require('express');
const router = express.Router();
const { readBook } = require('../controller/kenlibsController');
const { protect } = require('../middleware/authMiddleware');

// Any authenticated user (reader or admin) — deliberately no adminOnly;
// the actual access decision happens per-book inside readBook.
router.use(protect);

router.get('/read/:bookId', readBook);

module.exports = router;
