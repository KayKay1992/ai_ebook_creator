const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

// Rate limits for the passkey endpoints (routes/passkeyRoute.js), per IP
// and per account. In-memory, per server process (fine for one Render
// instance). req.ip is the visitor's address because app.js trusts Render's
// proxy. Messages never say whether an account or passkey exists.

const tooMany = (req, res) =>
    res.status(429).json({ code: 'rate_limited', message: 'Too many attempts. Please wait a few minutes and try again.' });

const limiter = (options) =>
    rateLimit({ standardHeaders: true, legacyHeaders: false, handler: tooMany, ...options });

const ipKey = (req) => ipKeyGenerator(req.ip || '');

// Starting a sign-in: per IP.
const passkeyLoginOptionsLimiter = limiter({ windowMs: 15 * 60 * 1000, max: 60, keyGenerator: ipKey });

// Finishing a sign-in: per IP, and per passkey (the "account" side: one
// credential can't be hammered from many addresses). Only failures count.
const passkeyLoginVerifyIpLimiter = limiter({ windowMs: 15 * 60 * 1000, max: 30, keyGenerator: ipKey, skipSuccessfulRequests: true });
const passkeyLoginVerifyCredentialLimiter = limiter({
    windowMs: 15 * 60 * 1000,
    max: 10,
    skipSuccessfulRequests: true,
    keyGenerator: (req) => `cred:${String(req.body?.response?.id || '').slice(0, 512) || ipKey(req)}`,
});

// Adding/renaming/removing passkeys (signed in): per account and per IP.
const passkeyManageUserLimiter = limiter({ windowMs: 60 * 60 * 1000, max: 30, keyGenerator: (req) => `user:${req.user._id}` });
const passkeyManageIpLimiter = limiter({ windowMs: 60 * 60 * 1000, max: 60, keyGenerator: ipKey });

module.exports = {
    passkeyLoginOptionsLimiter,
    passkeyLoginVerifyIpLimiter,
    passkeyLoginVerifyCredentialLimiter,
    passkeyManageUserLimiter,
    passkeyManageIpLimiter,
};
