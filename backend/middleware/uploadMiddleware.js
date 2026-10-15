const multer = require('multer');
const path = require('path');

//check file type
function checkFileType(file, cb) {
    const filetypes = /jpeg|jpg|png|gif/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);

    if (extname && mimetype) {
        return cb(null, true);
    } else {
        cb('Error: Images Only!');
    }
}

//wrap a multer single-file handler so upload errors return clean JSON instead
//of falling through to Express's default HTML/stack-trace error handler
function wrapUpload(multerHandler, maxSizeLabel, kind = 'Image') {
    return (req, res, next) => {
        multerHandler(req, res, function (err) {
            if (err instanceof multer.MulterError) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return res.status(400).json({ message: `${kind} must be smaller than ${maxSizeLabel}.` });
                }
                return res.status(400).json({ message: err.message });
            }
            if (err) {
                // fileFilter rejects with a plain string, not an Error instance
                return res.status(400).json({ message: typeof err === 'string' ? err : 'Upload failed. Please try again.' });
            }
            next();
        });
    };
}

// Files are held in memory (req.file.buffer) and piped straight to Cloudinary
// from the controller — nothing is ever written to local disk. This also
// means the Cloudinary upload only happens after the controller's own
// book-ownership check passes, instead of a storage engine (e.g.
// multer-storage-cloudinary) uploading at the middleware layer before
// ownership has been verified.
const memoryStorage = multer.memoryStorage();

const uploadCoverImage = multer({
    storage: memoryStorage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: function (req, file, cb) {
        checkFileType(file, cb);
    }
}).single('coverImage');

const uploadChapterImage = multer({
    storage: memoryStorage,
    limits: { fileSize: 8 * 1024 * 1024 }, // 8MB limit — a bit more headroom than the cover for in-content screenshots/diagrams
    fileFilter: function (req, file, cb) {
        checkFileType(file, cb);
    }
}).single('chapterImage');

// Shared by both Cover Designer image slots (front background, author
// photo) — same size/type constraints as the plain cover image, single
// field name reused across both routes.
const uploadCoverDesignImage = multer({
    storage: memoryStorage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: function (req, file, cb) {
        checkFileType(file, cb);
    }
}).single('image');

// Payment evidence screenshot for a PurchaseRequest — same constraints as
// the plain cover image upload.
const uploadPurchaseEvidence = multer({
    storage: memoryStorage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: function (req, file, cb) {
        checkFileType(file, cb);
    }
}).single('evidenceImage');

// Chapter narration made elsewhere (audioController.js's
// uploadChapterAudioFile). 50MB is ~1h45m at 64 kbps or ~26 minutes at
// 256 kbps, and well under Cloudinary's 100MB free-plan video limit. The
// name and declared type are only a first filter; the controller parses
// the MP3 frames, which is the real check.
const AUDIO_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
const MP3_MIME_TYPES = new Set(['audio/mpeg', 'audio/mp3', 'audio/mpeg3', 'audio/x-mpeg-3', 'audio/x-mp3', 'application/octet-stream']);
const uploadChapterAudio = multer({
    storage: memoryStorage,
    limits: { fileSize: AUDIO_UPLOAD_MAX_BYTES },
    fileFilter: function (req, file, cb) {
        const isMp3 = path.extname(file.originalname || '').toLowerCase() === '.mp3' && MP3_MIME_TYPES.has(file.mimetype);
        cb(isMp3 ? null : 'Only MP3 files can be uploaded.', isMp3);
    }
}).single('audio');

module.exports = {
    AUDIO_UPLOAD_MAX_BYTES,
    uploadChapterAudio: wrapUpload(uploadChapterAudio, '50MB', 'Audio file'),
    uploadCover: wrapUpload(uploadCoverImage, '5MB'),
    uploadChapterImage: wrapUpload(uploadChapterImage, '8MB'),
    uploadCoverDesignImage: wrapUpload(uploadCoverDesignImage, '5MB'),
    uploadPurchaseEvidence: wrapUpload(uploadPurchaseEvidence, '5MB'),
};
