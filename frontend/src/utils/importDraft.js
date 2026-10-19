// "Import a book" review screen logic (pages/AdminImportPage.jsx). Pure, so
// `npm test` covers it. The draft comes from POST /api/admin/import/parse:
//   { format, fileName, title, author, description, chapters: [{ title,
//     content }], images: { key: { dataUri, ... } }, coverKey, warnings }
// Chapter content is Markdown; paragraphs are separated by blank lines.

let idCounter = 0;
const nextId = () => `ch${++idCounter}`;

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

const withId = (chapter) => ({ id: chapter.id || nextId(), title: String(chapter.title || ""), content: String(chapter.content || "") });

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
});

const update = (state, chapters) => ({ ...state, chapters });

export const renameChapter = (state, index, title) =>
  update(state, state.chapters.map((c, i) => (i === index ? { ...c, title } : c)));

// Merge a chapter with the next one. The next chapter's title becomes a
// heading inside the merged text, so nothing is lost.
export const mergeWithNext = (state, index) => {
  if (index < 0 || index >= state.chapters.length - 1) return state;
  const a = state.chapters[index];
  const b = state.chapters[index + 1];
  const merged = { ...a, content: [a.content, b.title ? `## ${b.title}` : "", b.content].filter(Boolean).join("\n\n") };
  return update(state, [...state.chapters.slice(0, index), merged, ...state.chapters.slice(index + 2)]);
};

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
  const second = withId({ title, content: rest.join("\n\n") });
  return update(state, [...state.chapters.slice(0, index), first, second, ...state.chapters.slice(index + 1)]);
};

export const moveChapter = (state, index, delta) => {
  const target = index + delta;
  if (target < 0 || target >= state.chapters.length) return state;
  const chapters = state.chapters.slice();
  [chapters[index], chapters[target]] = [chapters[target], chapters[index]];
  return update(state, chapters);
};

export const deleteChapter = (state, index) => update(state, state.chapters.filter((_, i) => i !== index));

// Problems that stop saving (shown next to the Save button).
export const reviewProblems = (state) => {
  const problems = [];
  if (!state.title.trim()) problems.push("Add a title.");
  if (!state.author.trim()) problems.push("Add the author's name.");
  if (!state.chapters.length) problems.push("Keep at least one chapter.");
  state.chapters.forEach((c, i) => {
    if (!c.title.trim()) problems.push(`Chapter ${i + 1} needs a title.`);
  });
  return problems;
};

// Body for POST /api/admin/import/commit. Only images still used by a
// chapter (or the chosen detected cover) are sent.
export const toCommitPayload = (state, { useDetectedCover = true, rights } = {}) => {
  const used = new Set();
  for (const c of state.chapters) for (const m of c.content.matchAll(/kenlibs-import:([\w-]+)/g)) used.add(m[1]);
  const coverKey = useDetectedCover && state.coverKey && state.images[state.coverKey] ? state.coverKey : null;
  if (coverKey) used.add(coverKey);
  const images = {};
  for (const key of used) if (state.images[key]) images[key] = state.images[key].dataUri || state.images[key];
  return {
    title: state.title.trim(),
    author: state.author.trim(),
    description: state.description.trim(),
    chapters: state.chapters.map((c) => ({ title: c.title.trim(), content: c.content })),
    images,
    coverKey,
    format: state.format,
    fileName: state.fileName,
    ...(rights ? { rights } : {}),
  };
};
