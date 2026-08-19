const PurchaseRequest = require('../models/PurchaseRequest');
const Book = require('../models/Book');
const Bundle = require('../models/Bundle');
const { uploadBufferToCloudinary } = require('../utils/cloudinaryUpload');

// Loads the referenced item and confirms it's actually purchasable right
// now — never trust the frontend to only ever send valid requests, since
// this is reachable directly by any authenticated user via the raw API.
const resolvePurchasableItem = async (itemType, itemId) => {
    if (itemType === 'book') {
        const book = await Book.findById(itemId);
        if (!book) return { error: 'Book not found' };
        if (book.status !== 'published' || !book.isForSale || typeof book.price !== 'number') {
            return { error: 'This book is not currently available for purchase' };
        }
        return { price: book.price };
    }

    if (itemType === 'bundle') {
        const bundle = await Bundle.findById(itemId);
        if (!bundle) return { error: 'Bundle not found' };
        if (!bundle.isForSale || typeof bundle.price !== 'number') {
            return { error: 'This bundle is not currently available for purchase' };
        }
        return { price: bundle.price };
    }

    return { error: 'Invalid item type' };
};

// `item` isn't a typed ref (it can point at either collection depending on
// itemType), so it can't be `.populate()`d directly — batch-fetch each side
// and attach just enough for the UI to show something recognizable instead
// of a bare ObjectId. Shared by the reader's own list and the admin queue.
const enrichWithItemDetails = async (requests) => {
    const bookIds = requests.filter((r) => r.itemType === 'book').map((r) => r.item);
    const bundleIds = requests.filter((r) => r.itemType === 'bundle').map((r) => r.item);

    const [books, bundles] = await Promise.all([
        Book.find({ _id: { $in: bookIds } }).select('title coverImage coverDesign'),
        // Bundles also carry their books' titles — an approved bundle
        // request doesn't map to one readable item, so the reader's
        // "My Books" list needs each contained book to link to its own
        // /kenlibs/read/:bookId.
        Bundle.find({ _id: { $in: bundleIds } })
            .select('title coverImage books')
            .populate('books', 'title'),
    ]);

    const bookMap = new Map(books.map((b) => [b._id.toString(), b]));
    const bundleMap = new Map(bundles.map((b) => [b._id.toString(), b]));

    return requests.map((r) => {
        const source =
            r.itemType === 'book' ? bookMap.get(r.item.toString()) : bundleMap.get(r.item.toString());
        return {
            ...r,
            itemTitle: source?.title || 'Item no longer available',
            itemCoverImage: source?.coverDesign?.front?.backgroundImage || source?.coverImage || null,
            itemBooks:
                r.itemType === 'bundle'
                    ? (source?.books || []).map((b) => ({ _id: b._id, title: b.title }))
                    : undefined,
        };
    });
};

//@desc    Submit a purchase request with payment evidence
//@route   POST /api/purchases
//@access  Private (any authenticated user)
const createPurchaseRequest = async (req, res) => {
    try {
        const { itemType, item } = req.body;

        if (!itemType || !item) {
            return res.status(400).json({ message: 'itemType and item are required' });
        }

        if (!req.file) {
            return res.status(400).json({ message: 'Payment evidence image is required' });
        }

        const { price, error } = await resolvePurchasableItem(itemType, item);
        if (error) {
            return res.status(400).json({ message: error });
        }

        const uploadResult = await uploadBufferToCloudinary(
            req.file.buffer,
            'ebook-creator/purchase-evidence'
        );

        const purchaseRequest = await PurchaseRequest.create({
            reader: req.user._id,
            itemType,
            item,
            amount: price, // server-side snapshot — never trust a client-sent amount
            evidenceImage: uploadResult.secure_url,
        });

        res.status(201).json(purchaseRequest);
    } catch (error) {
        console.error('Create purchase request error:', error);
        res.status(500).json({ message: 'Server Error' });
    }
};

//@desc    List the authenticated user's own purchase requests
//@route   GET /api/purchases/mine
//@access  Private
const getMyPurchaseRequests = async (req, res) => {
    try {
        // Scoped by the authenticated user directly in the query — a
        // request for someone else's data is never even fetched, let alone
        // filtered out afterward.
        const requests = await PurchaseRequest.find({ reader: req.user._id })
            .sort({ createdAt: -1 })
            .lean();

        res.status(200).json(await enrichWithItemDetails(requests));
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
};

const STATUS_PRIORITY = { pending: 0, approved: 1, rejected: 2, revoked: 3 };

//@desc    List every purchase request, for the admin approval queue
//@route   GET /api/purchases
//@access  Private/Admin
const getAllPurchaseRequests = async (req, res) => {
    try {
        const requests = await PurchaseRequest.find({})
            .sort({ createdAt: -1 })
            .populate('reader', 'name email')
            .populate('reviewHistory.reviewedBy', 'name')
            .lean();

        // Pending first, then most-recent-first within each status group.
        // Array.prototype.sort is stable, so the createdAt: -1 ordering
        // from the query is preserved within each group.
        requests.sort((a, b) => STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status]);

        res.status(200).json(await enrichWithItemDetails(requests));
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
};

// Shared by approve/reject/revoke — loads the request, rejects the review if
// it isn't currently in one of the states this transition is allowed from
// (so a request can't silently flip status twice, e.g. two admins reviewing
// the same queue at once, or revoking something never approved), then
// updates both the top-level convenience fields AND appends a reviewHistory
// entry — reviewHistory is additive, never a replacement.
const reviewPurchaseRequest = async (req, res, { toStatus, note, allowedFrom, actionVerb }) => {
    try {
        const request = await PurchaseRequest.findById(req.params.id);
        if (!request) {
            return res.status(404).json({ message: 'Purchase request not found' });
        }
        if (!allowedFrom.includes(request.status)) {
            return res.status(400).json({
                message: `Can't ${actionVerb} a request that's currently '${request.status}'.`,
            });
        }

        const reviewedAt = new Date();
        request.status = toStatus;
        request.adminNote = note || '';
        request.reviewedAt = reviewedAt;
        request.reviewedBy = req.user._id;
        request.reviewHistory.push({
            status: toStatus,
            note: note || '',
            reviewedBy: req.user._id,
            reviewedAt,
        });
        await request.save();
        // The admin queue's GET populates reader + reviewHistory.reviewedBy
        // — do the same here so an in-place UI update after approve/reject/
        // revoke doesn't drop the reader's name/email or reviewer names.
        await request.populate([
            { path: 'reader', select: 'name email' },
            { path: 'reviewHistory.reviewedBy', select: 'name' },
        ]);

        const [enriched] = await enrichWithItemDetails([request.toObject()]);
        res.status(200).json(enriched);
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
};

//@desc    Approve a pending OR rejected purchase request
//@route   PUT /api/purchases/:id/approve
//@access  Private/Admin
const approvePurchaseRequest = (req, res) =>
    reviewPurchaseRequest(req, res, {
        toStatus: 'approved',
        allowedFrom: ['pending', 'rejected'],
        actionVerb: 'approve',
    });

//@desc    Reject a pending purchase request, with an optional note
//@route   PUT /api/purchases/:id/reject
//@access  Private/Admin
const rejectPurchaseRequest = (req, res) =>
    reviewPurchaseRequest(req, res, {
        toStatus: 'rejected',
        note: req.body.adminNote,
        allowedFrom: ['pending'],
        actionVerb: 'reject',
    });

//@desc    Revoke a previously approved purchase request — immediately cuts
//         off read access, same guarantee as unpublishing a share link.
//@route   PUT /api/purchases/:id/revoke
//@access  Private/Admin
const revokePurchaseRequest = (req, res) =>
    reviewPurchaseRequest(req, res, {
        toStatus: 'revoked',
        note: req.body.adminNote,
        allowedFrom: ['approved'],
        actionVerb: 'revoke',
    });

//@desc    Reader resubmits new evidence on their own rejected request,
//         resetting it to 'pending' for another review pass.
//@route   PUT /api/purchases/:id/resubmit
//@access  Private (must be the request's own reader)
const resubmitPurchaseRequest = async (req, res) => {
    try {
        const request = await PurchaseRequest.findById(req.params.id);
        if (!request) {
            return res.status(404).json({ message: 'Purchase request not found' });
        }
        if (request.reader.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: "You don't have access to this request" });
        }
        if (request.status !== 'rejected') {
            return res.status(400).json({
                message: `Can't resubmit a request that's currently '${request.status}'.`,
            });
        }
        if (!req.file) {
            return res.status(400).json({ message: 'A new evidence image is required' });
        }

        const uploadResult = await uploadBufferToCloudinary(
            req.file.buffer,
            'ebook-creator/purchase-evidence'
        );

        request.evidenceImage = uploadResult.secure_url;
        request.status = 'pending';
        request.reviewHistory.push({
            status: 'pending',
            note: 'Evidence resubmitted by reader.',
            reviewedAt: new Date(),
        });
        // The old admin decision is preserved above in reviewHistory — the
        // top-level fields now describe the fresh pending state, which has
        // no active reviewer yet.
        request.adminNote = '';
        request.reviewedAt = undefined;
        request.reviewedBy = undefined;
        await request.save();

        const [enriched] = await enrichWithItemDetails([request.toObject()]);
        res.status(200).json(enriched);
    } catch (error) {
        console.error('Resubmit purchase request error:', error);
        res.status(500).json({ message: 'Server Error' });
    }
};

module.exports = {
    createPurchaseRequest,
    getMyPurchaseRequests,
    getAllPurchaseRequests,
    approvePurchaseRequest,
    rejectPurchaseRequest,
    revokePurchaseRequest,
    resubmitPurchaseRequest,
};
