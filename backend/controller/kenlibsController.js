const Book = require('../models/Book');
const Bundle = require('../models/Bundle');
const PurchaseRequest = require('../models/PurchaseRequest');

//@desc    Read a book's full content, if the requesting user is allowed to.
//@route   GET /api/kenlibs/read/:bookId
//@access  Private (any authenticated user — reader or admin)
//
// Access resolution (see KENLIBS-ARCHITECTURE.md section 3): an admin
// always has access. A reader has access if either an approved
// PurchaseRequest exists directly for this book, OR an approved
// PurchaseRequest exists for a bundle whose `books` array includes this
// book. This is the actual security boundary — checked fresh on every
// request, never inferred from anything the client claims.
const readBook = async (req, res) => {
    try {
        const book = await Book.findById(req.params.bookId);
        if (!book) {
            return res.status(404).json({ message: 'Book not found' });
        }

        if (req.user.role === 'admin') {
            return res.status(200).json(book);
        }

        const hasDirectAccess = await PurchaseRequest.exists({
            reader: req.user._id,
            itemType: 'book',
            item: book._id,
            status: 'approved',
        });

        if (hasDirectAccess) {
            return res.status(200).json(book);
        }

        const approvedBundleRequests = await PurchaseRequest.find({
            reader: req.user._id,
            itemType: 'bundle',
            status: 'approved',
        }).select('item');

        if (approvedBundleRequests.length > 0) {
            const bundleIds = approvedBundleRequests.map((r) => r.item);
            const hasBundleAccess = await Bundle.exists({
                _id: { $in: bundleIds },
                books: book._id,
            });
            if (hasBundleAccess) {
                return res.status(200).json(book);
            }
        }

        // The book exists — deliberately 403, not 404, but no book data in
        // the response body beyond a plain message.
        return res.status(403).json({ message: "You don't have access to this book" });
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
};

module.exports = { readBook };
