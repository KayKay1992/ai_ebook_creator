const User = require('../models/User');
const ReferralReward = require('../models/ReferralReward');
const { generateReferralCode } = require('../utils/referralCode');

//@desc    The requesting reader's own referral code, credit balance, and
//         reward history — everything the Referrals page needs in one call.
//@route   GET /api/referrals/me
//@access  Private
const getMyReferralSummary = async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('name referralCode creditBalance');
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Lazily backfills a code for any account that doesn't have one yet
        // — accounts created before this feature existed never got one
        // retroactively, and this also covers any future account-creation
        // path that somehow skips the signup hook (admin-created accounts,
        // data imports, etc.), rather than relying on every path remembering
        // to generate one.
        if (!user.referralCode) {
            user.referralCode = await generateReferralCode(user.name);
            await user.save();
        }

        // Only the referred reader's name is exposed to the referrer, never
        // their email — same reviewer-privacy pattern as public ratings.
        const rewards = await ReferralReward.find({ referrer: req.user._id })
            .sort({ createdAt: -1 })
            .populate('referredReader', 'name');

        res.status(200).json({
            referralCode: user.referralCode,
            creditBalance: user.creditBalance,
            rewards: rewards.map((r) => ({
                _id: r._id,
                referredReaderName: r.referredReader?.name || 'A referred reader',
                amount: r.amount,
                createdAt: r.createdAt,
            })),
        });
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
};

module.exports = { getMyReferralSummary };
