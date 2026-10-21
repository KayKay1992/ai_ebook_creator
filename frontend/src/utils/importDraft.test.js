// Run with `npm test` (Node's built-in test runner).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createReviewState,
  deleteChapter,
  firstLines,
  mergeWithNext,
  moveChapter,
  paragraphsOf,
  imageCount,
  longSingleChapter,
  mergeWithPrevious,
  parseSplitPattern,
  renameChapter,
  reviewProblems,
  reviewSummary,
  setChapterKind,
  setKeepOneChapter,
  splitByPattern,
  toggleChapterImages,
  splitChapter,
  toCommitPayload,
  wordCount,
} from "./importDraft.js";
import { csvCell, licenceState, publishMissing, royaltiesCsv } from "./bookRights.js";
import { chapterNumbers, fallbackTitle, isNumbered } from "./chapterKinds.js";

const DRAFT = {
  format: "epub",
  fileName: "letters.epub",
  title: "The Harmattan Letters",
  author: "Ade Bello",
  description: "",
  chapters: [
    { title: "First", content: "Dear Amaka, the *dust* came early.\n\n![Dust](kenlibs-import:img2)\n\n## A turn\n\nWe waited." },
    { title: "Second", content: "> Patience is a long road." },
    { title: "Third", content: "The end." },
  ],
  images: { img1: { dataUri: "data:image/png;base64,COVER" }, img2: { dataUri: "data:image/png;base64,PIC" }, img3: { dataUri: "data:image/png;base64,UNUSED" } },
  coverKey: "img1",
  warnings: [],
};

test("word counts and first lines ignore Markdown and image placeholders", () => {
  assert.equal(wordCount("Dear Amaka, the *dust* came early.\n\n![Dust](kenlibs-import:img2)"), 6);
  assert.equal(firstLines("**Hello** there, [friend](https://x.example)."), "Hello there, friend.");
  assert.equal(firstLines("word ".repeat(100), 20), "word word word word…");
  assert.deepEqual(paragraphsOf("a\n\n\nb\n\n"), ["a", "b"]);
  // Escaped characters are literal text and survive; Markdown markers don't.
  assert.equal(firstLines("Boats \\<script\\>alert(1)\\</script\\> \\*sic\\*"), "Boats <script>alert(1)</script> *sic*");
  assert.equal(firstLines("> Patience\n\n## A turn\n\n- one"), "Patience A turn one");
});

test("rename, reorder, delete", () => {
  let s = createReviewState(DRAFT);
  s = renameChapter(s, 0, "Letter One");
  s = moveChapter(s, 2, -1);
  assert.deepEqual(s.chapters.map((c) => c.title), ["Letter One", "Third", "Second"]);
  assert.equal(moveChapter(s, 0, -1), s); // can't move past the start
  s = deleteChapter(s, 1);
  assert.deepEqual(s.chapters.map((c) => c.title), ["Letter One", "Second"]);
});

test("merge keeps the next chapter's title as a heading; split at a heading uses it as the title", () => {
  let s = createReviewState(DRAFT);
  s = mergeWithNext(s, 1);
  assert.deepEqual(s.chapters.map((c) => c.title), ["First", "Second"]);
  assert.equal(s.chapters[1].content, "> Patience is a long road.\n\n## Third\n\nThe end.");
  assert.equal(mergeWithNext(s, 1), s); // last chapter: nothing to merge with
  s = splitChapter(s, 0, 2); // before "## A turn"
  assert.deepEqual(s.chapters.map((c) => c.title), ["First", "A turn", "Second"]);
  assert.equal(s.chapters[1].content, "We waited.");
  s = splitChapter(s, 2, 1, "Coda"); // explicit title
  assert.deepEqual(s.chapters.map((c) => c.title), ["First", "A turn", "Second", "Coda"]);
  const unnamed = splitChapter(createReviewState(DRAFT), 0, 1);
  assert.equal(unnamed.chapters[1].title, "First (2)");
  assert.equal(splitChapter(s, 0, 0), s); // nothing before the split point
});

test("problems that stop saving", () => {
  let s = createReviewState({ ...DRAFT, author: " " });
  assert.deepEqual(reviewProblems(s), ["Add the author's name."]);
  s = renameChapter(createReviewState(DRAFT), 1, "");
  assert.deepEqual(reviewProblems(s), ["Section 2 needs a title."]);
  assert.ok(reviewProblems(createReviewState({ ...DRAFT, chapters: [] })).includes("Keep at least one chapter."));
});

test("the save payload sends only images still in use (and the cover if kept)", () => {
  const s = createReviewState(DRAFT);
  // The cover found in the file is only a suggestion: off unless chosen.
  assert.equal(toCommitPayload(s).coverKey, null);
  const payload = toCommitPayload(s, { useDetectedCover: true, rights: { type: "licensed", royaltyPercent: 15 } });
  assert.deepEqual(Object.keys(payload.images).sort(), ["img1", "img2"]);
  assert.equal(payload.images.img2, "data:image/png;base64,PIC");
  assert.equal(payload.coverKey, "img1");
  assert.deepEqual(payload.rights, { type: "licensed", royaltyPercent: 15 });
  const noCover = toCommitPayload(deleteChapter(s, 0), { useDetectedCover: false });
  assert.deepEqual(noCover.images, {});
  assert.equal(noCover.coverKey, null);
});

test("publish confirmation rules", () => {
  assert.deepEqual(publishMissing({}), []);
  assert.deepEqual(publishMissing({ type: "own" }, false), []);
  assert.deepEqual(publishMissing({ type: "licensed", holderName: "Ade", licenceNotes: "Signed" }, true), []);
  assert.deepEqual(publishMissing({ type: "licensed", holderName: "Ade", licenceNotes: " " }, true), ["Licence notes"]);
  assert.equal(publishMissing({ type: "licensed", holderName: "Ade", licenceNotes: "x" }, false).length, 1);
  assert.deepEqual(publishMissing({ type: "public_domain" }, true), ["A note on why the book is public domain"]);
  const now = Date.parse("2026-10-19T00:00:00Z");
  assert.equal(licenceState({ type: "licensed", licenceExpiresAt: "2026-10-01" }, now), "expired");
  assert.equal(licenceState({ type: "licensed", licenceExpiresAt: "2026-11-01" }, now), "expiring");
  assert.equal(licenceState({ type: "licensed", licenceExpiresAt: "2027-06-01" }, now), null);
});

test("CSV export escapes quotes and neutralises spreadsheet formulas", () => {
  assert.equal(csvCell('Say "hi"'), '"Say ""hi"""');
  assert.equal(csvCell("=HYPERLINK(1)"), `"'=HYPERLINK(1)"`);
  const csv = royaltiesCsv({
    range: { from: "2026-10-01", to: "2026-10-19" },
    testData: { hidden: true },
    books: [{ title: "Licensed One", author: "Ade Bello", rightsType: "licensed", units: 3, cash: 7900, royaltyPercent: 10, royaltyOwed: 790 }],
    authors: [{ author: "Ade Bello", books: 1, units: 3, cash: 7900, royaltyOwed: 790, paidInRange: 0, allTimeOwed: 790, paidAllTime: 400, balance: 390 }],
  });
  assert.match(csv, /"Licensed One","Ade Bello","Licensed from the author or publisher","3","7900","10","790"/);
  assert.match(csv, /"Ade Bello","1","3","7900","790","0","790","400","390"/);
  assert.match(csv, /test data hidden/);
});

test("front/back matter gets no chapter number", () => {
  const chapters = [{ kind: "front", title: "Preface" }, { kind: "chapter" }, {}, { kind: "part" }, { kind: "chapter" }, { kind: "back" }];
  assert.deepEqual(chapterNumbers(chapters), [null, 1, 2, null, 3, null]);
  assert.equal(isNumbered({}), true); // books saved before kinds existed
  assert.equal(fallbackTitle({ kind: "front" }, null), "Front matter");
  assert.equal(fallbackTitle({}, 4), "Chapter 4");
});

test("kinds, merge with the previous chapter, picture toggle, summary line", () => {
  let s = createReviewState({
    ...DRAFT,
    chapters: [{ title: "Preface", kind: "front", content: "Why." }, ...DRAFT.chapters, { title: "About the author", kind: "back", content: "Bio." }],
    warnings: ["One warning"],
  });
  assert.deepEqual(s.chapters.map((c) => c.kind), ["front", "chapter", "chapter", "chapter", "back"]);
  assert.equal(imageCount(s.chapters[1].content), 1);
  assert.equal(reviewSummary(s).line, "3 chapters, 2 front/back matter sections, 1 image, 1 warning");
  s = setChapterKind(s, 3, "back");
  assert.equal(setChapterKind(s, 0, "cover"), s); // unknown kinds are ignored
  assert.equal(reviewSummary(s).line, "2 chapters, 3 front/back matter sections, 1 image, 1 warning");
  s = mergeWithPrevious(s, 2);
  assert.deepEqual(s.chapters.map((c) => c.title), ["Preface", "First", "Third", "About the author"]);
  assert.match(s.chapters[1].content, /## Second\n\n> Patience/);
  assert.equal(mergeWithPrevious(s, 0), s);
  // Pictures off for a chapter: not counted, not sent.
  s = toggleChapterImages(s, 1);
  assert.equal(reviewSummary(s).images, 0);
  const payload = toCommitPayload(s);
  assert.doesNotMatch(payload.chapters[1].content, /kenlibs-import/);
  assert.match(payload.chapters[1].content, /the \*dust\* came early\.\n\n## A turn/);
  assert.deepEqual(payload.images, {});
  assert.deepEqual(payload.chapters.map((c) => c.kind), ["front", "chapter", "back", "back"]);
});

test("split by pattern: plain markers and /regex/, the matching line becomes the title", () => {
  const long = Array.from({ length: 12 }, (_, i) => `CHAPTER ${i + 1}\n\nThe text of chapter ${i + 1}.`).join("\n\n");
  let s = createReviewState({ ...DRAFT, chapters: [{ title: "Chapter 1", content: `A title page line.\n\n${long}` }] });
  const { state, count } = splitByPattern(s, 0, "chapter");
  assert.equal(count, 12);
  assert.equal(state.chapters.length, 13); // the text before the first match stays
  assert.equal(state.chapters[0].content, "A title page line.");
  assert.deepEqual(state.chapters.slice(1).map((c) => c.title), Array.from({ length: 12 }, (_, i) => `CHAPTER ${i + 1}`));
  assert.equal(state.chapters[5].content, "The text of chapter 5.");
  // Starting right at a match: no empty first chapter.
  s = createReviewState({ ...DRAFT, chapters: [{ title: "All", content: long }] });
  assert.equal(splitByPattern(s, 0, "/^chapter \\d+$/").state.chapters.length, 12);
  assert.equal(splitByPattern(s, 0, "Nothing matches").count, 0);
  assert.equal(splitByPattern(s, 0, "/[unclosed/").invalid, true);
  assert.equal(parseSplitPattern(""), null);
  // A match inside a long paragraph doesn't count.
  assert.equal(parseSplitPattern("chapter")(`Chapter ${"x ".repeat(100)}`), false);
});

test("one long chapter must be split or explicitly kept", () => {
  const words = "word ".repeat(9000);
  let s = createReviewState({ ...DRAFT, chapters: [{ title: "Chapter 1", content: words }], longChapterWords: 8000 });
  assert.ok(longSingleChapter(s));
  assert.equal(reviewSummary(s).warnings, 1);
  assert.ok(reviewProblems(s).some((p) => /long chapter/.test(p)));
  s = setKeepOneChapter(s, true);
  assert.deepEqual(reviewProblems(s), []);
  const short = createReviewState({ ...DRAFT, chapters: [{ title: "Chapter 1", content: "word ".repeat(100) }] });
  assert.equal(longSingleChapter(short), null);
});
