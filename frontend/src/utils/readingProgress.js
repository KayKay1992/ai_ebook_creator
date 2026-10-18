// Reading position on this device (KenlibsReadPage), kept next to the
// server copy (/api/kenlibs/progress): the local copy is the offline
// fallback, and whichever of the two was recorded last wins. Pure apart
// from the try/catch-wrapped localStorage helpers (npm test).

const keyFor = (bookId) => `kenlibs_progress_${bookId}`;

// { chapterIndex, chapterId, chapterProgress, updatedAt } or null.
export const readLocalProgress = (bookId) => {
  try {
    const value = JSON.parse(localStorage.getItem(keyFor(bookId)) || "null");
    if (!value || typeof value.chapterIndex !== "number" || typeof value.updatedAt !== "number") return null;
    return value;
  } catch {
    return null;
  }
};

export const writeLocalProgress = (bookId, position) => {
  try {
    localStorage.setItem(keyFor(bookId), JSON.stringify(position));
  } catch {
    /* storage blocked: the server copy still works */
  }
};

// The server's position in the same shape, or null if it has none.
export const serverPosition = (data) => {
  if (!data || !data.positionUpdatedAt) return null;
  return {
    chapterIndex: data.lastChapterIndex ?? 0,
    chapterId: data.lastChapterId || "",
    chapterProgress: data.chapterProgress ?? 0,
    updatedAt: new Date(data.positionUpdatedAt).getTime() || 0,
  };
};

// Latest wins. A server record without a timestamp (saved before positions
// were tracked) still wins over nothing local. Returns
// { position, source: "local" | "server" | null }.
export const pickLatestPosition = (local, server, legacyServerChapter = null) => {
  if (local && server) return local.updatedAt > server.updatedAt ? { position: local, source: "local" } : { position: server, source: "server" };
  if (server) return { position: server, source: "server" };
  if (legacyServerChapter !== null && legacyServerChapter !== undefined && !local) {
    return { position: { chapterIndex: legacyServerChapter, chapterId: "", chapterProgress: 0, updatedAt: 0 }, source: "server" };
  }
  if (local) return { position: local, source: "local" };
  return { position: null, source: null };
};

// The chapter to open: the saved chapter id if it still exists (chapters
// can be reordered), else the saved index, clamped to the book.
export const resolveChapterIndex = (position, chapters) => {
  const count = chapters?.length || 0;
  if (!position || count === 0) return 0;
  if (position.chapterId) {
    const byId = chapters.findIndex((c) => String(c._id) === position.chapterId);
    if (byId >= 0) return byId;
  }
  return Math.min(Math.max(Math.trunc(position.chapterIndex) || 0, 0), count - 1);
};

// How far down the page the reader has scrolled, 0–1.
export const scrollFraction = (scrollTop, scrollHeight, viewportHeight) => {
  const max = scrollHeight - viewportHeight;
  if (!(max > 0)) return 0;
  return Math.min(1, Math.max(0, Math.round((scrollTop / max) * 1000) / 1000));
};
