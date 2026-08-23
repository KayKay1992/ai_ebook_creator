const crypto = require('crypto');
const User = require('../models/User');

// Short, readable: first few letters of the name (uppercased, non-letters
// stripped) plus a few random hex chars. Collision-checked against the live
// `referralCode` index rather than assumed unique from randomness alone —
// the retry loop is cheap and this only ever runs once, at signup.
const generateReferralCode = async (name) => {
    const base = (name || '').replace(/[^a-zA-Z]/g, '').slice(0, 5).toUpperCase() || 'READER';

    for (let attempt = 0; attempt < 10; attempt++) {
        const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
        const code = `${base}${suffix}`;
        // eslint-disable-next-line no-await-in-loop
        const exists = await User.exists({ referralCode: code });
        if (!exists) {
            return code;
        }
    }

    throw new Error('Could not generate a unique referral code');
};

module.exports = { generateReferralCode };
