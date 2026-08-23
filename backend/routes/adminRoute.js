const express = require('express');
const router = express.Router();
const { getReaders, resetUserPassword } = require('../controller/adminController');
const { getAnalytics } = require('../controller/analyticsController');
const { protect, adminOnly } = require('../middleware/authMiddleware');

router.use(protect, adminOnly);

router.get('/users', getReaders);
router.post('/users/:id/reset-password', resetUserPassword);
router.get('/analytics', getAnalytics);

module.exports = router;
