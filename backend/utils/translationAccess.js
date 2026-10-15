const BookTranslation = require('../models/BookTranslation');
const { TRANSLATION_LANGUAGES, getLanguage, publicLanguage } = require('../config/translationLanguages');

const configOrder = (code) => TRANSLATION_LANGUAGES.findIndex((language) => language.code === code);

// Read side of translations, for readers and the public book page. Only
// *published* chapter text is ever returned, only for chapters still in
// the book, and only for languages still in config/translationLanguages.js.
// Drafts, review state and job state never leave the admin endpoints.

const isPublishedEntry = (entry, chapterIds) =>
    Boolean(entry.publishedContent || entry.publishedTitle) && (!chapterIds || chapterIds.has(String(entry.chapterId)));

// [{ code, name, nativeName, listenMode, speechLang, publishedChapters }]
// for every language with at least one published chapter, in config order.
const publishedLanguages = async (bookId, chapterIds) => {
    const docs = await BookTranslation.find({ bookId, 'chapters.publishedAt': { $exists: true } })
        .select('language chapters.chapterId chapters.publishedTitle chapters.publishedContent')
        .lean();
    const counts = new Map();
    for (const doc of docs) {
        const count = doc.chapters.filter((entry) => isPublishedEntry(entry, chapterIds)).length;
        if (count && getLanguage(doc.language)) counts.set(doc.language, count);
    }
    return [...counts.entries()]
        .map(([code, publishedChapters]) => ({ ...publicLanguage(getLanguage(code)), publishedChapters }))
        .sort((a, b) => configOrder(a.code) - configOrder(b.code));
};

// { language, chapters: [{ chapterId, title, content, publishedAt }] } or
// null if the language has nothing published for this book.
const publishedTranslation = async (bookId, code, chapterIds) => {
    const language = getLanguage(code);
    if (!language) return null;
    const doc = await BookTranslation.findOne({ bookId, language: code })
        .select('chapters.chapterId chapters.publishedTitle chapters.publishedContent chapters.publishedAt')
        .lean();
    const chapters = (doc?.chapters || [])
        .filter((entry) => isPublishedEntry(entry, chapterIds))
        .map((entry) => ({
            chapterId: String(entry.chapterId),
            title: entry.publishedTitle,
            content: entry.publishedContent,
            publishedAt: entry.publishedAt || null,
        }));
    return chapters.length ? { language: publicLanguage(language), chapters } : null;
};

module.exports = { publishedLanguages, publishedTranslation };
