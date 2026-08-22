const express = require('express');
const router = express.Router();
const { getReaders, resetUserPassword } = require('../controller/adminController');
const { protect, adminOnly } = require('../middleware/authMiddleware');

router.use(protect, adminOnly);

router.get('/users', getReaders);
router.post('/users/:id/reset-password', resetUserPassword);

module.exports = router;
