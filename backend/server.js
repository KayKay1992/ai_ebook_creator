require('dotenv').config();
const connectDB = require('./config/db');
const app = require('./app');
const { recoverInterruptedJobs } = require('./utils/audioJobs');

//connect Database, then recover audiobook jobs: a restart kills any
//narration that was mid-generation, so those chapters are marked failed
//(with a message saying so) and still-queued ones are resumed.
connectDB().then(() =>
    recoverInterruptedJobs()
        .then((count) => {
            if (count) console.log(`[audioJobs] Marked ${count} interrupted narration job(s) as failed.`);
        })
        .catch((error) => console.error('[audioJobs] Recovery failed:', error.message))
);

//start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));
