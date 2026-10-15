// Anchoring for readers' highlights (Kenlibs reader). Pure functions, no
// DOM, so they're tested with Node's built-in runner
// (annotationAnchor.test.js, `npm test`).
//
// A highlight is stored as { paragraphIndex, startOffset, endOffset, quote,
// prefix, suffix }: the paragraph's index in the reader's rendered block
// list (the same index Listen Mode uses), character offsets into that
// paragraph's visible text, the highlighted text itself, and up to
// CONTEXT_CHARS of text on either side. resolveAnchor finds it again:
//   1. the offsets, if the text there is still exactly the quote;
//   2. otherwise the quote anywhere in the chapter, using the context to
//      pick between repeats (ties prefer the original paragraph);
//   3. otherwise "changed": the chapter was edited and the text is gone or
//      can't be placed without guessing. The highlight is kept and shown in
//      the panel as "text changed", never deleted.

export const CONTEXT_CHARS = 32;

// paragraphText: the visible text of one paragraph; start/end: offsets.
export const createAnchor = (paragraphText, paragraphIndex, start, end) => ({
  paragraphIndex,
  startOffset: start,
  endOffset: end,
  quote: paragraphText.slice(start, end),
  prefix: paragraphText.slice(Math.max(0, start - CONTEXT_CHARS), start),
  suffix: paragraphText.slice(end, end + CONTEXT_CHARS),
});

const commonSuffixLength = (a, b) => {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
};

const commonPrefixLength = (a, b) => {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
};

// paragraphTexts: visible text of each paragraph, by paragraph index.
// Returns { status: 'ok', method: 'offset' | 'quote', paragraphIndex, start,
// end } or { status: 'changed' }.
export const resolveAnchor = (paragraphTexts, anchor) => {
  const { paragraphIndex, startOffset, endOffset, quote, prefix = "", suffix = "" } = anchor || {};
  if (!quote) return { status: "changed" };

  const atOffsets = paragraphTexts[paragraphIndex];
  if (typeof atOffsets === "string" && atOffsets.slice(startOffset, endOffset) === quote) {
    return { status: "ok", method: "offset", paragraphIndex, start: startOffset, end: endOffset };
  }

  const candidates = [];
  paragraphTexts.forEach((text, index) => {
    if (typeof text !== "string") return;
    for (let at = text.indexOf(quote); at !== -1; at = text.indexOf(quote, at + 1)) {
      const score =
        commonSuffixLength(text.slice(0, at), prefix) + commonPrefixLength(text.slice(at + quote.length), suffix);
      candidates.push({ paragraphIndex: index, start: at, end: at + quote.length, score });
    }
  });
  if (!candidates.length) return { status: "changed" };

  const best = Math.max(...candidates.map((c) => c.score));
  let top = candidates.filter((c) => c.score === best);
  if (top.length > 1) top = top.filter((c) => c.paragraphIndex === paragraphIndex);
  if (top.length !== 1) return { status: "changed" }; // ambiguous: don't guess
  return { status: "ok", method: "quote", ...top[0], score: undefined };
};

// Rough check, without rendering, of whether a highlight's text still
// exists somewhere in a chapter (for chapters not currently on screen):
// compares letters and digits only, so markdown syntax and spacing don't
// matter. The exact check happens when the chapter is open.
const lettersOnly = (text) => String(text || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
export const quoteStillPresent = (chapterPlainText, quote) => {
  const needle = lettersOnly(quote);
  return Boolean(needle) && lettersOnly(chapterPlainText).includes(needle);
};

// The annotations to show for one chapter in the language it's displayed in
// ('original' or a translation code): highlights made on a translation
// belong to that language only.
export const annotationsFor = (annotations, chapterId, language) =>
  (annotations || []).filter((a) => a.chapterId === String(chapterId) && a.language === language);

// "My highlights & notes" as Markdown (copy all / download), grouped by
// chapter in book order. chapters: [{ _id, title, language }] as displayed.
export const annotationsToMarkdown = (bookTitle, chapters, annotations) => {
  const lines = [`# ${bookTitle || "Highlights"}`, "", "Highlights & notes", ""];
  let count = 0;
  for (const chapter of chapters) {
    const highlights = annotationsFor(annotations, chapter._id, chapter.language).filter((a) => a.type === "highlight");
    if (!highlights.length) continue;
    lines.push(`## ${chapter.title || "Untitled chapter"}`, "");
    for (const highlight of highlights) {
      count++;
      lines.push(...highlight.anchor.quote.split("\n").map((line) => `> ${line}`));
      if (highlight.note) lines.push("", ...highlight.note.split("\n").map((line) => `Note: ${line}`));
      lines.push("");
    }
  }
  if (!count) lines.push("_No highlights yet._", "");
  return lines.join("\n");
};
