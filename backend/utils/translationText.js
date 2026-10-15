// Splits chapter markdown into paragraph-level blocks for translation and
// puts the translated chapter back together, block for block, so the
// translation keeps the original's structure (headings, lists, paragraph
// breaks) and stays aligned with it.
//
// A chapter becomes a list of "items": the title, then each block. Blocks
// are separated by blank lines, except that a fenced code block (``` or ~~~)
// is one block even if it contains blank lines. Code blocks and blocks with
// no words (horizontal rules, image-only lines) are kept verbatim and never
// sent to Gemini.

const DEFAULT_CHUNK_CHARS = 6000;
const getChunkChars = () => {
    const n = parseInt(process.env.TRANSLATION_CHUNK_CHARS, 10);
    return Number.isFinite(n) ? Math.min(Math.max(n, 1000), 20000) : DEFAULT_CHUNK_CHARS;
};

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

const splitBlocks = (markdown = '') => {
    const lines = String(markdown).replace(/\r\n?/g, '\n').split('\n');
    const blocks = [];
    let current = [];
    let fence = null;
    const flush = () => {
        const text = current.join('\n').replace(/^\n+|\n+$/g, '');
        if (text.trim()) blocks.push(text);
        current = [];
    };
    for (const line of lines) {
        const fenceMatch = FENCE.exec(line);
        if (fence) {
            current.push(line);
            if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) {
                fence = null;
                flush();
            }
            continue;
        }
        if (fenceMatch) {
            flush();
            fence = fenceMatch[1];
            current.push(line);
            continue;
        }
        if (!line.trim()) flush();
        else current.push(line);
    }
    flush();
    return blocks;
};

const isCodeBlock = (block) => FENCE.test(block);

// Worth translating: has letters once images, links' URLs and markdown
// punctuation are set aside, and isn't code.
const isTranslatable = (text) => {
    if (isCodeBlock(text)) return false;
    const words = String(text)
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\]\([^)]*\)/g, ']');
    return /\p{L}/u.test(words);
};

// { items, translatable } for a chapter: items[0] is the title.
const chapterItems = (chapter = {}) => {
    const items = [String(chapter.title || '').trim(), ...splitBlocks(chapter.content || '')];
    return { items, translatable: items.map((item) => Boolean(item) && isTranslatable(item)) };
};

// Groups the translatable item indexes, in order, into chunks of at most
// maxChars of source text. A single item longer than that is its own chunk.
const chunkItemIndexes = (items, translatable, maxChars = getChunkChars()) => {
    const chunks = [];
    let current = [];
    let size = 0;
    items.forEach((item, index) => {
        if (!translatable[index]) return;
        if (current.length && size + item.length > maxChars) {
            chunks.push(current);
            current = [];
            size = 0;
        }
        current.push(index);
        size += item.length;
    });
    if (current.length) chunks.push(current);
    return chunks;
};

// Number tokens that must survive translation unchanged: naira amounts
// (₦5,000 / N5,000 / NGN 5,000) and any other figures. Compared as a
// multiset, so a translation may reorder them but not change or drop one.
// Commas only count as thousands separators ("12, then" is the number 12).
const NUMBER_TOKEN = /(?:₦|NGN\s?|\bN(?=\d))?\d+(?:,\d{3})*(?:\.\d+)?/g;
const normaliseNumber = (token) => token.replace(/\s+/g, '').replace(/^NGN/, '₦').replace(/^N(?=\d)/, '₦');
const numberTokens = (text) => (String(text).match(NUMBER_TOKEN) || []).map(normaliseNumber);

// Source numbers missing from the translation (empty = all present).
const missingNumbers = (source, translated) => {
    const available = new Map();
    for (const token of numberTokens(translated)) available.set(token, (available.get(token) || 0) + 1);
    const missing = [];
    for (const token of numberTokens(source)) {
        const left = available.get(token) || 0;
        if (left > 0) available.set(token, left - 1);
        else missing.push(token);
    }
    return missing;
};

// Markdown structure markers at the start of a block that must be kept:
// heading hashes, list bullets/numbers, blockquote marks. If the model
// dropped one, put it back (deterministic, no extra request).
const LEADING_MARKER = /^(\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d{1,9}[.)]\s+))/;
const restoreLeadingMarker = (source, translated) => {
    const marker = LEADING_MARKER.exec(source)?.[1];
    const text = String(translated).trim();
    if (!marker || LEADING_MARKER.test(text)) return text;
    return `${marker}${text}`;
};

// Translated items → { title, content }. Untranslated items (code, rules,
// images) are copied from the source.
const assembleChapter = (items, translatedByIndex) => {
    const out = items.map((item, index) => translatedByIndex.get(index) ?? item);
    return { title: out[0], content: out.slice(1).join('\n\n') };
};

module.exports = {
    DEFAULT_CHUNK_CHARS,
    getChunkChars,
    splitBlocks,
    isTranslatable,
    chapterItems,
    chunkItemIndexes,
    numberTokens,
    missingNumbers,
    restoreLeadingMarker,
    assembleChapter,
};
