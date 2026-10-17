const mongoose = require('mongoose');

// A passkey (WebAuthn credential) a user can sign in with
// (controller/passkeyController.js). Up to MAX_PASSKEYS_PER_USER each.
// publicKey is the credential's public key (COSE): not secret, but it's
// never sent to the browser, logged or returned by any endpoint
// (select: false). Deleted with the user's account (adminController's
// deleteUser, both paths).
const MAX_PASSKEYS_PER_USER = 5;

const passkeySchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        // base64url, as the browser reports it.
        credentialID: { type: String, required: true, unique: true },
        publicKey: { type: Buffer, required: true, select: false },
        counter: { type: Number, default: 0, min: 0 },
        transports: { type: [String], default: [] },
        deviceType: { type: String, enum: ['singleDevice', 'multiDevice'], default: 'singleDevice' },
        backedUp: { type: Boolean, default: false },
        nickname: { type: String, trim: true, maxlength: 60, default: 'Passkey' },
        lastUsedAt: { type: Date, default: null },
    },
    { timestamps: { createdAt: true, updatedAt: false } }
);

module.exports = mongoose.model('Passkey', passkeySchema);
module.exports.MAX_PASSKEYS_PER_USER = MAX_PASSKEYS_PER_USER;
