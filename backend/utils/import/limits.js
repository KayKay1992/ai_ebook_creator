// Limits for "Import a book" (controller/importController.js). The upload
// size is configurable; the archive and image caps protect the server from
// zip bombs and memory blow-ups and are not meant to be tuned day to day.
const positive = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
};

const importLimits = (env = process.env) => {
    const maxFileMb = positive(env.IMPORT_MAX_FILE_MB, 25);
    return {
        maxFileBytes: Math.round(maxFileMb * 1024 * 1024),
        maxFileMb,
        // .docx / .epub archives
        maxZipEntries: 2000,
        maxZipTotalBytes: 200 * 1024 * 1024, // all entries, uncompressed
        maxZipEntryBytes: 60 * 1024 * 1024, // one entry, uncompressed
        maxZipDepth: 12, // folders deep
        // Images carried into the review screen and then to Cloudinary.
        maxImages: 80,
        maxImageBytes: 8 * 1024 * 1024, // one image
        maxTotalImageBytes: 30 * 1024 * 1024,
        // Parsed text
        maxChapters: 300,
        maxTotalChars: 5 * 1000 * 1000,
    };
};

module.exports = { importLimits };
