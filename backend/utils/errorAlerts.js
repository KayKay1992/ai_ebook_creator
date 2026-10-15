const { sendErrorAlertEmail } = require('./sendEmail');
const { getAdminNotifyEmails } = require('./adminRecipients');

// Error alert emails (utils/errorLogger.js decides when): a new kind of
// error, a resolved one coming back, or a spike. Sent through the existing
// Brevo setup to ADMIN_NOTIFY_EMAIL (or every admin), fire-and-forget, and
// capped at ERROR_ALERT_MAX_PER_HOUR per server process (default 5; 0 turns
// alerts off) so a bad deploy can't flood an inbox. Alerts over the cap are
// skipped, not queued; everything is still on the admin Errors page.

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_MAX_PER_HOUR = 5;

const getMaxPerHour = () => {
    const n = parseInt(process.env.ERROR_ALERT_MAX_PER_HOUR, 10);
    return Number.isFinite(n) && n >= 0 ? Math.min(n, 100) : DEFAULT_MAX_PER_HOUR;
};

let windowStartedAt = 0;
let sentInWindow = 0;

// Takes one slot in this hour's allowance. Returns false when it's used up.
const reserveAlertSlot = (now = Date.now()) => {
    if (now - windowStartedAt >= HOUR_MS) {
        windowStartedAt = now;
        sentInWindow = 0;
    }
    if (sentInWindow >= getMaxPerHour()) return false;
    sentInWindow += 1;
    return true;
};

// For tests.
const resetAlertWindow = () => {
    windowStartedAt = 0;
    sentInWindow = 0;
};

// Never awaited by callers; never throws.
const sendErrorAlert = ({ kind, entry, lastHourCount }) => {
    try {
        if (!reserveAlertSlot()) {
            console.warn(`[errorLog] Alert skipped (more than ${getMaxPerHour()} this hour): ${kind} ${entry.fingerprint.slice(0, 12)}`);
            return;
        }
        const where = entry.jobType
            ? `${entry.jobType} job${entry.bookId ? `, book ${entry.bookId}` : ''}${entry.chapterId ? `, chapter ${entry.chapterId}` : ''}`
            : [entry.method, entry.route].filter(Boolean).join(' ');
        getAdminNotifyEmails()
            .then((recipients) =>
                Promise.all(
                    recipients.map((to) =>
                        sendErrorAlertEmail({
                            to,
                            kind,
                            source: entry.source,
                            message: entry.message,
                            where,
                            count: entry.count,
                            lastHourCount,
                            environment: entry.environment,
                        })
                    )
                )
            )
            .catch((error) => console.error('[errorLog] Alert email failed:', error.message));
    } catch (error) {
        console.error('[errorLog] Alert failed:', error.message);
    }
};

module.exports = { sendErrorAlert, reserveAlertSlot, resetAlertWindow, getMaxPerHour };
