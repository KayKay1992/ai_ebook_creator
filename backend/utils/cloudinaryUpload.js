const cloudinary = require("../config/cloudinary");

// Uploads an in-memory file buffer (from multer.memoryStorage()) straight to
// Cloudinary via its resumable upload stream — no temp file on disk.
const uploadBufferToCloudinary = (buffer, folder) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "image" },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    stream.end(buffer);
  });
};

module.exports = { uploadBufferToCloudinary };
