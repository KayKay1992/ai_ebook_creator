import { parsePreference, resolveTheme, THEME_STORAGE_KEY } from "./theme.js";

// The theme preference store behind hooks/useTheme.js: one shared value,
// persisted (try/catch), following the OS live while on "system", and
// picking up changes made in another tab. Storage and matchMedia are
// injectable so utils/theme.test.js can drive it without a browser.
export const createThemeStore = ({
  storage = typeof localStorage === "undefined" ? null : localStorage,
  matchMedia = typeof window === "undefined" ? null : (query) => window.matchMedia(query),
  addWindowListener = typeof window === "undefined" ? null : (type, fn) => window.addEventListener(type, fn),
  removeWindowListener = typeof window === "undefined" ? null : (type, fn) => window.removeEventListener(type, fn),
} = {}) => {
  const read = () => {
    try {
      return parsePreference(storage?.getItem(THEME_STORAGE_KEY));
    } catch {
      return "system";
    }
  };
  const media = (() => {
    try {
      return matchMedia?.("(prefers-color-scheme: dark)") || null;
    } catch {
      return null;
    }
  })();
  let preference = read();
  const listeners = new Set();
  const notify = () => listeners.forEach((listener) => listener());
  const onStorage = (event) => {
    if (event.key === null || event.key === THEME_STORAGE_KEY) {
      preference = read();
      notify();
    }
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) {
        media?.addEventListener?.("change", notify);
        addWindowListener?.("storage", onStorage);
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          media?.removeEventListener?.("change", notify);
          removeWindowListener?.("storage", onStorage);
        }
      };
    },
    // A string, so React's useSyncExternalStore compares by value.
    getSnapshot() {
      return `${preference}|${media?.matches ? "dark" : "light"}`;
    },
    setPreference(next) {
      preference = parsePreference(next);
      try {
        if (preference === "system") storage?.removeItem(THEME_STORAGE_KEY);
        else storage?.setItem(THEME_STORAGE_KEY, preference);
      } catch {
        /* storage blocked: the choice lasts for this page only */
      }
      notify();
    },
  };
};

// { preference, theme } from a snapshot string.
export const readSnapshot = (snapshot) => {
  const [preference, system] = String(snapshot).split("|");
  return { preference: parsePreference(preference), theme: resolveTheme(preference, system === "dark") };
};
