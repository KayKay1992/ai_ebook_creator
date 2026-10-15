// Pure helpers for the admin analytics page (no DOM; tested with `npm test`).
// Days are Lagos calendar days ('YYYY-MM-DD') as sent by the API, already
// zero-filled for the whole range.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const parseDay = (day) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const dayLabel = (day) => {
  const date = parseDay(day);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
};
// Monday of the day's week.
const weekStart = (day) => {
  const date = parseDay(day);
  const offset = (date.getUTCDay() + 6) % 7;
  return new Date(date.getTime() - offset * 86400000).toISOString().slice(0, 10);
};

// Groups the daily series into 'day' | 'week' | 'month' buckets:
// [{ key, label, from, to, cash, gross, orders }].
export const bucketSeries = (series, granularity = "day") => {
  const buckets = new Map();
  for (const point of series) {
    const key = granularity === "week" ? weekStart(point.date) : granularity === "month" ? point.date.slice(0, 7) : point.date;
    if (!buckets.has(key)) {
      const label =
        granularity === "month"
          ? `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`
          : granularity === "week"
            ? `Week of ${dayLabel(key)}`
            : dayLabel(key);
      buckets.set(key, { key, label, from: point.date, to: point.date, cash: 0, gross: 0, orders: 0 });
    }
    const bucket = buckets.get(key);
    bucket.to = point.date;
    bucket.cash += point.cash;
    bucket.gross += point.gross;
    bucket.orders += point.orders;
  }
  return [...buckets.values()];
};

// Running total of `field`, as a new array of buckets with `running`.
export const withRunningTotal = (buckets, field = "cash") => {
  let total = 0;
  return buckets.map((b) => {
    total += b[field];
    return { ...b, running: total };
  });
};

// Trend vs the previous period: { direction: 'up'|'down'|'flat'|'new'|'none', label }.
// mode 'percent' = relative change; 'points' = difference in percentage points.
export const trendOf = (current, previous, { mode = "percent" } = {}) => {
  const now = Number(current) || 0;
  const before = Number(previous) || 0;
  if (mode === "points") {
    const diff = Math.round((now - before) * 10) / 10;
    if (diff === 0) return { direction: "flat", label: "no change" };
    return { direction: diff > 0 ? "up" : "down", label: `${diff > 0 ? "+" : "−"}${Math.abs(diff)} pts` };
  }
  if (before === 0) return now === 0 ? { direction: "none", label: "—" } : { direction: "new", label: "new" };
  const change = Math.round(((now - before) / before) * 1000) / 10;
  if (change === 0) return { direction: "flat", label: "no change" };
  return { direction: change > 0 ? "up" : "down", label: `${change > 0 ? "+" : "−"}${Math.abs(change)}%` };
};

// Percentages from fewer than this many people get a "based on N" warning.
export const SMALL_SAMPLE = 30;
export const isSmallSample = (n) => Number(n) < SMALL_SAMPLE;

// Evenly spaced axis ticks from 0, with a round step, ending at the first
// tick at or above `max` (at most `count` steps).
export const niceTicks = (max, count = 4) => {
  if (!(max > 0)) return Array.from({ length: count + 1 }, (_, i) => i);
  const rough = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough);
  const steps = Math.max(1, Math.ceil(max / step - 1e-9));
  return Array.from({ length: steps + 1 }, (_, i) => Math.round(i * step * 100) / 100);
};

// Short axis label: ₦950, ₦12k, ₦1.5m.
export const compactNaira = (value) => {
  const v = Number(value) || 0;
  if (v >= 1e6) return `₦${Math.round(v / 1e5) / 10}m`;
  if (v >= 1e3) return `₦${Math.round(v / 100) / 10}k`;
  return `₦${Math.round(v * 100) / 100}`;
};
