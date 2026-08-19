const express = require('express');
const router = express.Router();
const { getReaders } = require('../controller/adminController');
const { protect, adminOnly } = require('../middleware/authMiddleware');

router.use(protect, adminOnly);

router.get('/users', getReaders);

module.exports = router;
