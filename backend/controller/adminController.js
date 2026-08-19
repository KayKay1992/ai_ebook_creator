const User = require('../models/User');
const PurchaseRequest = require('../models/PurchaseRequest');

//@desc    List every reader account with a summary of their purchase activity
//@route   GET /api/admin/users
//@access  Private/Admin
const getReaders = async (req, res) => {
    try {
        const readers = await User.find({ role: 'reader' })
            .select('name email createdAt')
            .sort({ createdAt: -1 })
            .lean();

        const readerIds = readers.map((r) => r._id);
        const requests = await PurchaseRequest.find({ reader: { $in: readerIds } }).select(
            'reader status'
        );

        const summaryByReader = new Map(
            readerIds.map((id) => [id.toString(), { pending: 0, approved: 0, rejected: 0 }])
        );
        for (const request of requests) {
            summaryByReader.get(request.reader.toString())[request.status]++;
        }

        const enriched = readers.map((reader) => ({
            ...reader,
            purchaseSummary: summaryByReader.get(reader._id.toString()),
        }));

        res.status(200).json(enriched);
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
};

module.exports = { getReaders };
