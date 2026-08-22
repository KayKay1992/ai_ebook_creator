const User = require('../models/User');
const PurchaseRequest = require('../models/PurchaseRequest');
const { generateResetToken } = require('./authController');

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

//@desc    Admin-initiated password reset for a reader account. Deliberately
//         reuses the exact same token/expiry mechanism as the self-service
//         forgot-password flow (generateResetToken, shared from
//         authController.js) rather than a second "admin sets the password
//         directly" path — the admin never sees or handles the reader's
//         actual new password, only a one-time reset token/link to pass
//         along manually (e.g. via WhatsApp) until real email delivery
//         exists. Same insecure-token-in-response caveat as
//         forgotPassword — see that function's TODO.
//@route   POST /api/admin/users/:id/reset-password
//@access  Private/Admin
const resetUserPassword = async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const resetToken = await generateResetToken(user);

        res.status(200).json({
            message: `Reset token generated for ${user.email}.`,
            resetToken,
        });
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
};

module.exports = { getReaders, resetUserPassword };
