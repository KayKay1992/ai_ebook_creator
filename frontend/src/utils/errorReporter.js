import { BASE_URL } from "./apiPaths";
import { isNoise } from "./errorNoise";

// Sends browser errors to the backend's error monitoring
// (POST /api/errors/report → backend/utils/errorLogger.js). Fire-and-forget:
// never throws, never shows anything, never blocks the page. The server
// scrubs and size-limits everything again; this side just avoids sending
// noise or floods:
//   - known noise (ResizeObserver, extensions, cancelled requests, the
//     network dropping, the browser refusing the service worker) is
//     skipped (utils/errorNoise.js),
//   - the same message is sent at most once a minute, and at most 10
//     reports per page load.
// Only the page path is sent (no query string or hash), never page content.

const MAX_REPORTS_PER_PAGE = 10;
const SAME_MESSAGE_GAP_MS = 60 * 1000;

// A lazily loaded chunk that no longer exists (after a deploy) or couldn't
// download. Not a bug to report: the page just needs a refresh.
export const isChunkLoadError = (error) =>
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|ChunkLoadError|Unable to preload CSS/i.test(
    String(error?.message || error || "")
  );

let sent = 0;
const lastSentAt = new Map();

const describe = (value) => {
  if (value instanceof Error) return { message: `${value.name}: ${value.message}`, stack: value.stack || "" };
  if (value && typeof value === "object" && "message" in value) return { message: String(value.message), stack: String(value.stack || "") };
  try {
    return { message: typeof value === "string" ? value : JSON.stringify(value), stack: "" };
  } catch {
    return { message: String(value), stack: "" };
  }
};

export const reportError = (kind, error, { componentStack = "" } = {}) => {
  try {
    if (isChunkLoadError(error)) return;
    const { message, stack } = describe(error);
    if (isNoise(message, stack)) return;
    if (sent >= MAX_REPORTS_PER_PAGE) return;
    const now = Date.now();
    if (now - (lastSentAt.get(message) || 0) < SAME_MESSAGE_GAP_MS) return;
    lastSentAt.set(message, now);
    sent += 1;

    let token = "";
    try {
      token = localStorage.getItem("token") || "";
    } catch {
      token = "";
    }
    const body = JSON.stringify({
      kind,
      message: message.slice(0, 2000),
      stack: stack.slice(0, 8000),
      componentStack: String(componentStack || "").slice(0, 3000),
      path: window.location.pathname.slice(0, 300),
      release: String(import.meta.env.VITE_RELEASE || "").slice(0, 60),
    });
    fetch(`${BASE_URL}/api/errors/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* reporting must never cause an error of its own */
  }
};

// Stale chunks after a deploy: lazyWithRetry.js reloads once for lazy
// routes; if a chunk still can't load (or a component lazy-loaded without
// it fails), the error boundary (components/ErrorBoundary.jsx) shows "a new
// version is available, refresh". Those aren't reported as errors.

let installed = false;
export const installGlobalErrorHandlers = () => {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (event) => {
    // Resource load errors (img/script tags) have no `error`; skip them.
    if (!event.error && !event.message) return;
    reportError("error", event.error || event.message);
  });
  window.addEventListener("unhandledrejection", (event) => {
    if (isChunkLoadError(event.reason)) return;
    reportError("unhandledrejection", event.reason);
  });
};
