const Book = require('../models/Book');
const Bundle = require('../models/Bundle');
const PurchaseRequest = require('../models/PurchaseRequest');
const ReaderProgress = require('../models/ReaderProgress');

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
        const book = await Book.findById(req.params.bookId).select('_id');
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

        const progress = await ReaderProgress.findOneAndUpdate(
            { reader: req.user._id, book: book._id },
            { $set: update },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );

        res.status(200).json({
            lastChapterIndex: progress.lastChapterIndex,
            lastSpokenBlockIndex: progress.lastSpokenBlockIndex,
            notes: progress.notes,
        });
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
};

module.exports = { readBook, getProgress, updateProgress };
