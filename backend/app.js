const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/authRoute');
const bookRoutes = require('./routes/bookRoute');
const aiRoutes = require('./routes/aiRoute');
const exportRoutes = require('./routes/exportRoute');
const publicRoutes = require('./routes/publicRoute');
const bundleRoutes = require('./routes/bundleRoute');
const purchaseRoutes = require('./routes/purchaseRoute');
const kenlibsRoutes = require('./routes/kenlibsRoute');
const adminRoutes = require('./routes/adminRoute');
const referralRoutes = require('./routes/referralRoute');
const ogPreviewRoutes = require('./routes/ogPreviewRoute');

// Pure Express app construction — no DB connection, no app.listen(). Split
// out of server.js (Step 45) so tests can `require('./app')` and drive it
// with supertest against an in-memory Mongo instance the test suite
// controls itself, without ever binding a real port or touching a real
// database. server.js is now the only thing that actually connects to Mongo
// and starts listening; this file has zero side effects on require.
const app = express();

// FRONTEND_URL is kept as a single canonical URL for non-CORS uses (email
// links — authController.js's buildResetLink, ogPreviewRoute.js's crawler
// redirects) where "one real production frontend" is the only meaningful
// answer. CORS itself needs to allow more than one origin at once (a real
// prod Vercel URL + Vercel preview-deployment URLs during testing), so it's
// driven by the separate ALLOWED_ORIGINS/ALLOWED_ORIGIN_PATTERN vars below
// instead of reusing FRONTEND_URL. FRONTEND_URL is still folded into the
// allowlist so a bare single-origin setup (e.g. local dev) doesn't also
// need ALLOWED_ORIGINS explicitly set.
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// Comma-separated list, e.g. "https://kenlibs.app,https://kenlibs-git-main-me.vercel.app".
// Falls back to FRONTEND_URL alone if unset, so local dev and single-origin
// setups need nothing extra configured.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || FRONTEND_URL)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

// Opt-in wildcard-subdomain matcher — for Vercel's per-branch/PR preview
// URLs, which are unpredictable random subdomains that can't be
// hand-maintained in ALLOWED_ORIGINS. ONLY consulted when
// ALLOWED_ORIGIN_PATTERN is explicitly set in the environment; a deploy
// that only configures ALLOWED_ORIGINS behaves exactly like a plain fixed
// allowlist, with no wildcard matching at all. There is no default pattern
// and no separate "enable" flag — setting the var IS the opt-in.
//
// Pattern syntax: a single `*` stands for exactly one DNS label (letters,
// digits, hyphens — never `.`), everything else is matched literally and
// the whole thing is anchored (^...$). So "https://*.vercel.app":
//   - matches      https://my-app-git-feature-me.vercel.app
//   - rejects      https://vercel.app.evil.com        (suffix isn't exact — anchored $)
//   - rejects      https://a.b.vercel.app              (`*` is one label, not `.*`)
//   - rejects      httpsx://foo.vercel.app             (scheme is matched literally too)
// This keeps the blast radius of enabling it to "any single-label Vercel
// preview subdomain", not an open wildcard over arbitrary hosts.
const ORIGIN_PATTERN_RAW = process.env.ALLOWED_ORIGIN_PATTERN;
const ORIGIN_PATTERN = ORIGIN_PATTERN_RAW
    ? new RegExp(
        '^' +
            ORIGIN_PATTERN_RAW
                .split('*')
                .map((segment) => segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
                .join('[a-z0-9-]+') +
            '$',
        'i'
    )
    : null;

const isOriginAllowed = (origin) => {
    // No Origin header at all means this isn't a cross-origin browser
    // request (server-to-server calls, curl, same-origin navigation) —
    // nothing for CORS to restrict here regardless of allowlist contents.
    if (!origin) return true;
    if (ALLOWED_ORIGINS.includes(origin)) return true;
    if (ORIGIN_PATTERN && ORIGIN_PATTERN.test(origin)) return true;
    return false;
};

//middleware to handle CORS
app.use(cors({
    origin: (origin, callback) => {
        if (isOriginAllowed(origin)) {
            callback(null, true);
        } else {
            callback(new Error(`Not allowed by CORS: ${origin}`));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE'], // allow specific HTTP methods
    allowedHeaders: ['Content-Type', 'Authorization'] // allow specific headers
}));

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

//define routes
app.use('/api/auth', authRoutes);
app.use('/api/books', bookRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/bundles', bundleRoutes);
app.use('/api/purchases', purchaseRoutes);
app.use('/api/kenlibs', kenlibsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/referrals', referralRoutes);

// Deliberately NOT under /api and matching the frontend's own SPA paths
// (/kenlibs/book/:id, /kenlibs/bundle/:id) — this exists only to give
// link-preview crawlers (Facebook, Twitter/X, WhatsApp, etc.) real
// server-rendered <meta property="og:..."> tags, since the SPA's
// client-side meta tag updates never reach a crawler that doesn't run JS.
// Non-crawler requests get redirected straight to FRONTEND_URL unaffected.
//
// PRODUCTION NOTE: the frontend and backend are separate deployments (see
// CLAUDE.md), so a shared link points at the FRONTEND origin, not this one.
// For this to actually intercept real crawler traffic once deployed, the
// production reverse proxy / CDN in front of the frontend must route only
// these two path patterns to this backend, and let every other path
// continue to the frontend's static SPA build unchanged.
app.use(ogPreviewRoutes);

module.exports = app;
