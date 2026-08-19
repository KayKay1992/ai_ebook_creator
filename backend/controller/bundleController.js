const Bundle = require('../models/Bundle');

// Fields a client is allowed to set on a bundle. Kept in one place so
// create/update can't drift from each other on which fields they accept.
const applyBundleFields = (bundle, body) => {
    const { title, description, coverImage, books, price, isForSale } = body;
    if (title !== undefined) bundle.title = title;
    if (description !== undefined) bundle.description = description;
    if (coverImage !== undefined) bundle.coverImage = coverImage;
    if (books !== undefined) bundle.books = Array.isArray(books) ? books : [];
    if (price !== undefined) bundle.price = price;
    if (isForSale !== undefined) bundle.isForSale = Boolean(isForSale);
};

//@desc    List all bundles
//@route   GET /api/bundles
//@access  Private/Admin
const getBundles = async (req, res) => {
    try {
        const bundles = await Bundle.find({})
            .populate('books', 'title author coverImage price isForSale')
            .sort({ createdAt: -1 });
        res.status(200).json(bundles);
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
};

//@desc    Get a single bundle
//@route   GET /api/bundles/:id
//@access  Private/Admin
const getBundleById = async (req, res) => {
    try {
        const bundle = await Bundle.findById(req.params.id).populate(
            'books',
            'title author coverImage price isForSale'
        );
        if (!bundle) {
            return res.status(404).json({ message: 'Bundle not found' });
        }
        res.status(200).json(bundle);
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
};

//@desc    Create a bundle
//@route   POST /api/bundles
//@access  Private/Admin
const createBundle = async (req, res) => {
    try {
        const { title, price } = req.body;
        if (!title || price === undefined || price === null || price === '') {
            return res.status(400).json({ message: 'Title and price are required' });
        }

        const bundle = new Bundle({ title, price });
        applyBundleFields(bundle, req.body);

        const created = await bundle.save();
        const populated = await created.populate('books', 'title author coverImage price isForSale');
        res.status(201).json(populated);
    } catch (error) {
        console.error('Create bundle error:', error);
        res.status(500).json({ message: 'Server Error' });
    }
};

//@desc    Update a bundle
//@route   PUT /api/bundles/:id
//@access  Private/Admin
const updateBundle = async (req, res) => {
    try {
        const bundle = await Bundle.findById(req.params.id);
        if (!bundle) {
            return res.status(404).json({ message: 'Bundle not found' });
        }

        applyBundleFields(bundle, req.body);

        const updated = await bundle.save();
        const populated = await updated.populate('books', 'title author coverImage price isForSale');
        res.status(200).json(populated);
    } catch (error) {
        console.error('Update bundle error:', error);
        res.status(500).json({ message: 'Server Error' });
    }
};

//@desc    Delete a bundle
//@route   DELETE /api/bundles/:id
//@access  Private/Admin
const deleteBundle = async (req, res) => {
    try {
        const bundle = await Bundle.findById(req.params.id);
        if (!bundle) {
            return res.status(404).json({ message: 'Bundle not found' });
        }
        await bundle.deleteOne();
        res.status(200).json({ message: 'Bundle removed' });
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
};

module.exports = {
    getBundles,
    getBundleById,
    createBundle,
    updateBundle,
    deleteBundle,
};
