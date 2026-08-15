const multer = require('multer');
const path = require('path');
const fs = require('fs');

//create the uploads directories if they don't exist
const uploadDir = 'uploads';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const chapterUploadDir = path.join(uploadDir, 'chapters');
if (!fs.existsSync(chapterUploadDir)) {
    fs.mkdirSync(chapterUploadDir, { recursive: true });
}

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

//--- Cover image (book-level, one per book) ---
const coverStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        cb(null, `${file.fieldname}-${Date.now()}${path.extname(file.originalname)}`);
    },
});

const uploadCoverImage = multer({
    storage: coverStorage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: function (req, file, cb) {
        checkFileType(file, cb);
    }
}).single('coverImage');

//--- Chapter content image (inline images inserted into chapter markdown) ---
const chapterImageStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, chapterUploadDir);
    },
    filename: function (req, file, cb) {
        cb(null, `${file.fieldname}-${Date.now()}${path.extname(file.originalname)}`);
    },
});

const uploadChapterImage = multer({
    storage: chapterImageStorage,
    limits: { fileSize: 8 * 1024 * 1024 }, // 8MB limit — a bit more headroom than the cover for in-content screenshots/diagrams
    fileFilter: function (req, file, cb) {
        checkFileType(file, cb);
    }
}).single('chapterImage');

module.exports = {
    uploadCover: wrapUpload(uploadCoverImage, '5MB'),
    uploadChapterImage: wrapUpload(uploadChapterImage, '8MB'),
};
