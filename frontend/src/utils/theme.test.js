// Run with `npm test` (Node's built-in test runner).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { appliedTheme, applyThemeToDocument, isReaderPath, parsePreference, resolveTheme, THEME_COLORS } from "./theme.js";
import { createThemeStore, readSnapshot } from "./themeStore.js";

const fakeStorage = (initial = {}) => {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v);
    },
    removeItem: (k) => {
      delete data[k];
    },
  };
};
const fakeMedia = (matches = false) => {
  const listeners = new Set();
  return {
    matches,
    addEventListener: (type, fn) => listeners.add(fn),
    removeEventListener: (type, fn) => listeners.delete(fn),
    flip(value) {
      this.matches = value;
      listeners.forEach((fn) => fn());
    },
    listenerCount: () => listeners.size,
  };
};

test("default is System, and invalid stored values fall back to it", () => {
  assert.equal(parsePreference(null), "system");
  assert.equal(parsePreference("purple"), "system");
  assert.equal(parsePreference(""), "system");
  assert.equal(parsePreference("dark"), "dark");
  const store = createThemeStore({ storage: fakeStorage({ kenlibs_theme: "neon" }), matchMedia: () => fakeMedia(false) });
  assert.deepEqual(readSnapshot(store.getSnapshot()), { preference: "system", theme: "light" });
  // Storage that throws (private mode, blocked) still works.
  const throwing = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  const blocked = createThemeStore({ storage: throwing, matchMedia: () => fakeMedia(true) });
  assert.deepEqual(readSnapshot(blocked.getSnapshot()), { preference: "system", theme: "dark" });
  blocked.setPreference("light");
  assert.equal(readSnapshot(blocked.getSnapshot()).theme, "light");
});

test("the choice persists; System clears it", () => {
  const storage = fakeStorage();
  const store = createThemeStore({ storage, matchMedia: () => fakeMedia(false) });
  store.setPreference("dark");
  assert.equal(storage.data.kenlibs_theme, "dark");
  const reloaded = createThemeStore({ storage, matchMedia: () => fakeMedia(false) });
  assert.deepEqual(readSnapshot(reloaded.getSnapshot()), { preference: "dark", theme: "dark" });
  reloaded.setPreference("system");
  assert.equal("kenlibs_theme" in storage.data, false);
  reloaded.setPreference("bogus");
  assert.equal(readSnapshot(reloaded.getSnapshot()).preference, "system");
});

test("System follows the OS live; explicit choices don't", () => {
  const media = fakeMedia(false);
  const store = createThemeStore({ storage: fakeStorage(), matchMedia: () => media });
  let calls = 0;
  const unsubscribe = store.subscribe(() => calls++);
  assert.equal(readSnapshot(store.getSnapshot()).theme, "light");
  media.flip(true);
  assert.equal(calls, 1);
  assert.equal(readSnapshot(store.getSnapshot()).theme, "dark");
  store.setPreference("light");
  media.flip(true);
  assert.equal(readSnapshot(store.getSnapshot()).theme, "light");
  unsubscribe();
  assert.equal(media.listenerCount(), 0);
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("dark", false), "dark");
  assert.equal(resolveTheme("light", true), "light");
});

test("a change in another tab is picked up", () => {
  const storage = fakeStorage();
  const windowListeners = {};
  const store = createThemeStore({
    storage,
    matchMedia: () => fakeMedia(false),
    addWindowListener: (type, fn) => (windowListeners[type] = fn),
    removeWindowListener: () => {},
  });
  let calls = 0;
  store.subscribe(() => calls++);
  storage.setItem("kenlibs_theme", "dark");
  windowListeners.storage({ key: "kenlibs_theme" });
  assert.equal(calls, 1);
  assert.equal(readSnapshot(store.getSnapshot()).theme, "dark");
});

test("admin is unaffected: dark only ever applies on reader-facing routes", () => {
  // Unknown URLs (the 404 page) count as reader-facing too.
  for (const path of ["/", "/kenlibs", "/kenlibs/", "/kenlibs/book/1", "/kenlibs/my-books", "/kenlibs/read/1", "/kenlibs/login", "/kenlibs/checkout/book/1", "/read/AbC123", "/no-such-page", "/kenlibsx", "/readers", "/dashboards"]) {
    assert.equal(isReaderPath(path), true, path);
    assert.equal(appliedTheme(path, "dark", false), "dark", path);
  }
  for (const path of ["/dashboard", "/admin/analytics", "/editor/1", "/editor/1/cover", "/profile", "/view-book/1", "/login", "/signup", "/forgot-password", "/reset-password/abc"]) {
    assert.equal(isReaderPath(path), false, path);
    assert.equal(appliedTheme(path, "dark", true), "light", path);
  }
});

// A minimal document for applyThemeToDocument and the inline script.
const fakeDocument = () => {
  const attrs = {};
  const meta = { content: "", setAttribute(name, value) { this[name] = value; } };
  return {
    attrs,
    meta,
    documentElement: {
      style: {},
      setAttribute: (name, value) => (attrs[name] = value),
      removeAttribute: (name) => delete attrs[name],
    },
    querySelector: () => meta,
  };
};

test("applyThemeToDocument sets data-theme, color-scheme and the browser bar colour", () => {
  const doc = fakeDocument();
  applyThemeToDocument("/kenlibs", "dark", doc);
  assert.equal(doc.attrs["data-theme"], "dark");
  assert.equal(doc.documentElement.style.colorScheme, "dark");
  assert.equal(doc.meta.content, THEME_COLORS.dark);
  applyThemeToDocument("/kenlibs", "light", doc);
  assert.equal(doc.attrs["data-theme"], "light"); // reader pages always carry it (light AA tokens)
  assert.equal(doc.meta.content, THEME_COLORS.light);
  applyThemeToDocument("/admin/users", "light", doc);
  assert.equal(doc.attrs["data-theme"], undefined);
  assert.equal(doc.documentElement.style.colorScheme, "light");
  assert.equal(doc.meta.content, THEME_COLORS.admin);
});

test("index.html's pre-paint script makes the same decision as theme.js", () => {
  const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  for (const path of ["/kenlibs", "/kenlibs/read/1", "/read/x", "/", "/nope", "/dashboard", "/admin/users", "/login"]) {
    for (const stored of [null, "dark", "light", "junk"]) {
      for (const osDark of [false, true]) {
        const doc = fakeDocument();
        vm.runInNewContext(script, {
          location: { pathname: path },
          localStorage: { getItem: () => stored },
          matchMedia: () => ({ matches: osDark }),
          document: doc,
        });
        const expected = appliedTheme(path, parsePreference(stored), osDark);
        assert.equal(doc.attrs["data-theme"], isReaderPath(path) ? expected : undefined, `${path} ${stored} ${osDark}`);
        assert.equal(doc.documentElement.style.colorScheme, expected);
        assert.equal(doc.meta.content, !isReaderPath(path) ? THEME_COLORS.admin : THEME_COLORS[expected]);
      }
    }
  }
});
