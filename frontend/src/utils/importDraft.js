// "Import a book" review screen logic (pages/AdminImportPage.jsx). Pure, so
// `npm test` covers it. The draft comes from POST /api/admin/import/parse:
//   { format, fileName, title, author, description, chapters: [{ title,
//     kind, content, wordCount, imageCount }], images: { key: { dataUri,
//     ... } }, coverKey, warnings, notes, needsSplit, longChapterWords }
// Chapter content is Markdown; paragraphs are separated by blank lines.
// `kind` is "chapter" (numbered), "front" / "back" (front and back matter,
// no number) or "part"; see utils/chapterKinds.js.

import { isNumbered } from "./chapterKinds.js";

let idCounter = 0;
const nextId = () => `ch${++idCounter}`;

const DEFAULT_LONG_CHAPTER_WORDS = 8000;
const KINDS = ["chapter", "front", "back", "part"];
const IMAGE_PLACEHOLDER = /!\[[^\]]*\]\(kenlibs-import:([\w-]+)\)/g;

// Markdown → plain text for previews. Escaped characters (\* \> …) are
// literal text, so they're set aside before the Markdown symbols are
// stripped and put back afterwards.
const plain = (markdown) =>
  String(markdown || "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\\(.)/g, (_, c) => `${c.charCodeAt(0)}`)
    .replace(/^\s*>\s?/gm, " ")
    .replace(/^\s*#{1,6}\s+/gm, " ")
    .replace(/[*_`~]/g, " ")
    .replace(/^\s*[-+]\s+/gm, " ")
    .replace(/(\d+)/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim();

export const wordCount = (markdown) => {
  const text = plain(markdown);
  return text ? text.split(" ").length : 0;
};

export const imageCount = (markdown) => (String(markdown || "").match(IMAGE_PLACEHOLDER) || []).length;

// The first ~`chars` characters of a chapter's text, for the review list.
export const firstLines = (markdown, chars = 160) => {
  const text = plain(markdown);
  return text.length > chars ? `${text.slice(0, chars).replace(/\s+\S*$/, "")}…` : text;
};

export const paragraphsOf = (markdown) =>
  String(markdown || "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

const withId = (chapter) => ({
  id: chapter.id || nextId(),
  title: String(chapter.title || ""),
  kind: KINDS.includes(chapter.kind) ? chapter.kind : "chapter",
  content: String(chapter.content || ""),
  imagesOn: chapter.imagesOn !== false,
});

export const createReviewState = (draft) => ({
  format: draft?.format || "",
  fileName: draft?.fileName || "",
  title: draft?.title || "",
  author: draft?.author || "",
  description: draft?.description || "",
  chapters: (draft?.chapters || []).map(withId),
  images: draft?.images || {},
  coverKey: draft?.coverKey || null,
  warnings: draft?.warnings || [],
  notes: draft?.notes || [],
  longChapterWords: Number(draft?.longChapterWords) || DEFAULT_LONG_CHAPTER_WORDS,
  keepOneChapter: false,
});

const update = (state, chapters) => ({ ...state, chapters });

export const renameChapter = (state, index, title) =>
  update(state, state.chapters.map((c, i) => (i === index ? { ...c, title } : c)));

export const setChapterKind = (state, index, kind) =>
  KINDS.includes(kind) ? update(state, state.chapters.map((c, i) => (i === index ? { ...c, kind } : c))) : state;

export const toggleChapterImages = (state, index) =>
  update(state, state.chapters.map((c, i) => (i === index ? { ...c, imagesOn: !c.imagesOn } : c)));

// Merge a chapter with the next one. The next chapter's title becomes a
// heading inside the merged text, so nothing is lost.
export const mergeWithNext = (state, index) => {
  if (index < 0 || index >= state.chapters.length - 1) return state;
  const a = state.chapters[index];
  const b = state.chapters[index + 1];
  const merged = { ...a, imagesOn: a.imagesOn || b.imagesOn, content: [a.content, b.title ? `## ${b.title}` : "", b.content].filter(Boolean).join("\n\n") };
  return update(state, [...state.chapters.slice(0, index), merged, ...state.chapters.slice(index + 2)]);
};

export const mergeWithPrevious = (state, index) => mergeWithNext(state, index - 1);

// Split a chapter before paragraph `at` (1 … paragraphs-1). The new
// chapter's title is the paragraph if it's a heading, else "<title> (2)".
export const splitChapter = (state, index, at, newTitle) => {
  const chapter = state.chapters[index];
  if (!chapter) return state;
  const paragraphs = paragraphsOf(chapter.content);
  if (at <= 0 || at >= paragraphs.length) return state;
  let rest = paragraphs.slice(at);
  let title = newTitle;
  if (!title) {
    const heading = rest[0].match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      title = heading[1].replace(/\\(.)/g, "$1").trim();
      rest = rest.slice(1);
    } else title = `${chapter.title || "Chapter"} (2)`;
  }
  const first = { ...chapter, content: paragraphs.slice(0, at).join("\n\n") };
  const second = withId({ title, kind: "chapter", content: rest.join("\n\n"), imagesOn: chapter.imagesOn });
  return update(state, [...state.chapters.slice(0, index), first, second, ...state.chapters.slice(index + 1)]);
};

// "Split by pattern": `/regex/` (case-insensitive unless flags say
// otherwise) or plain text a chapter line starts with ("Chapter", "***").
// → a test for one paragraph's plain text, or null if the pattern is invalid.
export const parseSplitPattern = (input) => {
  const value = String(input || "").trim();
  if (!value) return null;
  const regex = /^\/(.+)\/([a-z]*)$/.exec(value);
  if (regex) {
    try {
      const re = new RegExp(regex[1], regex[2].includes("i") ? regex[2] : `${regex[2]}i`);
      return (text) => text.length <= 160 && re.test(text);
    } catch {
      return null;
    }
  }
  const marker = value.toLowerCase();
  return (text) => text.length <= 160 && text.toLowerCase().startsWith(marker);
};

// Splits chapter `index` at every paragraph that matches the pattern; the
// matching line becomes the new chapter's title. Text before the first
// match stays in the original chapter. → { state, count } (count = new
// chapters made; 0 leaves the state unchanged).
export const splitByPattern = (state, index, input) => {
  const chapter = state.chapters[index];
  const test = parseSplitPattern(input);
  if (!chapter || !test) return { state, count: 0, invalid: !test };
  const paragraphs = paragraphsOf(chapter.content);
  const pieces = [];
  let current = { title: chapter.title, kind: chapter.kind, paragraphs: [], original: true };
  for (const p of paragraphs) {
    const text = plain(p);
    if (text && !p.startsWith("![") && test(text)) {
      if (current.original ? current.paragraphs.length : true) pieces.push(current);
      current = { title: text, kind: "chapter", paragraphs: [] };
    } else current.paragraphs.push(p);
  }
  pieces.push(current);
  const made = pieces.filter((p) => !p.original).length;
  if (!made) return { state, count: 0 };
  const replacement = pieces.map((p) =>
    p.original ? { ...chapter, content: p.paragraphs.join("\n\n") } : withId({ title: p.title, kind: p.kind, content: p.paragraphs.join("\n\n"), imagesOn: chapter.imagesOn })
  );
  return { state: update(state, [...state.chapters.slice(0, index), ...replacement, ...state.chapters.slice(index + 1)]), count: made };
};

export const moveChapter = (state, index, delta) => {
  const target = index + delta;
  if (target < 0 || target >= state.chapters.length) return state;
  const chapters = state.chapters.slice();
  [chapters[index], chapters[target]] = [chapters[target], chapters[index]];
  return update(state, chapters);
};

export const deleteChapter = (state, index) => update(state, state.chapters.filter((_, i) => i !== index));

// One long chapter and nothing else numbered: don't accept it silently.
export const longSingleChapter = (state) => {
  const numbered = state.chapters.filter(isNumbered);
  if (numbered.length > 1) return null;
  return state.chapters.find((c) => wordCount(c.content) > state.longChapterWords) || null;
};

export const setKeepOneChapter = (state, keep) => ({ ...state, keepOneChapter: Boolean(keep) });

// "12 chapters, 3 front/back matter sections, 18 images, 4 warnings"
export const reviewSummary = (state) => {
  const chapters = state.chapters.filter(isNumbered).length;
  const matter = state.chapters.length - chapters;
  const images = state.chapters.reduce((sum, c) => sum + (c.imagesOn ? imageCount(c.content) : 0), 0);
  const warnings = state.warnings.length + (longSingleChapter(state) ? 1 : 0);
  const plural = (n, one, many) => `${n.toLocaleString("en-NG")} ${n === 1 ? one : many}`;
  return {
    chapters,
    matter,
    images,
    warnings,
    line: [plural(chapters, "chapter", "chapters"), plural(matter, "front/back matter section", "front/back matter sections"), plural(images, "image", "images"), plural(warnings, "warning", "warnings")].join(", "),
  };
};

// Problems that stop saving (shown next to the Save button).
export const reviewProblems = (state) => {
  const problems = [];
  if (!state.title.trim()) problems.push("Add a title.");
  if (!state.author.trim()) problems.push("Add the author's name.");
  if (!state.chapters.length) problems.push("Keep at least one chapter.");
  state.chapters.forEach((c, i) => {
    if (!c.title.trim()) problems.push(`Section ${i + 1} needs a title.`);
  });
  if (longSingleChapter(state) && !state.keepOneChapter) problems.push("Split the long chapter, or tick “Keep it as one chapter”.");
  return problems;
};

const withoutImages = (content) =>
  paragraphsOf(content.replace(IMAGE_PLACEHOLDER, ""))
    .filter((p) => p.trim())
    .join("\n\n");

// Body for POST /api/admin/import/commit. Only images still used by a
// chapter (with its pictures switched on) or the chosen cover are sent.
export const toCommitPayload = (state, { useDetectedCover = false, rights } = {}) => {
  const chapters = state.chapters.map((c) => ({ title: c.title.trim(), kind: c.kind, content: c.imagesOn ? c.content : withoutImages(c.content) }));
  const used = new Set();
  for (const c of chapters) for (const m of c.content.matchAll(/kenlibs-import:([\w-]+)/g)) used.add(m[1]);
  const coverKey = useDetectedCover && state.coverKey && state.images[state.coverKey] ? state.coverKey : null;
  if (coverKey) used.add(coverKey);
  const images = {};
  for (const key of used) if (state.images[key]) images[key] = state.images[key].dataUri || state.images[key];
  return {
    title: state.title.trim(),
    author: state.author.trim(),
    description: state.description.trim(),
    chapters,
    images,
    coverKey,
    format: state.format,
    fileName: state.fileName,
    ...(rights ? { rights } : {}),
  };
};
