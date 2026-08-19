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
        Bundle.find({ _id: { $in: bundleIds } }).select('title coverImage'),
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

const STATUS_PRIORITY = { pending: 0, approved: 1, rejected: 2 };

//@desc    List every purchase request, for the admin approval queue
//@route   GET /api/purchases
//@access  Private/Admin
const getAllPurchaseRequests = async (req, res) => {
    try {
        const requests = await PurchaseRequest.find({})
            .sort({ createdAt: -1 })
            .populate('reader', 'name email')
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

// Shared by approve/reject — loads the request and rejects the review if
// it's already been decided, so a request can't silently flip status twice
// (e.g. two admins reviewing the same queue at once).
const reviewPurchaseRequest = async (req, res, { status, adminNote }) => {
    try {
        const request = await PurchaseRequest.findById(req.params.id);
        if (!request) {
            return res.status(404).json({ message: 'Purchase request not found' });
        }
        if (request.status !== 'pending') {
            return res
                .status(400)
                .json({ message: `This request has already been ${request.status}` });
        }

        request.status = status;
        request.adminNote = adminNote || '';
        request.reviewedAt = new Date();
        request.reviewedBy = req.user._id;
        await request.save();

        const [enriched] = await enrichWithItemDetails([request.toObject()]);
        res.status(200).json(enriched);
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
};

//@desc    Approve a pending purchase request
//@route   PUT /api/purchases/:id/approve
//@access  Private/Admin
const approvePurchaseRequest = (req, res) =>
    reviewPurchaseRequest(req, res, { status: 'approved' });

//@desc    Reject a pending purchase request, with an optional note
//@route   PUT /api/purchases/:id/reject
//@access  Private/Admin
const rejectPurchaseRequest = (req, res) =>
    reviewPurchaseRequest(req, res, { status: 'rejected', adminNote: req.body.adminNote });

module.exports = {
    createPurchaseRequest,
    getMyPurchaseRequests,
    getAllPurchaseRequests,
    approvePurchaseRequest,
    rejectPurchaseRequest,
};
