const express = require('express');
const router = express.Router();
const { createPurchaseRequest, getMyPurchaseRequests } = require('../controller/purchaseController');
const { protect } = require('../middleware/authMiddleware');
const { uploadPurchaseEvidence } = require('../middleware/uploadMiddleware');

// Any authenticated user (reader or admin) — deliberately no adminOnly
// here, this is the reader-facing purchase flow.
router.use(protect);

router.post('/', uploadPurchaseEvidence, createPurchaseRequest);
router.get('/mine', getMyPurchaseRequests);

module.exports = router;
