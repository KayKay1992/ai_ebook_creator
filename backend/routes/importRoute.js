const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const { parseImport, commitImport } = require('../controller/importController');
const { importLimits } = require('../utils/import/limits');

// "Import a book" (controller/importController.js), mounted at
// /api/admin/import. Admin only, rate-limited, size-limited; the file is
// held in memory only and checked by its bytes (utils/import/fileType.js).
const router = express.Router();
router.use(protect, adminOnly);

const perAdmin = (max) =>
    rateLimit({
        windowMs: 60 * 60 * 1000,
        max,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => req.user._id.toString(),
        handler: (req, res) => res.status(429).json({ message: 'Too many imports in an hour. Try again later.' }),
    });

const upload = (req, res, next) => {
    const limits = importLimits();
    multer({ storage: multer.memoryStorage(), limits: { fileSize: limits.maxFileBytes, files: 1, fields: 5, parts: 6 } }).single('file')(req, res, (error) => {
        if (!error) return next();
        if (error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ message: `The file is larger than ${limits.maxFileMb} MB.` });
        return res.status(400).json({ message: 'Upload one file, in the "file" field.' });
    });
};

router.post('/parse', perAdmin(30), upload, parseImport);
router.post('/commit', perAdmin(60), commitImport);

module.exports = router;
