const cloudinary = require("../config/cloudinary");

// Uploads an in-memory file buffer (from multer.memoryStorage(), or a
// generated MP3) straight to Cloudinary via its resumable upload stream — no
// temp file on disk.
//
// `options` are passed through to Cloudinary's upload call. Images need
// none (every existing caller passes just a folder and gets exactly what it
// always did); audio passes e.g. { resource_type: "video", type:
// "authenticated" } (Cloudinary stores audio under the "video" type).
const uploadBufferToCloudinary = (buffer, folder, options = {}) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { resource_type: "image", ...options, folder },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    stream.end(buffer);
  });
};

module.exports = { uploadBufferToCloudinary };
