const multer = require('multer');
const path = require('path');
const fs = require('fs');

//create the uploads directory if it doesn't exist
const uploadDir = 'uploads';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

//set storage engine
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        cb(null, `${file.fieldname}-${Date.now()}${path.extname(file.originalname)}`);
    },
});

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

//initialize upload
const uploadCoverImage = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: function (req, file, cb) {
        checkFileType(file, cb);
    }
}).single('coverImage'); //file name for the uploaded file

//wrap multer so upload errors return clean JSON instead of falling through to
//Express's default HTML/stack-trace error handler
const upload = (req, res, next) => {
    uploadCoverImage(req, res, function (err) {
        if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ message: 'Image must be smaller than 5MB.' });
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

module.exports = upload;