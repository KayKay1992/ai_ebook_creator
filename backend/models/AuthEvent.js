const mongoose = require('mongoose');

// Audit trail of passkey activity (utils/authEvents.js). Deliberately
// minimal: the user id, what happened, and the passkey's nickname. Never an
// IP address, email, credential id, public key or anything from the
// browser's response. Expires after AUTH_EVENT_TTL_DAYS. Not the error log
// (models/ErrorLog.js): these are normal events, not bugs.
const AUTH_EVENT_TTL_DAYS = 90;

const authEventSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: {
        type: String,
        enum: ['passkey_added', 'passkey_removed', 'passkey_renamed', 'passkey_login'],
        required: true,
    },
    nickname: { type: String, default: '', maxlength: 60 },
    createdAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, default: () => new Date(Date.now() + AUTH_EVENT_TTL_DAYS * 24 * 60 * 60 * 1000) },
});
authEventSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('AuthEvent', authEventSchema);
module.exports.AUTH_EVENT_TTL_DAYS = AUTH_EVENT_TTL_DAYS;
