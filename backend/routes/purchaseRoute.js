const express = require('express');
const router = express.Router();
const {
    createPurchaseRequest,
    getMyPurchaseRequests,
    getAllPurchaseRequests,
    approvePurchaseRequest,
    rejectPurchaseRequest,
    revokePurchaseRequest,
    resubmitPurchaseRequest,
} = require('../controller/purchaseController');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const { uploadPurchaseEvidence } = require('../middleware/uploadMiddleware');

// Any authenticated user (reader or admin) — deliberately no adminOnly
// here, this is the reader-facing purchase flow.
router.use(protect);

router.post('/', uploadPurchaseEvidence, createPurchaseRequest);
router.get('/mine', getMyPurchaseRequests);
// Reader-owned — resubmitPurchaseRequest itself enforces the request
// belongs to the requesting user, not adminOnly.
router.put('/:id/resubmit', uploadPurchaseEvidence, resubmitPurchaseRequest);

// Admin approval queue — everything below is admin-only.
router.get('/', adminOnly, getAllPurchaseRequests);
router.put('/:id/approve', adminOnly, approvePurchaseRequest);
router.put('/:id/reject', adminOnly, rejectPurchaseRequest);
router.put('/:id/revoke', adminOnly, revokePurchaseRequest);

module.exports = router;
