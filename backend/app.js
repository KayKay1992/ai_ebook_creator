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
const ogPreviewRoutes = require('./routes/ogPreviewRoute');

// Pure Express app construction — no DB connection, no app.listen(). Split
// out of server.js (Step 45) so tests can `require('./app')` and drive it
// with supertest against an in-memory Mongo instance the test suite
// controls itself, without ever binding a real port or touching a real
// database. server.js is now the only thing that actually connects to Mongo
// and starts listening; this file has zero side effects on require.
const app = express();

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

//middleware to handle CORS
app.use(cors({
    origin: FRONTEND_URL,
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
