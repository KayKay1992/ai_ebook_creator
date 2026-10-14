const mongoose = require('mongoose');

// Characters sent to text-to-speech per UTC day, across all admins — the
// counter behind AUDIO_DAILY_CHAR_LIMIT (see utils/audioUsage.js).
const audioUsageSchema = new mongoose.Schema(
    {
        day: { type: String, required: true, unique: true }, // YYYY-MM-DD (UTC)
        chars: { type: Number, default: 0 },
    },
    { timestamps: true }
);

module.exports = mongoose.model('AudioUsage', audioUsageSchema);
