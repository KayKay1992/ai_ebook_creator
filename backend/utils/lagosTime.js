// Calendar days in Lagos time (Africa/Lagos is UTC+1 all year: no daylight
// saving), used for analytics buckets and daily view counts so "today"
// matches the admin's day, not UTC's.

const OFFSET_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const TIMEZONE = 'Africa/Lagos';
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Date → 'YYYY-MM-DD' (its Lagos day).
const lagosDay = (date = new Date()) => new Date(new Date(date).getTime() + OFFSET_MS).toISOString().slice(0, 10);

// 'YYYY-MM-DD' → the Date when that Lagos day starts.
const startOfLagosDay = (day) => {
    if (!DAY_PATTERN.test(day)) throw new Error(`Not a day: ${day}`);
    const [y, m, d] = day.split('-').map(Number);
    const start = new Date(Date.UTC(y, m - 1, d) - OFFSET_MS);
    if (lagosDay(start) !== day) throw new Error(`Not a real day: ${day}`);
    return start;
};

const addDays = (day, n) => lagosDay(new Date(startOfLagosDay(day).getTime() + n * DAY_MS));

// Inclusive list of days from `from` to `to`.
const daysBetween = (from, to) => {
    const days = [];
    for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
    return days;
};

module.exports = { TIMEZONE, DAY_MS, DAY_PATTERN, lagosDay, startOfLagosDay, addDays, daysBetween };
