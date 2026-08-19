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
function wrapUpload(multerHandler, maxSizeLabel) {
    return (req, res, next) => {
        multerHandler(req, res, function (err) {
            if (err instanceof multer.MulterError) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return res.status(400).json({ message: `Image must be smaller than ${maxSizeLabel}.` });
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

module.exports = {
    uploadCover: wrapUpload(uploadCoverImage, '5MB'),
    uploadChapterImage: wrapUpload(uploadChapterImage, '8MB'),
    uploadCoverDesignImage: wrapUpload(uploadCoverDesignImage, '5MB'),
    uploadPurchaseEvidence: wrapUpload(uploadPurchaseEvidence, '5MB'),
};
