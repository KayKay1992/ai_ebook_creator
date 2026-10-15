// Run with `npm test` (Node's built-in test runner).
import { test } from "node:test";
import assert from "node:assert/strict";
import { bucketSeries, withRunningTotal, trendOf, isSmallSample, niceTicks, compactNaira } from "./analyticsSeries.js";

const day = (date, cash = 0, orders = 0) => ({ date, cash, gross: cash, orders });
// Sun 2026-09-06 … Tue 2026-09-15, plus 1 Oct.
const SERIES = [
  day("2026-09-06", 100, 1),
  day("2026-09-07", 0),
  day("2026-09-08", 200, 1),
  day("2026-09-13", 50, 1),
  day("2026-09-14", 0),
  day("2026-09-15", 300, 2),
  day("2026-10-01", 1000, 1),
];

test("day buckets keep every day, with readable labels", () => {
  const buckets = bucketSeries(SERIES, "day");
  assert.equal(buckets.length, 7);
  assert.deepEqual(buckets[0], { key: "2026-09-06", label: "6 Sep", from: "2026-09-06", to: "2026-09-06", cash: 100, gross: 100, orders: 1 });
});

test("weeks start on Monday", () => {
  const weeks = bucketSeries(SERIES, "week");
  assert.deepEqual(
    weeks.map((w) => [w.key, w.cash, w.orders]),
    [
      ["2026-08-31", 100, 1], // Sunday 6 Sep belongs to the week of Mon 31 Aug
      ["2026-09-07", 250, 2],
      ["2026-09-14", 300, 2],
      ["2026-09-28", 1000, 1],
    ]
  );
  assert.equal(weeks[1].label, "Week of 7 Sep");
});

test("months, and the running total", () => {
  const months = bucketSeries(SERIES, "month");
  assert.deepEqual(months.map((m) => [m.label, m.cash]), [["Sep 2026", 650], ["Oct 2026", 1000]]);
  assert.deepEqual(withRunningTotal(months).map((m) => m.running), [650, 1650]);
});

test("trend chips", () => {
  assert.deepEqual(trendOf(150, 100), { direction: "up", label: "+50%" });
  assert.deepEqual(trendOf(50, 100), { direction: "down", label: "−50%" });
  assert.deepEqual(trendOf(100, 100), { direction: "flat", label: "no change" });
  assert.deepEqual(trendOf(10, 0), { direction: "new", label: "new" });
  assert.deepEqual(trendOf(0, 0), { direction: "none", label: "—" });
  assert.deepEqual(trendOf(33.3, 50, { mode: "points" }), { direction: "down", label: "−16.7 pts" });
});

test("small samples and axis helpers", () => {
  assert.equal(isSmallSample(8), true);
  assert.equal(isSmallSample(30), false);
  assert.deepEqual(niceTicks(10045), [0, 5000, 10000, 15000]);
  assert.deepEqual(niceTicks(10000), [0, 2500, 5000, 7500, 10000]);
  assert.deepEqual(niceTicks(9.99), [0, 2.5, 5, 7.5, 10]);
  assert.deepEqual(niceTicks(0), [0, 1, 2, 3, 4]);
  assert.equal(compactNaira(950), "₦950");
  assert.equal(compactNaira(12500), "₦12.5k");
  assert.equal(compactNaira(1500000), "₦1.5m");
  assert.equal(compactNaira(9.99), "₦9.99");
});
