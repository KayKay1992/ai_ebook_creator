// Which of a book's narration entries can actually be played: it has an
// uploaded file and its chapter still exists. (Audio for a chapter that was
// deleted from the book isn't auto-deleted — the admin sees it as
// "audio for removed chapters" in the editor — but it's never offered.)
const playableAudioEntries = (book) => {
    const chapterIds = Array.isArray(book?.chapters)
        ? new Set(book.chapters.map((chapter) => String(chapter._id)))
        : null;
    return (book?.audio?.chapters || []).filter(
        (entry) => entry.publicId && (!chapterIds || chapterIds.has(String(entry.chapterId)))
    );
};

// The only audio information public endpoints may expose: never a URL or
// publicId.
const audioSummary = (book) => {
    const count = playableAudioEntries(book).length;
    return { hasAudio: count > 0, audioChapterCount: count };
};

// Fields to add to a public query's select so audioSummary can work. Strip
// `audio` (and `chapters`, if the endpoint doesn't otherwise return them)
// from the result before responding — see withAudioSummary.
const AUDIO_SUMMARY_FIELDS = 'audio.chapters.publicId audio.chapters.chapterId chapters._id';

// Lean book → same book without the raw audio/chapter-id fields, plus
// hasAudio/audioChapterCount.
const withAudioSummary = (book, { keepChapters = false } = {}) => {
    if (!book) return book;
    const summary = audioSummary(book);
    const { audio, chapters, ...rest } = book;
    return { ...rest, ...(keepChapters ? { chapters } : {}), ...summary };
};

module.exports = { playableAudioEntries, audioSummary, AUDIO_SUMMARY_FIELDS, withAudioSummary };
