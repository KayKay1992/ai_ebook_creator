// Light / Dark / System theme for the reader-facing app (not admin).
// Pure helpers (npm test) + the few DOM writes, shared by the React side
// (utils/themeStore.js, hooks/useTheme.js, components/ThemeController.jsx). index.html has a
// tiny inline copy of the same rules that runs before first paint; keep
// them in sync (utils/theme.test.js checks the inline script against this).
//
// How it works: <html data-theme="dark"> turns on the dark tokens in
// index.css. It is only ever set on reader-facing routes (isReaderPath), so
// admin keeps the light design no matter what the preference is.

export const THEME_STORAGE_KEY = "kenlibs_theme";
export const THEME_PREFERENCES = ["system", "light", "dark"];

// Browser UI colour (meta theme-color): matches the green header bar.
export const THEME_COLORS = { light: "#09262e", dark: "#061a1f", admin: "#ffffff" };

// Anything the stored value can be → a valid preference; default System.
export const parsePreference = (value) => (value === "light" || value === "dark" ? value : "system");

// "light" | "dark"
export const resolveTheme = (preference, systemPrefersDark) =>
  preference === "dark" || (preference !== "light" && Boolean(systemPrefersDark)) ? "dark" : "light";

// Admin routes (App.jsx's admin login/signup/password pages and every
// AdminRoute page). Everything else is reader-facing: the storefront and
// everything under /kenlibs, the public share link (/read/*), "/" and the
// 404 page for unknown URLs.
export const ADMIN_PATH = /^\/(?:login|signup|forgot-password|reset-password|dashboard|profile|editor|view-book|admin)(?:\/|$)/;
export const isReaderPath = (pathname = "") => !ADMIN_PATH.test(pathname);

// What the page should actually use: dark only on reader routes.
export const appliedTheme = (pathname, preference, systemPrefersDark) =>
  isReaderPath(pathname) ? resolveTheme(preference, systemPrefersDark) : "light";

// Writes the theme onto <html> (data-theme, color-scheme) and the browser
// bar colour. Safe to call repeatedly. Reader pages always carry
// data-theme ("light" or "dark"; theme-dark.css styles both); admin pages
// carry none, so they keep the plain tokens from index.css.
export const applyThemeToDocument = (pathname, theme, doc = document) => {
  const root = doc.documentElement;
  if (isReaderPath(pathname)) root.setAttribute("data-theme", theme);
  else root.removeAttribute("data-theme");
  root.style.colorScheme = theme;
  const meta = doc.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", !isReaderPath(pathname) ? THEME_COLORS.admin : THEME_COLORS[theme]);
};
