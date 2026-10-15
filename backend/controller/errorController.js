const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const ErrorLog = require('../models/ErrorLog');
const { captureError, isEnabled } = require('../utils/errorLogger');

// Error monitoring endpoints (routes/errorRoute.js):
//   POST /api/errors/report     public, rate-limited per IP: browser errors
//   GET /api/errors             admin: the list
//   PUT /api/errors/:id         admin: { resolved: true|false }
//   DELETE /api/errors/:id      admin

const REPORT_MAX_BYTES = 16 * 1024;
const KINDS = new Set(['error', 'unhandledrejection', 'boundary']);

// Errors that aren't bugs in Kenlibs: browser quirks, extensions, the
// reader going offline, requests the app cancelled on purpose, and
// cross-origin scripts the browser won't describe.
const NOISE = [
    /ResizeObserver loop/i,
    /^Script error\.?$/i,
    /(chrome|moz|safari|safari-web|ms-browser)-extension:\/\//i,
    /\b(AbortError|CanceledError|ERR_CANCELED)\b/,
    /\b(the operation was aborted|request aborted|canceled|cancelled)\b/i,
    /\b(Network ?Error|Failed to fetch|Load failed|NetworkError when attempting to fetch|ERR_NETWORK|ERR_INTERNET_DISCONNECTED|timeout of \d+ms exceeded)\b/i,
    /Non-Error promise rejection captured/i,
];
const isNoise = (...texts) => texts.some((text) => text && NOISE.some((pattern) => pattern.test(text)));

// The reporting user's id, if their token is valid. Never required, never
// stored beyond the id.
const optionalUserId = (req) => {
    try {
        const header = req.headers.authorization || '';
        if (!header.startsWith('Bearer ') || !process.env.JWT_SECRET) return null;
        const decoded = jwt.verify(header.slice(7), process.env.JWT_SECRET);
        return mongoose.isValidObjectId(decoded?.id) ? decoded.id : null;
    } catch {
        return null;
    }
};

const isShortString = (value, max) => value === undefined || (typeof value === 'string' && value.length <= max);

//@desc    A browser error report from the frontend (utils/errorReporter.js).
//         Body: { kind, message, stack?, componentStack?, path?, release? }.
//         Always answers 204 quickly (accepted, ignored as noise, or logging
//         off); 400 for a malformed report, 413 if too large.
//@route   POST /api/errors/report
//@access  Public, rate-limited per IP.
const reportClientError = (req, res) => {
    try {
        if (Number(req.headers['content-length'] || 0) > REPORT_MAX_BYTES || JSON.stringify(req.body || {}).length > REPORT_MAX_BYTES) {
            return res.status(413).json({ message: 'Report too large.' });
        }
        const { kind, message, stack, componentStack, path, release } = req.body || {};
        if (
            !KINDS.has(kind) ||
            typeof message !== 'string' ||
            !message.trim() ||
            message.length > 2000 ||
            !isShortString(stack, 10000) ||
            !isShortString(componentStack, 4000) ||
            !isShortString(path, 500) ||
            !isShortString(release, 60)
        ) {
            return res.status(400).json({ message: 'Invalid report.' });
        }
        if (!isEnabled() || isNoise(message, stack)) return res.status(204).end();

        captureError({
            source: 'frontend',
            message: kind === 'unhandledrejection' ? `Unhandled rejection: ${message}` : message,
            stack: [stack, componentStack ? `Component stack:${componentStack}` : ''].filter(Boolean).join('\n'),
            route: path,
            userId: optionalUserId(req),
            release,
        });
        res.status(204).end();
    } catch {
        res.status(204).end();
    }
};

//@desc    Logged errors, most recently seen first. ?status=unresolved|resolved|all
//@route   GET /api/errors
//@access  Private/Admin
const listErrors = async (req, res) => {
    try {
        const status = ['resolved', 'all'].includes(req.query.status) ? req.query.status : 'unresolved';
        const filter = status === 'all' ? {} : { resolved: status === 'resolved' };
        const [errors, unresolvedCount] = await Promise.all([
            ErrorLog.find(filter).sort({ lastSeenAt: -1 }).limit(200).select('-windowStartedAt -windowCount -expiresAt -__v').lean(),
            ErrorLog.countDocuments({ resolved: false }),
        ]);
        res.set('Cache-Control', 'no-store');
        res.status(200).json({ errors, unresolvedCount, enabled: isEnabled() });
    } catch (error) {
        res.locals.error = error;
        res.status(500).json({ message: 'Server Error' });
    }
};

//@desc    Mark an error resolved (or unresolved). Body: { resolved }
//@route   PUT /api/errors/:id
//@access  Private/Admin
const updateError = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Not found' });
        if (typeof req.body?.resolved !== 'boolean') return res.status(400).json({ message: 'resolved must be true or false.' });
        const resolved = req.body.resolved;
        const updated = await ErrorLog.findByIdAndUpdate(
            req.params.id,
            { $set: { resolved, resolvedAt: resolved ? new Date() : null } },
            { returnDocument: 'after' }
        )
            .select('-windowStartedAt -windowCount -expiresAt -__v')
            .lean();
        if (!updated) return res.status(404).json({ message: 'Not found' });
        res.status(200).json(updated);
    } catch (error) {
        res.locals.error = error;
        res.status(500).json({ message: 'Server Error' });
    }
};

//@desc    Delete one logged error.
//@route   DELETE /api/errors/:id
//@access  Private/Admin
const deleteError = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Not found' });
        const result = await ErrorLog.deleteOne({ _id: req.params.id });
        if (!result.deletedCount) return res.status(404).json({ message: 'Not found' });
        res.status(200).json({ deleted: true });
    } catch (error) {
        res.locals.error = error;
        res.status(500).json({ message: 'Server Error' });
    }
};

module.exports = { reportClientError, listErrors, updateError, deleteError, isNoise, REPORT_MAX_BYTES };
