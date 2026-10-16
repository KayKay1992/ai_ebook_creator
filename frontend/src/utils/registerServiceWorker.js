// Registers the PWA service worker that vite-plugin-pwa builds (sw.js).
// Replaces the plugin's injected registerSW.js (injectRegister: false in
// vite.config.js), which did the same thing but left the registration
// promise uncaught: a browser that refuses (private mode, blocked
// storage, in-app browsers) then produced an "Unhandled rejection" in the
// error monitoring. Same URL, scope and timing as before; a failure is
// only logged at debug level, since offline support is optional.
// Production builds only: the dev server doesn't build a service worker.

export const registerServiceWorker = ({
  nav = typeof navigator === "undefined" ? undefined : navigator,
  win = typeof window === "undefined" ? undefined : window,
  base = "/",
  log = (...args) => console.debug(...args),
} = {}) => {
  if (!nav || !win || !("serviceWorker" in nav)) return;
  const register = () => {
    try {
      Promise.resolve(nav.serviceWorker.register(`${base}sw.js`, { scope: base })).catch((error) =>
        log("[pwa] service worker not registered:", error?.name || "", error?.message || String(error))
      );
    } catch (error) {
      log("[pwa] service worker not registered:", error?.name || "", error?.message || String(error));
    }
  };
  if (win.document?.readyState === "complete") register();
  else win.addEventListener("load", register, { once: true });
};
