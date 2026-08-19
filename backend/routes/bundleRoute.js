const express = require('express');
const router = express.Router();
const {
    getBundles,
    getBundleById,
    createBundle,
    updateBundle,
    deleteBundle,
} = require('../controller/bundleController');
const { protect, adminOnly } = require('../middleware/authMiddleware');

// Bundles have no owner concept (unlike Book) — they're a shared admin
// resource, so this is a straight admin-only gate, no per-document
// ownership check needed.
router.use(protect, adminOnly);

router.route('/')
    .get(getBundles)
    .post(createBundle);

router.route('/:id')
    .get(getBundleById)
    .put(updateBundle)
    .delete(deleteBundle);

module.exports = router;
