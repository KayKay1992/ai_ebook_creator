const crypto = require('crypto');

// Fingerprint of a chapter's source text (title + markdown content). Stored
// with things derived from a chapter (its AI summary, its translations), so
// editing the chapter afterwards shows them as out of date.
const chapterSourceHash = (chapter = {}) =>
    crypto
        .createHash('sha256')
        .update(`${String(chapter.title || '')}\n\n${String(chapter.content || '')}`, 'utf8')
        .digest('hex');

module.exports = { chapterSourceHash };
