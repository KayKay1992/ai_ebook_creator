// Run with `npm test` (Node's built-in test runner).
import { test } from "node:test";
import assert from "node:assert/strict";
import { isNoise, isServiceWorkerRegistrationError } from "./errorNoise.js";
import { registerServiceWorker } from "./registerServiceWorker.js";

test("service worker registration failures are noise", () => {
  // The report that started this: a rejection thrown from the plugin's registerSW.js.
  assert.equal(isNoise("Error: Rejected", "Error: Rejected\n    at https://kenlibs.app/registerSW.js:1:120"), true);
  assert.equal(isNoise("Error: Rejected", ""), true);
  assert.equal(isNoise("Rejected", ""), true);
  assert.equal(isNoise("TypeError: x", "at ServiceWorkerContainer.register (native)"), true);
  assert.equal(isNoise("TypeError: x", "at navigator.serviceWorker.register (main.js:1:2)"), true);
  assert.equal(
    isNoise("SecurityError: Failed to register a ServiceWorker for scope ('https://kenlibs.app/') with script ('https://kenlibs.app/sw.js'): The user denied permission to use Service Worker.", ""),
    true
  );
  assert.equal(isNoise("InvalidStateError: Failed to register a ServiceWorker: The document is in an invalid state.", ""), true);
  assert.equal(isNoise("TypeError: Failed to update a ServiceWorker for scope ('https://kenlibs.app/')", ""), true);
  assert.equal(isNoise("SecurityError: The operation is insecure.", ""), true);
  assert.equal(isServiceWorkerRegistrationError("InvalidStateError: ServiceWorker registration was aborted"), true);
});

test("the existing noise filters still apply", () => {
  assert.equal(isNoise("ResizeObserver loop completed with undelivered notifications.", ""), true);
  assert.equal(isNoise("Script error.", ""), true);
  assert.equal(isNoise("TypeError: x", "at chrome-extension://abc/content.js:1:1"), true);
  assert.equal(isNoise("CanceledError: canceled", ""), true);
  assert.equal(isNoise("TypeError: Failed to fetch", ""), true);
  assert.equal(isNoise("", ""), true);
});

test("real errors are still reported", () => {
  assert.equal(isNoise("TypeError: Cannot read properties of undefined (reading 'title')", "at BookCard (https://kenlibs.app/assets/index-abc.js:1:2)"), false);
  assert.equal(isNoise("Error: Rejected by the server: 500", ""), false);
  assert.equal(isNoise("SecurityError: Blocked a frame with origin", ""), false);
  assert.equal(isNoise("InvalidStateError: The object is in an invalid state.", "at saveHighlight (index.js:1:2)"), false);
});

const fakeWindow = (readyState = "complete") => {
  const listeners = {};
  return { document: { readyState }, addEventListener: (type, fn) => (listeners[type] = fn), fire: (type) => listeners[type]?.() };
};
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test("a refused registration is caught and only logged", async () => {
  const logs = [];
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  globalThis.process.on("unhandledRejection", onUnhandled);
  try {
    const calls = [];
    const nav = { serviceWorker: { register: (...args) => (calls.push(args), Promise.reject(new Error("Rejected"))) } };
    registerServiceWorker({ nav, win: fakeWindow(), base: "/", log: (...args) => logs.push(args.join(" ")) });
    await flush();
    await flush();
    assert.deepEqual(calls, [["/sw.js", { scope: "/" }]]);
    assert.equal(logs.length, 1);
    assert.match(logs[0], /service worker not registered: Error Rejected/);

    // A synchronous throw is caught too.
    const throwing = { serviceWorker: { register: () => { throw new Error("SecurityError"); } } };
    registerServiceWorker({ nav: throwing, win: fakeWindow(), log: (...args) => logs.push(args.join(" ")) });
    assert.equal(logs.length, 2);
    await flush();
    assert.deepEqual(unhandled, []);
  } finally {
    globalThis.process.off("unhandledRejection", onUnhandled);
  }
});

test("registration waits for load, and is skipped without service worker support", () => {
  const calls = [];
  const nav = { serviceWorker: { register: (...args) => (calls.push(args), Promise.resolve({})) } };
  const win = fakeWindow("loading");
  registerServiceWorker({ nav, win, base: "/app/" });
  assert.equal(calls.length, 0);
  win.fire("load");
  assert.deepEqual(calls, [["/app/sw.js", { scope: "/app/" }]]);
  assert.doesNotThrow(() => registerServiceWorker({ nav: {}, win: fakeWindow() }));
});
