// Pure client-side computation over a book's chapters — no backend calls.
// Recomputed by callers (via useMemo keyed on book.chapters) whenever
// content changes, including AI generation and Step 19's inline edits.

const WORDS_PER_MINUTE = 225; // midpoint of the standard 200-250 wpm estimate
const OUTLIER_THRESHOLD = 0.4; // 40% shorter/longer than the book's average

const countWords = (text) => {
  if (!text) return 0;
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
};

export const formatReadingTime = (minutes) => {
  if (minutes < 1) return "< 1 min read";
  const rounded = Math.round(minutes);
  if (rounded < 60) return `${rounded} min read`;
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;
  return mins > 0 ? `${hours}h ${mins}m read` : `${hours}h read`;
};

// Computes total/average word counts, reading time, and per-chapter pacing
// flags. Chapters with no content yet (not written) are excluded from the
// average and never flagged — an empty chapter isn't a pacing problem,
// it's just unwritten, and including it would skew the average down and
// make every written chapter look artificially "too long".
export const computeBookVitals = (chapters = []) => {
  const perChapter = chapters.map((chapter, index) => ({
    index,
    title: chapter.title || `Chapter ${index + 1}`,
    wordCount: countWords(chapter.content),
  }));

  const totalWords = perChapter.reduce((sum, c) => sum + c.wordCount, 0);
  const readingMinutes = totalWords / WORDS_PER_MINUTE;

  const writtenChapters = perChapter.filter((c) => c.wordCount > 0);
  const averageWordCount = writtenChapters.length
    ? writtenChapters.reduce((sum, c) => sum + c.wordCount, 0) / writtenChapters.length
    : 0;
  const maxWordCount = Math.max(1, ...perChapter.map((c) => c.wordCount));

  const withPacing = perChapter.map((c) => {
    if (!averageWordCount || c.wordCount === 0) {
      return { ...c, barPercent: 0, isOutlier: false, direction: null, deviationPercent: 0 };
    }
    const deviation = (c.wordCount - averageWordCount) / averageWordCount;
    const isOutlier = Math.abs(deviation) > OUTLIER_THRESHOLD;
    return {
      ...c,
      barPercent: Math.max(4, Math.round((c.wordCount / maxWordCount) * 100)),
      isOutlier,
      direction: isOutlier ? (deviation > 0 ? "long" : "short") : null,
      deviationPercent: Math.round(Math.abs(deviation) * 100),
    };
  });

  return {
    totalWords,
    readingMinutes,
    averageWordCount: Math.round(averageWordCount),
    chapters: withPacing,
  };
};
