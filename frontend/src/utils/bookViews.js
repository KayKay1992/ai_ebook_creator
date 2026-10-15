import { API_PATHS, BASE_URL } from "./apiPaths";

// Anonymous book-page view counting for the admin analytics funnel
// (backend/controller/bookViewController.js). At most one view per book per
// day from this browser: the day's books are remembered in localStorage.
// No cookies, no ids, no account: the request carries nothing about the
// reader. Fire-and-forget; failures (or blocked storage) are ignored.

const STORAGE_KEY = "kenlibs_viewed_books";

const lagosToday = () => new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 10);

export const trackBookView = (bookId) => {
  if (!bookId) return;
  try {
    const today = lagosToday();
    let seen = {};
    try {
      seen = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch {
      seen = {};
    }
    if (seen.day !== today) seen = { day: today, books: [] };
    if (seen.books.includes(bookId)) return;
    seen.books = [...seen.books.slice(-200), bookId];
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seen));
    } catch {
      // Without storage we can't dedupe across reloads; still count once
      // for this page load.
    }
    fetch(`${BASE_URL}${API_PATHS.PUBLIC.KENLIBS_BOOK_VIEW(bookId)}`, { method: "POST", keepalive: true, credentials: "omit" }).catch(() => {});
  } catch {
    /* never affect the page */
  }
};
