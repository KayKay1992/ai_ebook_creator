// Run with `npm test` (Node's built-in test runner).
import { test } from "node:test";
import assert from "node:assert/strict";
import { rateLimitMessage } from "./rateLimit.js";

test("429s from the password endpoints become a friendly message; other errors don't", () => {
  const limited = (data, headers = {}) => ({ response: { status: 429, data, headers } });
  assert.equal(
    rateLimitMessage(limited({ code: "rate_limited", retryAfterSeconds: 420, message: "Too many attempts. Please wait 7 minutes and try again." })),
    "Too many attempts. Please wait 7 minutes and try again."
  );
  assert.equal(rateLimitMessage(limited({ retryAfterSeconds: 61 })), "Too many attempts. Please wait 2 minutes and try again.");
  assert.equal(rateLimitMessage(limited({}, { "retry-after": "30" })), "Too many attempts. Please wait 1 minute and try again.");
  assert.equal(rateLimitMessage(limited("Too many requests")), "Too many attempts. Please wait a few minutes and try again.");
  assert.equal(rateLimitMessage({ response: { status: 400, data: { message: "Invalid credentials" } } }), null);
  assert.equal(rateLimitMessage(new Error("Network Error")), null);
  assert.equal(rateLimitMessage(undefined), null);
});
