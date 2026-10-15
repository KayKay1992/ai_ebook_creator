const mongoose = require('mongoose');
const ErrorLog = require('../models/ErrorLog');
const { scrubMessage, scrubStack, scrubPath, fingerprintOf } = require('./errorScrubber');
const { sendErrorAlert } = require('./errorAlerts');

// Self-hosted error monitoring. captureError() is the only entry point:
//   - backend 5xx responses (middleware/errorCapture.js),
//   - background job failures (audio narration, translation),
//   - unhandled rejections / uncaught exceptions (server.js),
//   - browser errors reported to POST /api/errors/report.
// It is fire-and-forget: it returns immediately, never throws, and never
// waits on the database or email inside a request. Repeats of the same
// error (same fingerprint: source + normalised message + first stack
// frame) increment `count` on one ErrorLog document.
//
// Alerts (utils/errorAlerts.js): a NEW fingerprint, a RESOLVED one that
// happens again, or a SPIKE (ERROR_ALERT_SPIKE_PER_HOUR occurrences within
// an hour, at most one spike alert per hour per error).
//
// Env: ERROR_LOG_ENABLED (default on; "false" turns it off; in tests it's
// off unless a test sets it to "true"), ERROR_LOG_TTL_DAYS (default 30).

const HOUR_MS = 60 * 60 * 1000;

const isEnabled = () => {
    const value = String(process.env.ERROR_LOG_ENABLED ?? '').toLowerCase();
    if (value === 'false' || value === '0' || value === 'off') return false;
    if (process.env.NODE_ENV === 'test') return value === 'true' || value === '1' || value === 'on';
    return true;
};

const getTtlDays = () => {
    const n = parseInt(process.env.ERROR_LOG_TTL_DAYS, 10);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 365) : 30;
};

const getSpikeThreshold = () => {
    const n = parseInt(process.env.ERROR_ALERT_SPIKE_PER_HOUR, 10);
    return Number.isFinite(n) && n > 1 ? n : 50;
};

const getRelease = () => String(process.env.RELEASE || process.env.RENDER_GIT_COMMIT || '').slice(0, 40);

const objectIdOrNull = (value) => (value && mongoose.isValidObjectId(String(value)) ? new mongoose.Types.ObjectId(String(value)) : null);
const short = (value, max) => String(value || '').slice(0, max);

const pending = new Set();

// Builds the stored fields from what the caller passed. Everything textual
// is scrubbed; ids must be valid ObjectIds or they're dropped.
const buildEntry = ({ source, error, message, stack, method, route, statusCode, userId, jobType, bookId, chapterId, release }) => {
    const rawMessage = message ?? (error instanceof Error ? error.message : error !== undefined ? String(error) : '');
    const rawStack = stack ?? (error instanceof Error ? error.stack : '');
    const cleanMessage = scrubMessage(rawMessage || 'Unknown error');
    const cleanStack = scrubStack(rawStack);
    return {
        source,
        message: cleanMessage,
        stack: cleanStack,
        method: short(method, 10).toUpperCase(),
        route: scrubPath(route),
        statusCode: Number.isInteger(statusCode) ? statusCode : null,
        userId: objectIdOrNull(userId),
        jobType: short(jobType, 40),
        bookId: objectIdOrNull(bookId),
        chapterId: objectIdOrNull(chapterId),
        environment: short(process.env.NODE_ENV || 'development', 20),
        release: short(release || getRelease(), 40),
        fingerprint: fingerprintOf(source, cleanMessage, cleanStack),
    };
};

const recordError = async (input) => {
    try {
        // Not connected (startup, tests): drop it rather than wait.
        if (mongoose.connection.readyState !== 1) return;
        const entry = buildEntry(input);
        const now = new Date();
        const { fingerprint, source, ...latest } = entry;
        const upsert = () =>
            ErrorLog.findOneAndUpdate(
                { fingerprint },
                {
                    $setOnInsert: { fingerprint, source, firstSeenAt: now },
                    $set: { ...latest, lastSeenAt: now, expiresAt: new Date(now.getTime() + getTtlDays() * 24 * HOUR_MS), resolved: false },
                    $inc: { count: 1 },
                },
                { upsert: true, returnDocument: 'before' }
            ).lean();
        let before;
        try {
            before = await upsert();
        } catch (error) {
            if (error?.code !== 11000) throw error;
            before = await upsert(); // a concurrent first occurrence won the insert
        }

        const windowExpired = !before?.windowStartedAt || now - new Date(before.windowStartedAt) >= HOUR_MS;
        const lastHourCount = windowExpired ? 1 : (before.windowCount || 0) + 1;
        const set = windowExpired ? { windowStartedAt: now, windowCount: 1 } : {};
        let kind = null;
        if (!before) kind = 'new';
        else if (before.resolved) {
            kind = 'reopened';
            set.reopenedAt = now;
            set.resolvedAt = null;
        } else if (
            lastHourCount >= getSpikeThreshold() &&
            (!before.spikeAlertedAt || now - new Date(before.spikeAlertedAt) >= HOUR_MS)
        ) {
            kind = 'spike';
            set.spikeAlertedAt = now;
        }
        await ErrorLog.updateOne({ fingerprint }, { ...(Object.keys(set).length ? { $set: set } : {}), ...(windowExpired ? {} : { $inc: { windowCount: 1 } }) });

        if (kind) sendErrorAlert({ kind, entry: { ...entry, count: (before?.count || 0) + 1 }, lastHourCount });
    } catch (error) {
        // The logger must never cause trouble of its own.
        try {
            console.error('[errorLog] Could not record an error:', error?.message || error);
        } catch {
            /* nothing left to do */
        }
    }
};

// Fire-and-forget. Returns immediately; never throws.
const captureError = (input) => {
    try {
        if (!isEnabled()) return;
        const task = recordError(input);
        pending.add(task);
        task.finally(() => pending.delete(task));
    } catch {
        /* never let logging break the caller */
    }
};

// Resolves once everything captured so far has been written (tests, and
// server.js before exiting on a crash). Optional timeout in ms.
const flushErrorLogs = (timeoutMs) => {
    const all = Promise.allSettled([...pending]);
    if (!timeoutMs) return all;
    return Promise.race([all, new Promise((resolve) => setTimeout(resolve, timeoutMs).unref?.())]);
};

module.exports = { captureError, flushErrorLogs, isEnabled, getTtlDays, getSpikeThreshold, buildEntry };
