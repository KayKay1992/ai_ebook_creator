// Run with `npm test` (Node's built-in test runner).
import { test } from "node:test";
import assert from "node:assert/strict";
import { passkeyErrorCode, passkeyErrorMessage } from "./passkeyErrors.js";
import { guessDeviceName, isPasskeySupported } from "./passkeySupport.js";

const domError = (name, message = "") => Object.assign(new Error(message), { name });
const serverError = (status, data) => Object.assign(new Error("Request failed"), { response: { status, data } });

test("browser failures get friendly messages", () => {
  // Cancelled, or no passkey on this device: browsers report both the same way.
  assert.equal(passkeyErrorCode(domError("NotAllowedError"), { elapsedMs: 3000 }), "cancelled");
  assert.match(passkeyErrorMessage(domError("NotAllowedError")), /cancelled, or there's no Kenlibs passkey on this device/);
  // A timeout is recognised by how long it took.
  assert.equal(passkeyErrorCode(domError("NotAllowedError"), { elapsedMs: 119000 }), "timeout");
  assert.match(passkeyErrorMessage(domError("NotAllowedError"), { elapsedMs: 120000 }), /timed out/);
  assert.equal(passkeyErrorCode(domError("NotSupportedError")), "not_supported");
  assert.match(passkeyErrorMessage(domError("NotSupportedError")), /can't use passkeys/);
  assert.equal(passkeyErrorCode(domError("SecurityError")), "wrong_site");
  assert.equal(passkeyErrorCode(Object.assign(new Error("x"), { code: "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED" })), "already_added");
  assert.match(passkeyErrorMessage(domError("InvalidStateError"), { action: "register" }), /already has a passkey/);
});

test("server answers get friendly messages that reveal nothing", () => {
  assert.equal(passkeyErrorCode(serverError(403, { code: "password_required" })), "password_required");
  assert.match(passkeyErrorMessage(serverError(403, { code: "wrong_password" }), { action: "register" }), /password isn't right/);
  assert.match(passkeyErrorMessage(serverError(409, { code: "limit" }), { action: "register" }), /up to 5 passkeys/);
  assert.match(passkeyErrorMessage(serverError(400, { code: "expired" })), /took too long/);
  assert.match(passkeyErrorMessage(serverError(400, { code: "failed" })), /Couldn't sign you in with that passkey/);
  assert.equal(passkeyErrorMessage(serverError(429, { message: "Too many attempts. Please wait 3 minutes and try again." })), "Too many attempts. Please wait 3 minutes and try again.");
  assert.equal(passkeyErrorCode(Object.assign(new Error("Network Error"), { code: "ERR_NETWORK" })), "network");
});

test("device names and support detection", () => {
  assert.equal(guessDeviceName("Mozilla/5.0 (Linux; Android 13; TECNO CK7n) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36"), "Android phone");
  assert.equal(guessDeviceName("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"), "iPhone");
  assert.equal(guessDeviceName("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), "Windows PC");
  assert.equal(guessDeviceName("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)"), "Mac");
  assert.equal(guessDeviceName(""), "My device");
  // No window in Node: not supported, and no exception.
  assert.equal(isPasskeySupported(), false);
});
