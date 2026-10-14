const AudioUsage = require('../models/AudioUsage');

// Daily text-to-speech character cap (cost and abuse control). Counted per
// UTC day across all admins. Characters are charged when a chapter actually
// starts generating (and for voice previews), not when it's queued; queued
// work is reserved against the cap at enqueue time by the controller, so a
// run that would go over is refused before anything starts.
//
// Default 100,000 characters/day ≈ 2 hours of narration (~14 chars/sec),
// about one full book of twelve 10-minute chapters.
const DEFAULT_DAILY_CHAR_LIMIT = 100000;

const getDailyCharLimit = () => {
    const n = parseInt(process.env.AUDIO_DAILY_CHAR_LIMIT, 10);
    return Number.isFinite(n) && n >= 0 ? n : DEFAULT_DAILY_CHAR_LIMIT;
};

const todayKey = () => new Date().toISOString().slice(0, 10);

const getUsedToday = async () => (await AudioUsage.findOne({ day: todayKey() }).lean())?.chars || 0;

// Atomically adds `chars` to today's total if it fits under the limit.
// Returns { ok, usedToday, dailyLimit }.
const chargeChars = async (chars) => {
    const day = todayKey();
    const dailyLimit = getDailyCharLimit();
    try {
        await AudioUsage.updateOne({ day }, { $setOnInsert: { chars: 0 } }, { upsert: true });
    } catch (error) {
        if (error?.code !== 11000) throw error; // a concurrent upsert won the race; fine
    }
    const updated = await AudioUsage.findOneAndUpdate(
        { day, chars: { $lte: dailyLimit - chars } },
        { $inc: { chars } },
        { returnDocument: 'after' }
    ).lean();
    if (updated) return { ok: true, usedToday: updated.chars, dailyLimit };
    return { ok: false, usedToday: await getUsedToday(), dailyLimit };
};

module.exports = { DEFAULT_DAILY_CHAR_LIMIT, getDailyCharLimit, getUsedToday, chargeChars };
