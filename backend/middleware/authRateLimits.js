const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

// Brute-force protection for the password endpoints (routes/authRoute.js).
// Kept separate from the passkey limits (middleware/passkeyRateLimits.js).
// In-memory, per server process (one Render instance); req.ip is the
// visitor's address because app.js trusts Render's proxy. Nothing here
// changes a successful response, and no message says whether an account
// exists. Limits come from env vars (backend/.env.example), read at startup:
//
//   POST /api/auth/login: only FAILED attempts count (4xx/5xx).
//     AUTH_LOGIN_MAX_FAILS_PER_IP_EMAIL (10) per AUTH_LOGIN_WINDOW_MINUTES
//     (15) for one IP + email; a successful login clears that counter. So
//     other people's failures (a different email) never block you, and
//     your own success starts you fresh.
//     AUTH_LOGIN_MAX_FAILS_PER_IP (100) per window for one IP across all
//     emails: a looser cap against trying many accounts from one address.
//     On a shared network (office, campus, mobile carrier NAT) failures by
//     others on the same IP count toward this cap, hence the high default.
//   POST /api/auth/forgot-password, per hour:
//     AUTH_FORGOT_MAX_PER_IP (20): over it, 429.
//     AUTH_FORGOT_MAX_PER_EMAIL (5): over it, the usual generic 200 reply
//     but no email is sent (no inbox flooding, and nothing revealed).
//   POST /api/auth/register: AUTH_REGISTER_MAX_PER_IP (10) per hour.
//   POST /api/auth/reset-password/:token: AUTH_RESET_MAX_PER_IP (20) per hour.

const HOUR_MS = 60 * 60 * 1000;

const positiveInt = (name, fallback, env = process.env) => {
    const value = Number.parseInt(env[name], 10);
    return Number.isFinite(value) && value > 0 ? value : fallback;
};

const readAuthRateLimitConfig = (env = process.env) => ({
    loginWindowMs: positiveInt('AUTH_LOGIN_WINDOW_MINUTES', 15, env) * 60 * 1000,
    loginMaxFailsPerIpEmail: positiveInt('AUTH_LOGIN_MAX_FAILS_PER_IP_EMAIL', 10, env),
    loginMaxFailsPerIp: positiveInt('AUTH_LOGIN_MAX_FAILS_PER_IP', 100, env),
    forgotMaxPerIp: positiveInt('AUTH_FORGOT_MAX_PER_IP', 20, env),
    forgotMaxPerEmail: positiveInt('AUTH_FORGOT_MAX_PER_EMAIL', 5, env),
    registerMaxPerIp: positiveInt('AUTH_REGISTER_MAX_PER_IP', 10, env),
    resetMaxPerIp: positiveInt('AUTH_RESET_MAX_PER_IP', 20, env),
});

const ipKey = (req) => ipKeyGenerator(req.ip || '');
const emailOf = (req) => (typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 254) : '');

// 429 with a friendly message and when to try again.
const tooMany = (req, res, next, options) => {
    const resetTime = req.rateLimit?.resetTime;
    const seconds = resetTime ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000)) : Math.ceil(options.windowMs / 1000);
    const minutes = Math.max(1, Math.ceil(seconds / 60));
    res.status(429).json({
        code: 'rate_limited',
        retryAfterSeconds: seconds,
        message: `Too many attempts. Please wait ${minutes} minute${minutes === 1 ? '' : 's'} and try again.`,
    });
};

const limiter = (options) => rateLimit({ standardHeaders: true, legacyHeaders: false, handler: tooMany, ...options });

const createAuthRateLimiters = (config = readAuthRateLimitConfig()) => {
    const loginIpEmailKey = (req) => `${ipKey(req)}|${emailOf(req)}`;
    const loginPerIpEmail = limiter({
        windowMs: config.loginWindowMs,
        limit: config.loginMaxFailsPerIpEmail,
        skipSuccessfulRequests: true,
        keyGenerator: loginIpEmailKey,
    });
    const loginPerIp = limiter({
        windowMs: config.loginWindowMs,
        limit: config.loginMaxFailsPerIp,
        skipSuccessfulRequests: true,
        keyGenerator: (req) => `ip:${ipKey(req)}`,
    });
    // A successful login clears this IP + email's failure count.
    const clearOnSuccess = (req, res, next) => {
        const key = loginIpEmailKey(req);
        res.on('finish', () => {
            if (res.statusCode < 400) Promise.resolve(loginPerIpEmail.resetKey(key)).catch(() => {});
        });
        next();
    };

    const forgotPerIp = limiter({ windowMs: HOUR_MS, limit: config.forgotMaxPerIp, keyGenerator: (req) => `ip:${ipKey(req)}` });
    const forgotPerEmail = limiter({
        windowMs: HOUR_MS,
        limit: config.forgotMaxPerEmail,
        // Without an email the controller answers 400 itself.
        skip: (req) => !emailOf(req),
        keyGenerator: (req) => `email:${emailOf(req)}`,
        // Same reply as a normal request, but nothing is sent.
        handler: (req, res) =>
            res.status(200).json({ message: 'If an account exists for that email, a password reset link has been sent.' }),
    });

    return {
        login: [loginPerIp, loginPerIpEmail, clearOnSuccess],
        forgotPassword: [forgotPerIp, forgotPerEmail],
        register: [limiter({ windowMs: HOUR_MS, limit: config.registerMaxPerIp, keyGenerator: ipKey })],
        resetPassword: [limiter({ windowMs: HOUR_MS, limit: config.resetMaxPerIp, keyGenerator: ipKey })],
    };
};

module.exports = { createAuthRateLimiters, readAuthRateLimitConfig };
