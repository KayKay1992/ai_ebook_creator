// Run with `npm test` (Node's built-in test runner).
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatNaira } from "./kenlibsPricing.js";

test("one Naira format: separators, decimals only when there are any", () => {
  assert.equal(formatNaira(5000), "₦5,000");
  assert.equal(formatNaira(1234567), "₦1,234,567");
  assert.equal(formatNaira(1500.5), "₦1,500.50");
  assert.equal(formatNaira(9.99), "₦9.99");
  assert.equal(formatNaira(0), "₦0");
  assert.equal(formatNaira(10045.0000001), "₦10,045");
  assert.equal(formatNaira(undefined), "₦0");
  assert.equal(formatNaira("2500"), "₦2,500");
});
