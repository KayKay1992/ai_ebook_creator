const mongoose = require('mongoose');

// One passkey ceremony in progress (controller/passkeyController.js). Kept
// in MongoDB rather than memory so a Render restart between "options" and
// "verify" doesn't break sign-in. Single use: verify deletes it atomically
// (findOneAndDelete) before checking anything, so a challenge can never be
// tried twice, even after a failed attempt. Expires after CHALLENGE_TTL_MS;
// the TTL index removes leftovers (MongoDB's TTL sweep runs about once a
// minute, so the code also checks expiresAt itself).
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

const webAuthnChallengeSchema = new mongoose.Schema({
    // 'register' (adding a passkey, userId set) or 'login'.
    purpose: { type: String, enum: ['register', 'login'], required: true },
    challenge: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // Login only: the email typed in (lowercased), if any. A passkey of a
    // different account then doesn't sign in.
    email: { type: String, default: '' },
    expiresAt: { type: Date, required: true },
});
webAuthnChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('WebAuthnChallenge', webAuthnChallengeSchema);
module.exports.CHALLENGE_TTL_MS = CHALLENGE_TTL_MS;
