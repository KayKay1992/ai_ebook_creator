// Splits chapter markdown into paragraph-ish "blocks" for Listen Mode
// (Step 33) — good enough for typical AI-generated prose (headers,
// paragraphs, occasional lists), deliberately not a full markdown parser.
// Each block keeps its original markdown (for normal rendering) alongside
// its character range within the concatenated spoken text, so a
// SpeechSynthesisUtterance boundary event's charIndex can be mapped back
// to "which block is currently being read" for highlighting.

// Strips markdown syntax down to plain, speakable text — e.g. "## Chapter
// Two" -> "Chapter Two", "**bold**" -> "bold". Order matters: longer
// emphasis markers are unwrapped before shorter ones so "***x***" doesn't
// get half-stripped by the "*x*" pattern first.
export const stripMarkdownForSpeech = (text) => {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images: drop entirely
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links: keep the label
    .replace(/(\*\*\*|___)(.+?)\1/g, "$2")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(\*|_)(.+?)\1/g, "$2")
    .replace(/`([^`]+)`/g, "$1") // inline code
    .replace(/^#{1,6}\s+/gm, "") // heading markers
    .replace(/^>\s?/gm, "") // blockquote markers
    .replace(/^\s*[-*+]\s+/gm, "") // bullet list markers
    .replace(/^\s*\d+\.\s+/gm, "") // numbered list markers
    .replace(/^(-{3,}|\*{3,}|_{3,})\s*$/gm, "") // horizontal rules
    .replace(/\n+/g, ". ") // remaining line breaks -> a spoken pause
    .replace(/\s{2,}/g, " ")
    .trim();
};

// `markdown` -> { blocks: [{ markdown, start, end }], spokenText }
// blocks are in document order; start/end are char offsets into spokenText.
export const buildSpeechBlocks = (markdown) => {
  const rawBlocks = (markdown || "")
    .split(/\n\s*\n+/)
    .map((b) => b.trim())
    .filter(Boolean);

  const blocks = [];
  // Every block in document order, for rendering: speakable ones carry
  // their index in `blocks` (blockIndex), the rest (an image on its own, a
  // horizontal rule) have blockIndex null. Rendering these instead of
  // `blocks` keeps images on the page without changing the numbering Listen
  // Mode, saved positions and highlights rely on.
  const renderBlocks = [];
  let spokenText = "";

  rawBlocks.forEach((raw) => {
    const spoken = stripMarkdownForSpeech(raw);
    if (!spoken) {
      // e.g. an image on its own or a horizontal rule: shown, never spoken
      renderBlocks.push({ markdown: raw, blockIndex: null });
      return;
    }
    const start = spokenText.length ? spokenText.length + 1 : 0;
    spokenText = spokenText.length ? `${spokenText} ${spoken}` : spoken;
    renderBlocks.push({ markdown: raw, blockIndex: blocks.length });
    blocks.push({ markdown: raw, start, end: spokenText.length });
  });

  return { blocks, renderBlocks, spokenText };
};
