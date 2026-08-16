const express = require('express');
const router = express.Router();
const { exportAsDocument, exportAsPDF, exportAsEPUB } = require('../controller/exportController');
const { protect } = require('../middleware/authMiddleware');


router.get('/:id/pdf', protect, exportAsPDF);
router.get('/:id/doc', protect, exportAsDocument);
router.get('/:id/epub', protect, exportAsEPUB);

module.exports = router;