const crypto = require('crypto');
const User = require('../models/User');
const PurchaseRequest = require('../models/PurchaseRequest');
const ReferralReward = require('../models/ReferralReward');
const Rating = require('../models/Rating');
const ReaderProgress = require('../models/ReaderProgress');
const { generateResetToken } = require('./authController');

//@desc    List every reader account with a summary of their purchase and
//         referral activity.
//@route   GET /api/admin/users
//@access  Private/Admin
const getReaders = async (req, res) => {
    try {
        const readers = await User.find({ role: 'reader' })
            .select('name email createdAt isDeleted creditBalance')
            .sort({ createdAt: -1 })
            .lean();

        const readerIds = readers.map((r) => r._id);

        const [requests, referralCounts] = await Promise.all([
            PurchaseRequest.find({ reader: { $in: readerIds } }).select('reader status amount'),
            ReferralReward.aggregate([
                { $match: { referrer: { $in: readerIds } } },
                { $group: { _id: '$referrer', count: { $sum: 1 } } },
            ]),
        ]);

        const summaryByReader = new Map(
            readerIds.map((id) => [
                id.toString(),
                { pending: 0, approved: 0, rejected: 0, revoked: 0, totalSpent: 0 },
            ])
        );
        for (const request of requests) {
            const summary = summaryByReader.get(request.reader.toString());
            if (!summary) continue;
            if (request.status in summary) {
                summary[request.status]++;
            }
            if (request.status === 'approved') {
                summary.totalSpent += request.amount;
            }
        }

        const referralCountByReader = new Map(referralCounts.map((r) => [r._id.toString(), r.count]));

        const enriched = readers.map((reader) => ({
            ...reader,
            purchaseSummary: summaryByReader.get(reader._id.toString()),
            successfulReferrals: referralCountByReader.get(reader._id.toString()) || 0,
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

//@desc    Delete a reader account. Chooses between two genuinely different
//         operations depending on whether the account has any real history:
//
//         - Zero PurchaseRequests AND never involved in a ReferralReward
//           (as referrer or referred reader) → true hard delete. Nothing
//           anywhere else in the app can be pointing at this User document
//           (Ratings and ReaderProgress both require hasBookAccess, which
//           itself requires an approved PurchaseRequest to have existed —
//           so zero PurchaseRequests already implies zero Ratings/Progress
//           too; both are still explicitly cleaned up below anyway, rather
//           than relying on that being true forever).
//
//         - Any history at all → anonymize in place instead of deleting the
//           row. Approved purchases are real transaction records worth
//           keeping for accounting/dispute purposes (see the Privacy
//           Policy's "we keep records to resolve disputes" language), and a
//           ReferralReward that's already been granted permanently
//           references this user as `referrer` — hard-deleting the User
//           document would leave that reward record pointing at nothing.
//           Anonymizing clears every identifying field (name, email,
//           password, avatar, referral code) while the User _id — and
//           everything that legitimately references it — stays intact.
//           `protect` middleware rejects `isDeleted` accounts outright, so
//           this also cuts off any already-issued JWT immediately, not just
//           future logins.
//@route   DELETE /api/admin/users/:id
//@access  Private/Admin
const deleteUser = async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        // Defensive — the admin Users page only ever lists role: 'reader'
        // accounts, so this shouldn't be reachable via the UI, but the
        // route itself should refuse it regardless of how it's called.
        if (user.role === 'admin') {
            return res.status(400).json({ message: "Admin accounts can't be deleted here" });
        }

        const [purchaseCount, referralInvolvementCount] = await Promise.all([
            PurchaseRequest.countDocuments({ reader: user._id }),
            ReferralReward.countDocuments({ $or: [{ referrer: user._id }, { referredReader: user._id }] }),
        ]);
        const hasHistory = purchaseCount > 0 || referralInvolvementCount > 0;

        if (!hasHistory) {
            await Promise.all([
                Rating.deleteMany({ reader: user._id }),
                ReaderProgress.deleteMany({ reader: user._id }),
                User.deleteOne({ _id: user._id }),
            ]);
            return res.status(200).json({ message: 'User permanently deleted.', action: 'hard-deleted' });
        }

        user.name = 'Deleted User';
        // Unique index on email — a fixed literal string would collide the
        // second time this ever runs. Not a real, reachable address.
        user.email = `deleted-${user._id}@removed.invalid`;
        // Unguessable and immediately rehashed by the pre-save hook, same
        // as any other password change — there is no "old password" that
        // still works after this.
        user.password = crypto.randomBytes(32).toString('hex');
        user.avatar = '';
        // Sparse unique index — safe to unset rather than needing a
        // per-user placeholder the way email does. An old referral link
        // using this code should stop resolving to anyone.
        user.referralCode = undefined;
        user.resetPasswordToken = undefined;
        user.resetPasswordExpires = undefined;
        user.isDeleted = true;
        user.deletedAt = new Date();
        await user.save();

        res.status(200).json({ message: 'User anonymized — purchase/referral history preserved.', action: 'anonymized' });
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
};

// Reused by both the moderation list below and the public getRatings in
// kenlibsController.js — kept independent (not imported from there) since
// this one always includes the book title, which the public endpoint
// (already scoped to one book) has no reason to select.
const REVIEWS_LIST_LIMIT = 100;

//@desc    Every written review across every book, most recent first — for
//         moderation. Only reviews with actual text (matches the public
//         getRatings' own filter); a bare star rating has nothing to
//         moderate. Capped rather than paginated for now — revisit if this
//         review volume ever actually approaches the limit.
//@route   GET /api/admin/ratings
//@access  Private/Admin
const getReviewsForModeration = async (req, res) => {
    try {
        const reviews = await Rating.find({ review: { $ne: '' } })
            .sort({ createdAt: -1 })
            .limit(REVIEWS_LIST_LIMIT)
            .populate('reader', 'name')
            .populate('book', 'title');

        res.status(200).json(
            reviews.map((r) => ({
                _id: r._id,
                stars: r.stars,
                review: r.review,
                createdAt: r.createdAt,
                readerName: r.reader?.name || 'Deleted User',
                bookId: r.book?._id || null,
                bookTitle: r.book?.title || 'Deleted book',
            }))
        );
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
};

//@desc    Delete a single review. Straightforward moderation action, not a
//         data-integrity question the way deleteUser is — a Rating carries
//         no other records that reference it.
//@route   DELETE /api/admin/ratings/:id
//@access  Private/Admin
const deleteRating = async (req, res) => {
    try {
        const rating = await Rating.findByIdAndDelete(req.params.id);
        if (!rating) {
            return res.status(404).json({ message: 'Review not found' });
        }
        res.status(200).json({ message: 'Review deleted.' });
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
};

module.exports = {
    getReaders,
    resetUserPassword,
    deleteUser,
    getReviewsForModeration,
    deleteRating,
};
