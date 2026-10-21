// What a chapter is (Book.chapters[].kind, backend models/Book.js): a
// numbered chapter, or front/back matter and part dividers, which keep their
// own title and get no number (Preface, not "Chapter 1: Preface"). Chapters
// saved before `kind` existed have none and count as numbered chapters.
// Pure, so `npm test` covers it.

export const CHAPTER_KIND_OPTIONS = [
  { value: "chapter", label: "Chapter (numbered)" },
  { value: "front", label: "Front matter" },
  { value: "back", label: "Back matter" },
  { value: "part", label: "Part divider" },
];

export const isNumbered = (chapter) => !chapter?.kind || chapter.kind === "chapter";

// Chapter number for each chapter in order (1, 2, 3 … counting numbered
// chapters only), null for front/back matter and parts.
export const chapterNumbers = (chapters = []) => {
  let n = 0;
  return chapters.map((chapter) => (isNumbered(chapter) ? ++n : null));
};

// A title to show when a chapter has none.
export const fallbackTitle = (chapter, number) => {
  if (number) return `Chapter ${number}`;
  if (chapter?.kind === "front") return "Front matter";
  if (chapter?.kind === "back") return "Back matter";
  if (chapter?.kind === "part") return "Part";
  return "Untitled";
};
