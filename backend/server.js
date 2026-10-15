require('dotenv').config();
const connectDB = require('./config/db');
const app = require('./app');
const { recoverInterruptedJobs } = require('./utils/audioJobs');
const { recoverInterruptedTranslations } = require('./utils/translationJobs');

//connect Database, then recover audiobook jobs: a restart kills any
//narration that was mid-generation, so those chapters are marked failed
//(with a message saying so) and still-queued ones are resumed.
connectDB().then(() =>
    recoverInterruptedJobs()
        .then((count) => {
            if (count) console.log(`[audioJobs] Marked ${count} interrupted narration job(s) as failed.`);
        })
        .catch((error) => console.error('[audioJobs] Recovery failed:', error.message))
        // Same for translation jobs (utils/translationJobs.js).
        .then(() => recoverInterruptedTranslations())
        .then((count) => {
            if (count) console.log(`[translationJobs] Marked ${count} interrupted translation(s) as failed.`);
        })
        .catch((error) => console.error('[translationJobs] Recovery failed:', error.message))
);

// Crashes: record them in error monitoring (utils/errorLogger.js), then
// keep Node's normal behaviour (print and exit with code 1). Waits at most
// 2s for the record to be written. Only here, never in app.js, so tests
// and scripts that load the app are unaffected.
const { captureError, flushErrorLogs } = require('./utils/errorLogger');
let crashing = false;
const crash = (kind) => async (reason) => {
    if (crashing) return;
    crashing = true;
    console.error(`[${kind}]`, reason);
    try {
        captureError({
            source: 'backend',
            error: reason instanceof Error ? reason : undefined,
            message: reason instanceof Error ? `${kind}: ${reason.message}` : `${kind}: ${String(reason)}`,
            stack: reason instanceof Error ? reason.stack : '',
        });
        await flushErrorLogs(2000);
    } finally {
        process.exit(1);
    }
};
process.on('unhandledRejection', crash('unhandledRejection'));
process.on('uncaughtException', crash('uncaughtException'));

//start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));
