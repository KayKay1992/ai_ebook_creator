const { splitBlocks } = require('./translationText');

// What the public share link (GET /api/public/books/:shareId) may show:
// a preview, never the whole book. Enforced here, on the server; the share
// page only renders what it's given.
//   - The first SHARE_PREVIEW_CHAPTERS chapters (default 1) get an excerpt
//     of their content: whole paragraphs up to ~1,500 characters.
//   - Every other chapter is title only, marked locked (enough for a table
//     of contents).
//   - No chapter descriptions, summaries, translations, audio or teaser.
// The full text is only ever available through the gated reader
// (readBook, behind hasBookAccess) and the owner's own editor/preview.

const DEFAULT_PREVIEW_CHAPTERS = 1;
const MAX_PREVIEW_CHAPTERS = 20;
const PREVIEW_CHARS = 1500;

// SHARE_PREVIEW_CHAPTERS: 0..20 (0 = table of contents only). Read per
// request, so tests and config changes take effect without a restart.
const getSharePreviewChapters = () => {
    const n = parseInt(process.env.SHARE_PREVIEW_CHAPTERS, 10);
    return Number.isFinite(n) ? Math.min(Math.max(n, 0), MAX_PREVIEW_CHAPTERS) : DEFAULT_PREVIEW_CHAPTERS;
};

// Cuts one over-long block to at most `max` characters, at the last
// sentence end if there is one in the second half, else between words.
const cutBlock = (block, max) => {
    const head = block.slice(0, max);
    const sentenceEnd = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
    let cut = sentenceEnd >= max / 2 ? head.slice(0, sentenceEnd + 1) : head.replace(/\s+\S*$/, '');
    if (!cut.trim()) cut = head;
    // Never leave a code fence open.
    if (/^\s{0,3}(`{3,}|~{3,})/.test(block)) return `${cut.trimEnd()}\n\`\`\``;
    return `${cut.trimEnd()}…`;
};

// The first ~maxChars of a chapter's markdown, ending at a paragraph
// boundary. Returns { content, truncated }.
const previewExcerpt = (markdown = '', maxChars = PREVIEW_CHARS) => {
    const blocks = splitBlocks(markdown);
    const kept = [];
    let length = 0;
    for (const block of blocks) {
        const added = (kept.length ? 2 : 0) + block.length;
        if (length + added > maxChars) break;
        kept.push(block);
        length += added;
    }
    // The very first paragraph is already too long: cut inside it rather
    // than show nothing.
    if (!kept.length && blocks.length) kept.push(cutBlock(blocks[0], maxChars));
    return { content: kept.join('\n\n'), truncated: kept.length < blocks.length || kept[0] !== blocks[0] };
};

// Book (lean, published) → the share-link response.
const buildSharePreview = (book) => {
    const previewChapters = getSharePreviewChapters();
    const chapters = (book.chapters || []).map((chapter, index) => {
        // kind: so front/back matter isn't numbered in the contents.
        const base = { _id: chapter._id, title: chapter.title || '', kind: chapter.kind || 'chapter' };
        if (index >= previewChapters) return { ...base, locked: true };
        const { content, truncated } = previewExcerpt(chapter.content || '');
        return { ...base, locked: false, content, isExcerpt: truncated };
    });
    return {
        _id: book._id,
        title: book.title,
        subtitle: book.subtitle,
        author: book.author,
        coverImage: book.coverImage,
        coverDesign: book.coverDesign,
        isPreview: true,
        totalChapters: chapters.length,
        previewChapters: Math.min(previewChapters, chapters.length),
        chapters,
    };
};

module.exports = { DEFAULT_PREVIEW_CHAPTERS, PREVIEW_CHARS, getSharePreviewChapters, previewExcerpt, buildSharePreview };
