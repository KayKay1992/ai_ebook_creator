const express = require('express');
const router = express.Router();
const {
    getReaders,
    resetUserPassword,
    deleteUser,
    getReviewsForModeration,
    deleteRating,
} = require('../controller/adminController');
const { getAnalytics } = require('../controller/analyticsController');
const { protect, adminOnly } = require('../middleware/authMiddleware');

router.use(protect, adminOnly);

router.get('/users', getReaders);
router.post('/users/:id/reset-password', resetUserPassword);
router.delete('/users/:id', deleteUser);
router.get('/analytics', getAnalytics);
router.get('/ratings', getReviewsForModeration);
router.delete('/ratings/:id', deleteRating);

module.exports = router;
