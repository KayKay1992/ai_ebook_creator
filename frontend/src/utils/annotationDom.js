// DOM side of reader highlights (KenlibsReadPage). Each rendered paragraph
// is an element with data-paragraph-index (the same index Listen Mode
// uses); offsets are characters into that element's text, counted over its
// text nodes. Highlights are painted with the CSS Custom Highlight API
// (CSS.highlights + ::highlight() in index.css), which colours text without
// adding or moving any elements, so React's rendering and Listen Mode's
// block highlighting are untouched. Browsers without it still get the
// panel, just no colour in the text.

export const HIGHLIGHT_COLORS = ["yellow", "green", "blue", "pink"];

export const supportsHighlightPainting = () =>
  typeof window !== "undefined" && typeof window.CSS !== "undefined" && "highlights" in window.CSS && typeof window.Highlight === "function";

export const paragraphElementOf = (node) => {
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  return element?.closest?.("[data-paragraph-index]") || null;
};

export const paragraphIndexOf = (element) => Number(element.getAttribute("data-paragraph-index"));

// Character offset of (node, offset) within `paragraph`'s text.
export const offsetWithin = (paragraph, node, offset) => {
  const range = document.createRange();
  range.selectNodeContents(paragraph);
  range.setEnd(node, offset);
  return range.toString().length;
};

// A DOM Range covering [start, end) of `paragraph`'s text, or null.
export const rangeFromOffsets = (paragraph, start, end) => {
  const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let position = 0;
  let startSet = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.data.length;
    if (!startSet && start <= position + length) {
      range.setStart(node, start - position);
      startSet = true;
    }
    if (startSet && end <= position + length) {
      range.setEnd(node, end - position);
      return range;
    }
    position += length;
  }
  return null;
};

// { paragraph, offset } for the character under a point (a tap or click),
// or null.
export const caretAtPoint = (x, y) => {
  let node = null;
  let offset = 0;
  if (document.caretPositionFromPoint) {
    const position = document.caretPositionFromPoint(x, y);
    if (position) ({ offsetNode: node, offset } = position);
  } else if (document.caretRangeFromPoint) {
    const range = document.caretRangeFromPoint(x, y);
    if (range) ({ startContainer: node, startOffset: offset } = range);
  }
  const paragraph = paragraphElementOf(node);
  if (!paragraph) return null;
  return { paragraph, offset: offsetWithin(paragraph, node, offset) };
};

// Paints `ranges` ([{ range, color }]) as the reader's highlights,
// replacing whatever was painted before. A no-op without browser support.
export const paintHighlights = (ranges) => {
  if (!supportsHighlightPainting()) return;
  for (const color of HIGHLIGHT_COLORS) {
    const painted = ranges.filter((r) => r.color === color).map((r) => r.range);
    if (painted.length) window.CSS.highlights.set(`kenlibs-hl-${color}`, new window.Highlight(...painted));
    else window.CSS.highlights.delete(`kenlibs-hl-${color}`);
  }
};

export const clearHighlights = () => paintHighlights([]);
