const mongoose = require('mongoose');

// Self-hosted error monitoring (utils/errorLogger.js). One document per
// distinct error (its fingerprint): repeats increment `count` instead of
// adding rows. Messages and stacks are scrubbed before they get here
// (utils/errorScrubber.js); there are no request bodies, headers, emails or
// names, only a user id when one is known. Entries delete themselves via the
// TTL index on expiresAt (ERROR_LOG_TTL_DAYS after they were last seen).

const errorLogSchema = new mongoose.Schema(
    {
        fingerprint: { type: String, required: true, unique: true },
        source: { type: String, enum: ['backend', 'frontend', 'job'], required: true },
        message: { type: String, default: '' },
        stack: { type: String, default: '' },
        // Requests (backend: the route pattern, never the raw URL; frontend:
        // the page path, tokens stripped).
        method: { type: String, default: '' },
        route: { type: String, default: '' },
        statusCode: { type: Number, default: null },
        // Background jobs.
        jobType: { type: String, default: '' },
        bookId: { type: mongoose.Schema.Types.ObjectId, default: null },
        chapterId: { type: mongoose.Schema.Types.ObjectId, default: null },
        userId: { type: mongoose.Schema.Types.ObjectId, default: null },
        environment: { type: String, default: '' },
        release: { type: String, default: '' },
        count: { type: Number, default: 0 },
        firstSeenAt: { type: Date, required: true },
        lastSeenAt: { type: Date, required: true },
        // Occurrences in the current one-hour window, for spike alerts.
        windowStartedAt: { type: Date },
        windowCount: { type: Number, default: 0 },
        spikeAlertedAt: { type: Date, default: null },
        resolved: { type: Boolean, default: false },
        resolvedAt: { type: Date, default: null },
        // Set when a resolved error happens again (it's unresolved again).
        reopenedAt: { type: Date, default: null },
        expiresAt: { type: Date, required: true },
    },
    { timestamps: false }
);

errorLogSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
errorLogSchema.index({ resolved: 1, lastSeenAt: -1 });

module.exports = mongoose.model('ErrorLog', errorLogSchema);
