import { lazy } from "react";

const RELOAD_FLAG = "chunk-reload-attempted";

// React.lazy plus one recovery path: after a new deploy, a tab that was
// already open still references the previous build's hashed chunk names,
// which no longer exist — the dynamic import() rejects and the route would
// render nothing. Reloading once picks up the new index.html (and new chunk
// names). The sessionStorage flag stops a genuinely broken chunk from
// reloading forever; it's cleared again on the next successful load.
const lazyWithRetry = (importer) =>
  lazy(async () => {
    try {
      const module = await importer();
      try {
        sessionStorage.removeItem(RELOAD_FLAG);
      } catch {
        // Storage unavailable (private mode etc.) — nothing to clear.
      }
      return module;
    } catch (error) {
      let alreadyRetried = true;
      try {
        alreadyRetried = sessionStorage.getItem(RELOAD_FLAG) === "1";
        if (!alreadyRetried) sessionStorage.setItem(RELOAD_FLAG, "1");
      } catch {
        // Without storage we can't guard against a reload loop — don't reload.
      }
      if (!alreadyRetried) {
        window.location.reload();
        // Keep Suspense showing its fallback until the reload happens.
        return new Promise(() => {});
      }
      throw error;
    }
  });

export default lazyWithRetry;
