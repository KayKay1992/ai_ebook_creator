const PDFDocument = require('pdfkit');
const Book = require('../models/Book');
const Bundle = require('../models/Bundle');
const PurchaseRequest = require('../models/PurchaseRequest');
const ReaderProgress = require('../models/ReaderProgress');
const { fetchImageBuffer } = require('./exportController');
const { renderCertificate } = require('../utils/certificateRenderer');

// A book cover is uploaded at full resolution for the reader/storefront —
// far larger than the small thumbnail the certificate actually displays.
// Embedding that full-size original directly into the PDF (confirmed by
// testing: a normal cover pushed the certificate past 1.6MB and made it hang
// in Chrome's own PDF viewer) is both wasteful and a real rendering-reliability
// risk. Cloudinary already supports on-the-fly resizing via URL segments, so
// this asks for a right-sized version instead of downscaling client-side —
// no new image-processing dependency needed. Two format gotchas found by
// actually testing the output, not just trusting it compiled:
//   - f_auto can return WebP, which pdfkit's doc.image() doesn't support —
//     forced to f_jpg explicitly instead.
//   - q_auto (even combined with f_jpg) had Cloudinary hand back a
//     *progressive* JPEG (SOF2) for this cover. pdfkit embeds JPEG bytes
//     directly as a DCTDecode stream without re-encoding them, and its
//     bundled parser mis-handles progressive scans — the result was a
//     structurally valid PDF that hung Chrome's own PDF.js renderer trying
//     to decode it. fl_progressive:none forces baseline (SOF0) encoding,
//     which pdfkit embeds correctly.
const CERTIFICATE_THUMB_TRANSFORM = 'w_240,h_360,c_fill,q_auto,f_jpg,fl_progressive:none';
const toCertificateThumbnailUrl = (url) => {
    const marker = '/upload/';
    const i = url.indexOf(marker);
    if (i === -1) return url; // not a Cloudinary delivery URL — use as-is
    return `${url.slice(0, i + marker.length)}${CERTIFICATE_THUMB_TRANSFORM}/${url.slice(i + marker.length)}`;
};

// Access resolution (see KENLIBS-ARCHITECTURE.md section 3), shared by
// readBook and the progress endpoints below — progress/notes are just as
// access-sensitive as the book content itself. An admin always has access.
// A reader has access if either an approved PurchaseRequest exists directly
// for this book, OR an approved PurchaseRequest exists for a bundle whose
// `books` array includes this book. Checked fresh on every request, never
// inferred from anything the client claims. Both queries filter on the
// exact string 'approved' (an allow-list, not a deny-list), so 'revoked' —
// along with 'pending'/'rejected'/never-requested — never matches; a
// revoke takes effect on the very next request, with nothing to invalidate
// or expire (see Step 30).
const hasBookAccess = async (user, bookId) => {
    if (user.role === 'admin') return true;

    const hasDirectAccess = await PurchaseRequest.exists({
        reader: user._id,
        itemType: 'book',
        item: bookId,
        status: 'approved',
    });
    if (hasDirectAccess) return true;

    const approvedBundleRequests = await PurchaseRequest.find({
        reader: user._id,
        itemType: 'bundle',
        status: 'approved',
    }).select('item');

    if (approvedBundleRequests.length > 0) {
        const bundleIds = approvedBundleRequests.map((r) => r.item);
        const hasBundleAccess = await Bundle.exists({
            _id: { $in: bundleIds },
            books: bookId,
        });
        if (hasBundleAccess) return true;
    }

    return false;
};

//@desc    Read a book's full content, if the requesting user is allowed to.
//@route   GET /api/kenlibs/read/:bookId
//@access  Private (any authenticated user — reader or admin)
const readBook = async (req, res) => {
    try {
        const book = await Book.findById(req.params.bookId);
        if (!book) {
            return res.status(404).json({ message: 'Book not found' });
        }

        if (await hasBookAccess(req.user, book._id)) {
            return res.status(200).json(book);
        }

        // The book exists — deliberately 403, not 404, but no book data in
        // the response body beyond a plain message.
        return res.status(403).json({ message: "You don't have access to this book" });
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
};

//@desc    Get the requesting reader's own resume position + notes for a
//         book. No progress yet is the normal first-read case, not an
//         error — returns sensible zero-value defaults rather than 404.
//@route   GET /api/kenlibs/progress/:bookId
//@access  Private — same access rule as readBook.
const getProgress = async (req, res) => {
    try {
        const book = await Book.findById(req.params.bookId).select('_id');
        if (!book) {
            return res.status(404).json({ message: 'Book not found' });
        }

        if (!(await hasBookAccess(req.user, book._id))) {
            return res.status(403).json({ message: "You don't have access to this book" });
        }

        const progress = await ReaderProgress.findOne({
            reader: req.user._id,
            book: book._id,
        });

        res.status(200).json({
            lastChapterIndex: progress?.lastChapterIndex ?? 0,
            lastSpokenBlockIndex: progress?.lastSpokenBlockIndex ?? 0,
            notes: progress?.notes ?? '',
            completedAt: progress?.completedAt ?? null,
        });
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
};

//@desc    Upsert the requesting reader's resume position and/or notes for a
//         book. Accepts partial updates — sending only `notes` never
//         resets `lastChapterIndex`/`lastSpokenBlockIndex` (and vice versa),
//         since each is only written when actually present in the request
//         body.
//@route   PUT /api/kenlibs/progress/:bookId
//@access  Private — same access rule as readBook.
const updateProgress = async (req, res) => {
    try {
        const book = await Book.findById(req.params.bookId).select('chapters');
        if (!book) {
            return res.status(404).json({ message: 'Book not found' });
        }

        if (!(await hasBookAccess(req.user, book._id))) {
            return res.status(403).json({ message: "You don't have access to this book" });
        }

        const update = {};
        if (typeof req.body.lastChapterIndex === 'number' && Number.isFinite(req.body.lastChapterIndex)) {
            update.lastChapterIndex = req.body.lastChapterIndex;
        }
        if (
            typeof req.body.lastSpokenBlockIndex === 'number' &&
            Number.isFinite(req.body.lastSpokenBlockIndex) &&
            req.body.lastSpokenBlockIndex >= 0
        ) {
            update.lastSpokenBlockIndex = req.body.lastSpokenBlockIndex;
        }
        if (typeof req.body.notes === 'string') {
            update.notes = req.body.notes;
        }

        const existingProgress = await ReaderProgress.findOne({
            reader: req.user._id,
            book: book._id,
        }).select('completedAt');

        // Completion is a one-time achievement (Step 35), not a live
        // "currently on last chapter" flag: only set completedAt the first
        // time this request's lastChapterIndex actually reaches the book's
        // final chapter, and never touch it again afterwards — including
        // when the reader later navigates back to an earlier chapter (that
        // update simply won't match this condition, so completedAt is
        // omitted from $set and stays exactly as it was).
        const finalChapterIndex = book.chapters.length - 1;
        if (
            finalChapterIndex >= 0 &&
            update.lastChapterIndex === finalChapterIndex &&
            !existingProgress?.completedAt
        ) {
            update.completedAt = new Date();
        }

        const progress = await ReaderProgress.findOneAndUpdate(
            { reader: req.user._id, book: book._id },
            { $set: update },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );

        res.status(200).json({
            lastChapterIndex: progress.lastChapterIndex,
            lastSpokenBlockIndex: progress.lastSpokenBlockIndex,
            notes: progress.notes,
            completedAt: progress.completedAt,
        });
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
};

//@desc    Generate and download a completion certificate PDF for a book the
//         reader has both access to and has actually finished.
//@route   GET /api/kenlibs/certificate/:bookId
//@access  Private — same access rule as readBook, plus completion.
const getCertificate = async (req, res) => {
    try {
        const book = await Book.findById(req.params.bookId).select(
            'title author coverImage coverDesign'
        );
        if (!book) {
            return res.status(404).json({ message: 'Book not found' });
        }

        if (!(await hasBookAccess(req.user, book._id))) {
            return res.status(403).json({ message: "You don't have access to this book" });
        }

        const progress = await ReaderProgress.findOne({
            reader: req.user._id,
            book: book._id,
        }).select('completedAt');

        // Distinct from the access check above on purpose — "you can't read
        // this at all" and "you can read it but haven't finished it yet"
        // are different situations and deserve different messages, not one
        // generic 403 for both.
        if (!progress?.completedAt) {
            return res.status(400).json({
                message: 'Finish reading this book to unlock your certificate.',
            });
        }

        const coverImage =
            book.coverImage || book.coverDesign?.front?.backgroundImage || '';
        const coverImageBuffer =
            coverImage && !coverImage.includes('pravatar')
                ? (await fetchImageBuffer(toCertificateThumbnailUrl(coverImage)))?.buffer || null
                : null;

        // Small, uniform margins on purpose — renderCertificate positions
        // every element with explicit absolute x/y (a designed single-page
        // layout, not flowing body text), so these only need to be big
        // enough that pdfkit's own bottom-margin overflow check doesn't
        // treat the seal/footer near the bottom edge as spilling onto a
        // second page (confirmed by testing: generous margins like 90pt
        // silently produced a 3-page PDF with 2 blank trailing pages).
        const doc = new PDFDocument({
            size: 'A4',
            layout: 'landscape',
            margins: { top: 20, bottom: 20, left: 20, right: 20 },
            bufferPages: true,
        });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="${book.title.replace(/[^a-zA-Z0-9]/g, '_')}_Certificate.pdf"`
        );

        doc.pipe(res);
        renderCertificate(doc, {
            bookTitle: book.title || 'Untitled',
            author: book.author || 'Unknown Author',
            readerName: req.user.name || 'Kenlibs Reader',
            completedAt: progress.completedAt,
            coverImageBuffer,
        });
        doc.end();
    } catch (error) {
        console.error('Certificate generation error:', error);
        if (!res.headersSent) {
            res.status(500).json({ message: 'Server Error' });
        }
    }
};

module.exports = { readBook, getProgress, updateProgress, getCertificate };
