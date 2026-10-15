// Run with `npm test` (Node's built-in test runner; no extra dependency).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createAnchor,
  resolveAnchor,
  quoteStillPresent,
  annotationsFor,
  annotationsToMarkdown,
  CONTEXT_CHARS,
} from "./annotationAnchor.js";

const PARAGRAPHS = [
  "Chapter one begins here.",
  "Ada saved ₦5,000 every month. She kept a notebook of every naira she spent.",
  "Later, she opened a second account.",
];
const anchorFor = (paragraphIndex, quote) => {
  const text = PARAGRAPHS[paragraphIndex];
  const start = text.indexOf(quote);
  return createAnchor(text, paragraphIndex, start, start + quote.length);
};

test("createAnchor keeps the quote and up to CONTEXT_CHARS of context", () => {
  const anchor = anchorFor(1, "kept a notebook");
  assert.equal(anchor.quote, "kept a notebook");
  assert.equal(anchor.prefix.length, CONTEXT_CHARS);
  assert.ok(anchor.prefix.endsWith("every month. She "));
  assert.ok(anchor.suffix.startsWith(" of every naira"));
});

test("offset match: unchanged text resolves by offsets", () => {
  const anchor = anchorFor(1, "₦5,000");
  assert.deepEqual(resolveAnchor(PARAGRAPHS, anchor), {
    status: "ok",
    method: "offset",
    paragraphIndex: 1,
    start: anchor.startOffset,
    end: anchor.endOffset,
  });
});

test("quote fallback: text moved (new paragraph inserted, words added before it)", () => {
  const anchor = anchorFor(1, "kept a notebook");
  const edited = ["A new opening paragraph.", ...PARAGRAPHS];
  edited[2] = "Ada, a teacher, saved ₦5,000 every month. She kept a notebook of every naira she spent.";
  const result = resolveAnchor(edited, anchor);
  assert.equal(result.status, "ok");
  assert.equal(result.method, "quote");
  assert.equal(result.paragraphIndex, 2);
  assert.equal(edited[2].slice(result.start, result.end), "kept a notebook");
});

test("quote fallback uses the context to pick the right one of several repeats", () => {
  const texts = ["She saved money. Then she saved money again. Finally she saved money for school."];
  const start = texts[0].indexOf("saved money again") ;
  const anchor = createAnchor(texts[0], 0, start, start + "saved money".length);
  const edited = ["Intro. " + texts[0]];
  const result = resolveAnchor(edited, anchor);
  assert.equal(result.status, "ok");
  assert.equal(edited[0].slice(result.end, result.end + 6), " again");
});

test('"text changed" when the quote is gone', () => {
  const anchor = anchorFor(1, "kept a notebook");
  const edited = [...PARAGRAPHS];
  edited[1] = "Ada saved ₦5,000 every month and wrote nothing down.";
  assert.deepEqual(resolveAnchor(edited, anchor), { status: "changed" });
});

test('"text changed" rather than a guess when repeats are indistinguishable', () => {
  const anchor = { paragraphIndex: 5, startOffset: 0, endOffset: 3, quote: "and", prefix: "", suffix: "" };
  assert.deepEqual(resolveAnchor(["salt and pepper", "bread and butter"], anchor), { status: "changed" });
  // ...but a tie inside the original paragraph is settled by that paragraph.
  const inPlace = { paragraphIndex: 1, startOffset: 40, endOffset: 43, quote: "and", prefix: "", suffix: "" };
  assert.equal(resolveAnchor(["salt and pepper", "bread and butter"], inPlace).paragraphIndex, 1);
});

test("a missing anchor or quote is reported as changed, never thrown", () => {
  assert.deepEqual(resolveAnchor(PARAGRAPHS, null), { status: "changed" });
  assert.deepEqual(resolveAnchor(PARAGRAPHS, { paragraphIndex: 0, quote: "" }), { status: "changed" });
});

test("quoteStillPresent ignores markdown and spacing", () => {
  assert.equal(quoteStillPresent("She **kept a\nnotebook** of it", "kept a notebook"), true);
  assert.equal(quoteStillPresent("She wrote nothing", "kept a notebook"), false);
});

test("translation separation: each language only sees its own highlights", () => {
  const annotations = [
    { _id: "1", chapterId: "c1", language: "original", type: "highlight" },
    { _id: "2", chapterId: "c1", language: "yo", type: "highlight" },
    { _id: "3", chapterId: "c2", language: "yo", type: "highlight" },
  ];
  assert.deepEqual(annotationsFor(annotations, "c1", "original").map((a) => a._id), ["1"]);
  assert.deepEqual(annotationsFor(annotations, "c1", "yo").map((a) => a._id), ["2"]);
  assert.deepEqual(annotationsFor(annotations, "c1", "fr"), []);
});

test("annotationsToMarkdown groups highlights by chapter with notes, as text", () => {
  const md = annotationsToMarkdown(
    "My Book",
    [
      { _id: "c1", title: "One", language: "original" },
      { _id: "c2", title: "Two", language: "original" },
    ],
    [
      { chapterId: "c2", language: "original", type: "highlight", note: "Remember <b>this</b>", anchor: { quote: "second" } },
      { chapterId: "c1", language: "original", type: "highlight", note: "", anchor: { quote: "first" } },
      { chapterId: "c1", language: "original", type: "bookmark", anchor: { quote: "" } },
    ]
  );
  assert.ok(md.indexOf("## One") < md.indexOf("## Two"));
  assert.ok(md.includes("> first"));
  assert.ok(md.includes("> second\n\nNote: Remember <b>this</b>"));
  assert.equal((md.match(/^> /gm) || []).length, 2);
});
