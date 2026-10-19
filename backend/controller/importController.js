const Book = require('../models/Book');
const { parseUpload } = require('../utils/import/parseBook');
const { ImportError } = require('../utils/import/fileType');
const { importLimits } = require('../utils/import/limits');
const { decodeImageDataUri } = require('../utils/import/images');
const { parseRightsInput } = require('../utils/bookRights');
const { uploadBufferToCloudinary } = require('../utils/cloudinaryUpload');

// "Import a book" (admin). Two steps:
//   POST /api/admin/import/parse   multipart "file" → a draft to review.
//     The upload is held in memory only (multer memoryStorage), parsed and
//     then dropped: the original file is never written to disk, Cloudinary
//     or the database. Simpler and safer than storing it privately, and the
//     reviewed book is the thing worth keeping.
//   POST /api/admin/import/commit  the reviewed draft → a new DRAFT book
//     (never published automatically). Images still referenced by the
//     chapters (and the chosen cover) are uploaded to Cloudinary then.

const sendError = (res, error) => {
    if (error instanceof ImportError) return res.status(error.status || 400).json({ message: error.message });
    res.locals.error = error;
    return res.status(500).json({ message: "Couldn't import that file." });
};

const safeFileName = (name) => String(name || '').replace(/[^\w.\- ()]/g, '_').slice(0, 200);

//@route   POST /api/admin/import/parse
//@access  Private/Admin (rate-limited, size-limited)
const parseImport = async (req, res) => {
    try {
        if (!req.file?.buffer) return res.status(400).json({ message: 'Choose a file to import.' });
        const draft = await parseUpload(req.file.buffer, req.file.originalname);
        res.set('Cache-Control', 'no-store');
        res.status(200).json({ ...draft, fileName: safeFileName(req.file.originalname) });
    } catch (error) {
        sendError(res, error);
    }
};

const PLACEHOLDER = /!\[([^\]]*)\]\(kenlibs-import:([\w-]+)\)/g;

//@route   POST /api/admin/import/commit
//   { title, author, description, chapters: [{ title, content }],
//     images: { key: dataUri }, coverKey, format, fileName, rights? }
//@access  Private/Admin (rate-limited)
const commitImport = async (req, res) => {
    try {
        const limits = importLimits();
        const body = req.body || {};
        const title = typeof body.title === 'string' ? body.title.trim().slice(0, 300) : '';
        const author = typeof body.author === 'string' ? body.author.trim().slice(0, 200) : '';
        const description = typeof body.description === 'string' ? body.description.trim().slice(0, 5000) : '';
        if (!title) return res.status(400).json({ message: 'The book needs a title.' });
        if (!author) return res.status(400).json({ message: 'Add the author\'s name (shown on the storefront).' });
        if (!Array.isArray(body.chapters) || body.chapters.length === 0) return res.status(400).json({ message: 'The book needs at least one chapter.' });
        if (body.chapters.length > limits.maxChapters) return res.status(400).json({ message: `At most ${limits.maxChapters} chapters.` });
        let totalChars = 0;
        const chapters = [];
        for (const [index, chapter] of body.chapters.entries()) {
            if (!chapter || typeof chapter.title !== 'string' || typeof chapter.content !== 'string') {
                return res.status(400).json({ message: `Chapter ${index + 1} is not valid.` });
            }
            totalChars += chapter.content.length;
            chapters.push({ title: chapter.title.trim().slice(0, 300) || `Chapter ${index + 1}`, content: chapter.content });
        }
        if (totalChars > limits.maxTotalChars) return res.status(400).json({ message: 'The book is too long to import in one go.' });

        let rights;
        if (body.rights !== undefined) {
            const parsed = parseRightsInput(body.rights || {});
            if (parsed.error) return res.status(400).json({ message: parsed.error });
            rights = parsed.rights;
        }

        // Upload only images the chapters (or the cover) still use.
        // Each image as parse returned it ({ dataUri, ... }) or just the data URI.
        const images = {};
        if (body.images && typeof body.images === 'object') {
            for (const [key, value] of Object.entries(body.images)) images[key] = typeof value === 'string' ? value : value?.dataUri;
        }
        const used = new Set();
        for (const chapter of chapters) for (const m of chapter.content.matchAll(PLACEHOLDER)) used.add(m[2]);
        const coverKey = typeof body.coverKey === 'string' && images[body.coverKey] ? body.coverKey : null;
        if (used.size + (coverKey ? 1 : 0) > limits.maxImages) return res.status(400).json({ message: 'Too many images in this import.' });
        const urls = {};
        let imageBytes = 0;
        for (const key of used) {
            if (!images[key]) continue;
            const buffer = decodeImageDataUri(images[key], limits);
            imageBytes += buffer.length;
            if (imageBytes > limits.maxTotalImageBytes) return res.status(400).json({ message: 'The images in this import are too large.' });
            urls[key] = (await uploadBufferToCloudinary(buffer, 'ebook-creator/chapters')).secure_url;
        }
        let coverImage = '';
        if (coverKey) coverImage = (await uploadBufferToCloudinary(decodeImageDataUri(images[coverKey], limits), 'ebook-creator/covers')).secure_url;

        const finalChapters = chapters.map((chapter) => ({
            title: chapter.title,
            content: chapter.content.replace(PLACEHOLDER, (all, alt, key) => (urls[key] ? `![${alt}](${urls[key]})` : '')).replace(/\n{3,}/g, '\n\n').trim(),
        }));

        const book = await Book.create({
            userId: req.user._id,
            title,
            author,
            description,
            chapters: finalChapters,
            status: 'draft',
            ...(coverImage ? { coverImage } : {}),
            ...(rights ? { rights } : {}),
            importedFrom: {
                format: ['docx', 'epub', 'pdf', 'markdown', 'text'].includes(body.format) ? body.format : '',
                fileName: safeFileName(body.fileName),
                importedAt: new Date(),
            },
        });
        res.status(201).json({ _id: book._id, title: book.title, status: book.status, chapterCount: book.chapters.length });
    } catch (error) {
        sendError(res, error);
    }
};

module.exports = { parseImport, commitImport };
