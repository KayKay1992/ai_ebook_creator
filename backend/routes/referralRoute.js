const express = require('express');
const router = express.Router();
const { getMyReferralSummary } = require('../controller/referralController');
const { protect } = require('../middleware/authMiddleware');

router.get('/me', protect, getMyReferralSummary);

module.exports = router;
