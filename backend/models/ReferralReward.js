const mongoose = require('mongoose');

// An audit trail entry for every referral credit ever granted — created
// alongside the `creditBalance` increment on the referrer's User doc (see
// purchaseController.js's maybeGrantReferralReward), never a bare balance
// mutation on its own, so a support conversation about "why did my balance
// change" always has a concrete record to point to.
const referralRewardSchema = new mongoose.Schema(
    {
        referrer: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        referredReader: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        // The specific purchase approval that triggered this reward — a
        // referred reader is only ever rewarded once (their first-ever
        // approved purchase), so this also doubles as the idempotency key
        // that prevents a duplicate reward for the same reader.
        triggeringPurchaseRequest: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'PurchaseRequest',
            required: true,
        },
        amount: {
            type: Number,
            required: true,
        },
    },
    {
        timestamps: true,
    }
);

module.exports = mongoose.model('ReferralReward', referralRewardSchema);
