// Limits for "Import a book" (controller/importController.js). The upload
// size and the picture caps are configurable (backend/.env.example); the
// archive caps protect the server from zip bombs and memory blow-ups and
// are not meant to be tuned day to day.
const positive = (value, fallback, max = Infinity) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback;
};

const MB = 1024 * 1024;

const importLimits = (env = process.env) => {
    const maxFileMb = positive(env.IMPORT_MAX_FILE_MB, 25);
    return {
        maxFileBytes: Math.round(maxFileMb * MB),
        maxFileMb,
        // .docx / .epub archives
        maxZipEntries: 2000,
        maxZipTotalBytes: 200 * MB, // all entries, uncompressed
        maxZipEntryBytes: 60 * MB, // one entry, uncompressed
        maxZipDepth: 12, // folders deep
        // Pictures carried into the review screen and then to Cloudinary.
        // The review screen sends them back as base64 in one JSON request
        // (express.json limit 50 MB in app.js), so the total is capped at 35 MB.
        maxImages: Math.floor(positive(env.IMPORT_MAX_IMAGES, 150, 500)),
        maxImageBytes: Math.round(positive(env.IMPORT_MAX_IMAGE_MB, 8, 20) * MB), // one picture
        maxTotalImageBytes: Math.round(positive(env.IMPORT_MAX_TOTAL_IMAGE_MB, 30, 35) * MB),
        // Widest a picture is delivered at (Cloudinary c_limit, never upscaled).
        imageMaxWidth: Math.floor(positive(env.IMPORT_IMAGE_MAX_WIDTH, 1600, 4000)),
        // One chapter longer than this, and no others: the review screen
        // warns and offers "Split by pattern".
        longChapterWords: Math.floor(positive(env.IMPORT_LONG_CHAPTER_WORDS, 8000)),
        // Parsed text
        maxChapters: 300,
        maxTotalChars: 5 * 1000 * 1000,
    };
};

module.exports = { importLimits };
