const express = require('express');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const { getRoyalties, createRoyaltyPayment, deleteRoyaltyPayment } = require('../controller/royaltyController');

// Royalties report and payment records (controller/royaltyController.js),
// mounted at /api/admin/royalties. Admin only.
const router = express.Router();
router.use(protect, adminOnly);

router.get('/', getRoyalties);
router.post('/payments', createRoyaltyPayment);
router.delete('/payments/:id', deleteRoyaltyPayment);

module.exports = router;
