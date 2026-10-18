// Library page logic (pages/KenlibsMyBooksPage.jsx), pure so `npm test`
// covers it. Input is GET /api/kenlibs/library's response.
//
// Entries:
//   - one "book" entry per book the reader owns (a direct purchase, or a
//     book in an approved bundle, labelled with that bundle), and
//   - one "request" entry per purchase request that isn't approved
//     (pending, rejected, revoked), book or bundle. A rejected/revoked
//     request is hidden once the reader owns everything it covered
//     (bought again later), so it doesn't linger as a false alarm.

export const FILTERS = [
  { key: "all", label: "All" },
  { key: "reading", label: "Reading" },
  { key: "not-started", label: "Not started" },
  { key: "finished", label: "Finished" },
  { key: "pending", label: "Pending" },
];

export const SORTS = [
  { key: "recent-read", label: "Recently read" },
  { key: "recent-purchase", label: "Recently purchased" },
  { key: "title", label: "Title A–Z" },
];

const time = (value) => (value ? new Date(value).getTime() || 0 : 0);

export const buildLibraryEntries = (data) => {
  const books = data?.books || {};
  const items = data?.items || [];
  const entries = [];
  const seenBooks = new Map();

  // Owned books: direct purchases first, so a book owned both ways shows as
  // the direct purchase.
  const approved = items.filter((i) => i.status === "approved").sort((a, b) => (a.itemType === "book" ? -1 : 0) - (b.itemType === "book" ? -1 : 0));
  for (const item of approved) {
    for (const bookId of item.bookIds) {
      const book = books[bookId];
      if (!book?.owned) continue;
      const purchasedAt = item.approvedAt || item.requestedAt;
      const existing = seenBooks.get(bookId);
      if (existing) {
        if (time(purchasedAt) > time(existing.purchasedAt)) existing.purchasedAt = purchasedAt;
        continue;
      }
      const entry = {
        key: `book-${bookId}`,
        kind: "book",
        status: "approved",
        bookId,
        book,
        title: book.title,
        author: book.author,
        fromBundle: item.itemType === "bundle" ? item.title : null,
        purchasedAt,
        lastReadAt: book.progress?.lastReadAt || null,
      };
      seenBooks.set(bookId, entry);
      entries.push(entry);
    }
  }

  for (const item of items) {
    if (item.status === "approved") continue;
    if (item.status !== "pending" && item.bookIds.length > 0 && item.bookIds.every((id) => books[id]?.owned)) continue;
    const includedBooks = item.bookIds.map((id) => books[id]).filter(Boolean);
    const first = item.itemType === "book" ? includedBooks[0] : null;
    entries.push({
      key: `request-${item.requestId}`,
      kind: "request",
      status: item.status,
      requestId: item.requestId,
      itemType: item.itemType,
      title: item.title,
      author: first?.author || "",
      book: first || null,
      includedBooks: item.itemType === "bundle" ? includedBooks : [],
      bundleCoverImage: item.bundleCoverImage || "",
      adminNote: item.adminNote || "",
      requestedAt: item.requestedAt,
      decidedAt: item.decidedAt,
      purchasedAt: item.requestedAt,
      lastReadAt: null,
    });
  }
  return entries;
};

// "reading" | "not-started" | "finished" for an owned book; the request
// status otherwise.
export const readingState = (entry) => {
  if (entry.kind !== "book") return entry.status;
  const progress = entry.book?.progress;
  if (progress?.completedAt) return "finished";
  if (progress && (progress.percent > 0 || progress.chapterIndex > 0 || progress.chapterProgress > 0)) return "reading";
  return "not-started";
};

// The chip on each card: a word (never colour alone) and a tone.
export const statusChip = (entry, formatDate = (d) => new Date(d).toLocaleDateString()) => {
  switch (entry.kind === "book" ? "approved" : entry.status) {
    case "approved":
      return { label: "Ready to read", tone: "ready", icon: "check" };
    case "pending":
      return {
        label: entry.requestedAt ? `Pending approval · requested ${formatDate(entry.requestedAt)}` : "Pending approval",
        tone: "pending",
        icon: "clock",
      };
    case "rejected":
      return { label: "Rejected", tone: "rejected", icon: "x" };
    case "revoked":
      return { label: "Access removed", tone: "revoked", icon: "ban" };
    default:
      return { label: entry.status, tone: "pending", icon: "clock" };
  }
};

// "Chapter 2 of 5 · 37%", "Not started", "Finished".
export const progressLabel = (entry) => {
  const state = readingState(entry);
  if (state === "finished") return "Finished";
  if (state === "not-started") return "Not started";
  const { chapterIndex = 0, percent = 0 } = entry.book.progress;
  const count = entry.book.chapterCount || 0;
  return count > 0 ? `Chapter ${chapterIndex + 1} of ${count} · ${percent}%` : `${percent}%`;
};

export const progressPercent = (entry) => {
  const state = readingState(entry);
  if (state === "finished") return 100;
  if (state === "not-started") return 0;
  return Math.max(1, Math.min(99, entry.book.progress.percent || 0));
};

export const matchesFilter = (entry, filter) => {
  if (filter === "all" || !filter) return true;
  if (filter === "pending") return entry.kind === "request" && entry.status === "pending";
  return entry.kind === "book" && readingState(entry) === filter;
};

export const matchesSearch = (entry, query) => {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  const haystack = [entry.title, entry.author, entry.fromBundle, ...(entry.includedBooks || []).flatMap((b) => [b.title, b.author])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
};

export const sortEntries = (entries, sort) => {
  const list = [...entries];
  const byTitle = (a, b) => String(a.title).localeCompare(String(b.title), undefined, { sensitivity: "base" });
  if (sort === "title") return list.sort(byTitle);
  if (sort === "recent-purchase") return list.sort((a, b) => time(b.purchasedAt) - time(a.purchasedAt) || byTitle(a, b));
  // Recently read: read books first (newest first), then the rest by purchase.
  return list.sort(
    (a, b) => time(b.lastReadAt) - time(a.lastReadAt) || time(b.purchasedAt) - time(a.purchasedAt) || byTitle(a, b)
  );
};

export const visibleEntries = (entries, { filter = "all", query = "", sort = "recent-read" } = {}) =>
  sortEntries(entries.filter((e) => matchesFilter(e, filter) && matchesSearch(e, query)), sort);

// The "Continue reading" card: the most recently read owned book that isn't
// finished, or null.
export const continueReadingEntry = (entries) =>
  entries
    .filter((e) => e.kind === "book" && readingState(e) === "reading" && e.lastReadAt)
    .sort((a, b) => time(b.lastReadAt) - time(a.lastReadAt))[0] || null;

// Reader links. The reader resumes at the saved chapter and position itself;
// these only add the shortcuts.
export const readerLink = (bookId, { panel, listen } = {}) => {
  const params = new URLSearchParams();
  if (panel) params.set("panel", panel);
  if (listen) params.set("listen", "1");
  const query = params.toString();
  return `/kenlibs/read/${bookId}${query ? `?${query}` : ""}`;
};

// Remembered filter and sort (per browser). Storage can be blocked.
const PREFS_KEY = "kenlibs_library_prefs";
export const loadLibraryPrefs = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
    return {
      filter: FILTERS.some((f) => f.key === saved.filter) ? saved.filter : "all",
      sort: SORTS.some((s) => s.key === saved.sort) ? saved.sort : "recent-read",
    };
  } catch {
    return { filter: "all", sort: "recent-read" };
  }
};
export const saveLibraryPrefs = (prefs) => {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ filter: prefs.filter, sort: prefs.sort }));
  } catch {
    /* storage blocked: nothing to remember */
  }
};
