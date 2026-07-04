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
const upload = multer({
    storage: storage,
    limits: { fileSize: 3 * 1024 * 1024 }, // 3MB limit
    fileFilter: function (req, file, cb) {
        checkFileType(file, cb);
    }
}).single('coverImage'); //file name for the uploaded file

module.exports = upload;