// Run with `npm test` (Node's built-in test runner).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildLibraryEntries,
  continueReadingEntry,
  matchesFilter,
  progressLabel,
  progressPercent,
  readerLink,
  readingState,
  statusChip,
  visibleEntries,
} from "./library.js";
import { pickLatestPosition, resolveChapterIndex, scrollFraction, serverPosition } from "./readingProgress.js";

const book = (id, extra = {}) => ({ _id: id, title: `Book ${id}`, author: "Ada", chapterCount: 5, owned: true, ...extra });
const progress = (chapterIndex, percent, lastReadAt, completedAt = null) => ({ chapterIndex, chapterProgress: 0.5, percent, lastReadAt, completedAt });

const DATA = {
  books: {
    a: book("a", { title: "Zebra Tales", progress: progress(1, 30, "2026-10-10T10:00:00Z") }),
    b: book("b", { title: "Apple Days", progress: progress(4, 100, "2026-10-01T10:00:00Z", "2026-10-01T10:00:00Z") }),
    c: book("c", { title: "Middle Road", progress: null }),
    d: book("d", { title: "Bundled One", author: "Kemi", progress: progress(2, 50, "2026-10-12T10:00:00Z") }),
    p: book("p", { title: "Pending Book", owned: false }),
    r: book("r", { title: "Rejected Book", owned: false }),
    x: book("x", { title: "Was Revoked", owned: true, progress: null }),
  },
  items: [
    { requestId: "1", itemType: "book", status: "approved", title: "Zebra Tales", bookIds: ["a"], approvedAt: "2026-09-01T00:00:00Z" },
    { requestId: "2", itemType: "book", status: "approved", title: "Apple Days", bookIds: ["b"], approvedAt: "2026-09-05T00:00:00Z" },
    { requestId: "3", itemType: "book", status: "approved", title: "Middle Road", bookIds: ["c"], approvedAt: "2026-10-14T00:00:00Z" },
    { requestId: "4", itemType: "bundle", status: "approved", title: "Starter Bundle", bookIds: ["d", "a"], approvedAt: "2026-09-20T00:00:00Z" },
    { requestId: "5", itemType: "book", status: "pending", title: "Pending Book", bookIds: ["p"], requestedAt: "2026-10-15T00:00:00Z" },
    { requestId: "6", itemType: "book", status: "rejected", title: "Rejected Book", bookIds: ["r"], adminNote: "Amount mismatch", requestedAt: "2026-10-02T00:00:00Z" },
    // Revoked, then bought again: the old revoked request is hidden.
    { requestId: "7", itemType: "book", status: "revoked", title: "Was Revoked", bookIds: ["x"], requestedAt: "2026-08-01T00:00:00Z" },
    { requestId: "8", itemType: "book", status: "approved", title: "Was Revoked", bookIds: ["x"], approvedAt: "2026-10-03T00:00:00Z" },
    { requestId: "9", itemType: "bundle", status: "pending", title: "Big Bundle", bookIds: ["p", "c"], requestedAt: "2026-10-16T00:00:00Z" },
  ],
};

test("entries: one per owned book (bundles flattened, no duplicates), one per open request", () => {
  const entries = buildLibraryEntries(DATA);
  const keys = entries.map((e) => e.key).sort();
  assert.deepEqual(keys, ["book-a", "book-b", "book-c", "book-d", "book-x", "request-5", "request-6", "request-9"]);
  assert.equal(entries.find((e) => e.key === "book-a").fromBundle, null); // owned directly first
  assert.equal(entries.find((e) => e.key === "book-d").fromBundle, "Starter Bundle");
  assert.deepEqual(entries.find((e) => e.key === "request-9").includedBooks.map((b) => b.title), ["Pending Book", "Middle Road"]);
  assert.equal(buildLibraryEntries(null).length, 0);
});

test("status chips say what they mean in words, not colour alone", () => {
  const entries = buildLibraryEntries(DATA);
  const chip = (key) => statusChip(entries.find((e) => e.key === key), () => "15 Oct 2026");
  assert.deepEqual(chip("book-a"), { label: "Ready to read", tone: "ready", icon: "check" });
  assert.deepEqual(chip("request-5"), { label: "Pending approval · requested 15 Oct 2026", tone: "pending", icon: "clock" });
  assert.deepEqual(chip("request-6"), { label: "Rejected", tone: "rejected", icon: "x" });
  assert.equal(statusChip({ kind: "request", status: "revoked" }).label, "Access removed");
});

test("reading states and progress labels", () => {
  const entries = buildLibraryEntries(DATA);
  const get = (key) => entries.find((e) => e.key === key);
  assert.equal(readingState(get("book-a")), "reading");
  assert.equal(progressLabel(get("book-a")), "Chapter 2 of 5 · 30%");
  assert.equal(progressPercent(get("book-a")), 30);
  assert.equal(readingState(get("book-b")), "finished");
  assert.equal(progressLabel(get("book-b")), "Finished");
  assert.equal(progressPercent(get("book-b")), 100);
  assert.equal(readingState(get("book-c")), "not-started");
  assert.equal(progressLabel(get("book-c")), "Not started");
  assert.equal(progressPercent(get("book-c")), 0);
});

test("filters, search and sort", () => {
  const entries = buildLibraryEntries(DATA);
  const titles = (opts) => visibleEntries(entries, opts).map((e) => e.title);
  assert.deepEqual(titles({ filter: "reading", sort: "title" }), ["Bundled One", "Zebra Tales"]);
  assert.deepEqual(titles({ filter: "not-started", sort: "title" }), ["Middle Road", "Was Revoked"]);
  assert.deepEqual(titles({ filter: "finished" }), ["Apple Days"]);
  assert.deepEqual(titles({ filter: "pending", sort: "title" }), ["Big Bundle", "Pending Book"]);
  assert.equal(titles({ filter: "all" }).length, 8);
  assert.ok(!matchesFilter(entries.find((e) => e.key === "request-6"), "pending"));
  // Search by title, author, or a bundle's books.
  assert.deepEqual(titles({ query: "zebra" }), ["Zebra Tales"]);
  assert.deepEqual(titles({ query: "KEMI" }), ["Bundled One"]);
  assert.deepEqual(titles({ query: "middle", sort: "title" }), ["Big Bundle", "Middle Road"]);
  // Sorts.
  assert.deepEqual(titles({ filter: "reading", sort: "recent-read" }), ["Bundled One", "Zebra Tales"]);
  assert.equal(titles({ sort: "recent-purchase" })[0], "Big Bundle");
  assert.equal(titles({ sort: "title" })[0], "Apple Days");
});

test("the continue card is the most recently read unfinished book", () => {
  const entries = buildLibraryEntries(DATA);
  assert.equal(continueReadingEntry(entries).title, "Bundled One");
  const onlyFinished = buildLibraryEntries({ books: { b: DATA.books.b }, items: [DATA.items[1]] });
  assert.equal(continueReadingEntry(onlyFinished), null);
  assert.equal(continueReadingEntry([]), null);
});

test("reader links", () => {
  assert.equal(readerLink("abc"), "/kenlibs/read/abc");
  assert.equal(readerLink("abc", { listen: true }), "/kenlibs/read/abc?listen=1");
  assert.equal(readerLink("abc", { panel: "bookmarks" }), "/kenlibs/read/abc?panel=bookmarks");
});

test("reading position: latest wins, chapter by id, scroll fraction", () => {
  const local = { chapterIndex: 3, chapterId: "c3", chapterProgress: 0.4, updatedAt: 2000 };
  const server = serverPosition({ lastChapterIndex: 1, lastChapterId: "c1", chapterProgress: 0.9, positionUpdatedAt: new Date(1000).toISOString() });
  assert.deepEqual(pickLatestPosition(local, server), { position: local, source: "local" });
  assert.equal(pickLatestPosition({ ...local, updatedAt: 500 }, server).source, "server");
  assert.equal(pickLatestPosition(null, server).position.chapterIndex, 1);
  // An old server record with only a chapter (no timestamp) still counts.
  assert.equal(pickLatestPosition(null, serverPosition({ lastChapterIndex: 2 }), 2).position.chapterIndex, 2);
  assert.equal(pickLatestPosition(local, null, 2).source, "local");
  assert.deepEqual(pickLatestPosition(null, null, null), { position: null, source: null });

  const chapters = [{ _id: "c0" }, { _id: "c1" }, { _id: "c3" }];
  assert.equal(resolveChapterIndex(local, chapters), 2); // found by id after a reorder
  assert.equal(resolveChapterIndex({ chapterIndex: 9, chapterId: "" }, chapters), 2);
  assert.equal(resolveChapterIndex(null, chapters), 0);
  assert.equal(scrollFraction(500, 2000, 1000), 0.5);
  assert.equal(scrollFraction(0, 800, 1000), 0);
  assert.equal(scrollFraction(5000, 2000, 1000), 1);
});
