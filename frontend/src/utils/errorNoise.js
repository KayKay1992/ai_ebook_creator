// What the browser error reporter (utils/errorReporter.js) never sends:
// errors that aren't bugs in our code. Pure, so `npm test` can cover it.

const NOISE = [
  /ResizeObserver loop/i,
  /^Script error\.?$/i,
  /(chrome|moz|safari|safari-web|ms-browser)-extension:\/\//i,
  /\b(AbortError|CanceledError|ERR_CANCELED)\b/,
  /\b(canceled|cancelled|the operation was aborted)\b/i,
  /\b(Network ?Error|Failed to fetch|Load failed|NetworkError when attempting to fetch|ERR_NETWORK|timeout of \d+ms exceeded)\b/i,
];

// The browser refusing to register the service worker (private mode,
// blocked storage, in-app browsers, an old or broken SW cache). Offline
// support is optional, so it's not a bug; utils/registerServiceWorker.js
// catches these itself, and this covers any that still reach the global
// handlers (e.g. from a cached older build that used the plugin's
// registerSW.js).
const SERVICE_WORKER_NOISE = [
  /registerSW\.js/,
  /serviceWorker\.register|ServiceWorkerContainer\.register/,
  /Failed to (register|update) a ServiceWorker/i,
  /ServiceWorker.*\b(SecurityError|InvalidStateError)\b|\b(SecurityError|InvalidStateError)\b.*ServiceWorker/i,
  // Bare messages these failures arrive with when there's no stack (they
  // don't name the service worker). Our own code never throws them.
  /^(Error: )?Rejected$/,
  /^SecurityError: The operation is insecure\.?$/,
];

export const isServiceWorkerRegistrationError = (message = "", stack = "") =>
  SERVICE_WORKER_NOISE.some((pattern) => pattern.test(message) || pattern.test(stack));

export const isNoise = (message = "", stack = "") =>
  !message ||
  NOISE.some((pattern) => pattern.test(message) || pattern.test(stack)) ||
  isServiceWorkerRegistrationError(message, stack);
