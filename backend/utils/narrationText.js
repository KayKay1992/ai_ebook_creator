const crypto = require('crypto');

// Turns chapter markdown into the plain text that gets narrated, and splits
// it into TTS-sized chunks.
//
// What's dropped: code blocks, images, raw HTML tags, URLs, footnote
// markers, table separator rows, horizontal rules, markdown punctuation.
// What's kept: link text (not the URL), inline code text, list items and
// table cells (as short sentences), headings (as their own sentence).
// Headings, list items and table rows get a full stop if they don't end in
// punctuation, so the narrator pauses instead of running them together.

// Gemini TTS takes up to 8,192 input tokens and returns at most 16,384
// audio tokens (~11 minutes at 25 tokens/s), checked against the live API.
// 1,800 characters is ~2 minutes of speech: far inside both limits, and
// short enough that a retry after a failure redoes little work.
const DEFAULT_CHUNK_CHARS = 1800;

// Measured from real output: 253 characters → 18.4 s, i.e. ~14 characters
// per second of narration. Used only for estimates shown to the admin.
const ESTIMATED_CHARS_PER_SECOND = 14;

const ENDS_WITH_PUNCTUATION = /[.!?…:;]["'”’)\]]*$/;
const punctuate = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return '';
    return ENDS_WITH_PUNCTUATION.test(trimmed) ? trimmed : `${trimmed}.`;
};

const decodeEntities = (text) =>
    text
        .replace(/&nbsp;/g, ' ')
        .replace(/&quot;/g, '"')
        .replace(/&(#39|apos);/g, "'")
        .replace(/&mdash;/g, '—')
        .replace(/&ndash;/g, '–')
        .replace(/&hellip;/g, '…')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#(\d+);/g, (_, code) => {
            const n = Number(code);
            return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ' ';
        })
        .replace(/&amp;/g, '&'); // last, so "&amp;lt;" becomes "&lt;" not "<"

// Inline markdown → plain text. Also used for chapter titles.
const cleanInline = (text) =>
    text
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images
        .replace(/!\[[^\]]*\]\[[^\]]*\]/g, '') // reference images
        .replace(/\[\^[^\]]+\]/g, '') // footnote markers
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // [text](url) → text
        .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1') // [text][ref] → text
        .replace(/<(?:https?:\/\/|mailto:)[^>]+>/gi, '') // <autolinks>
        .replace(/\b(?:https?:\/\/|www\.)[^\s)]+/gi, '') // bare URLs
        .replace(/`+([^`]+?)`+/g, '$1') // inline code
        .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2') // bold
        .replace(/\*(?=\S)([^*]*?\S)\*/g, '$1') // *italic*
        .replace(/(^|[^\w])_(?=\S)([^_]*?\S)_(?=[^\w]|$)/g, '$1$2') // _italic_ (not snake_case)
        .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1') // strikethrough
        .replace(/[ \t]+/g, ' ')
        .replace(/ +([,.;:!?])/g, '$1') // "see https://… ." → "see."
        .trim();

const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const SETEXT_UNDERLINE = /^\s{0,3}=+\s*$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const LIST_ITEM = /^\s*(?:[-*+]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/;
const BLOCKQUOTE = /^\s{0,3}(?:>\s?)+/;
const REF_DEFINITION = /^\s{0,3}\[[^\]]+\]:\s*\S+/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/;
const isTableRow = (line) => /^\s*\|.*\|\s*$/.test(line) || (line.match(/\|/g) || []).length >= 2;

const markdownToNarration = (markdown = '') => {
    let text = String(markdown || '').replace(/\r\n?/g, '\n');

    // Fenced code blocks (closed, then any unclosed one running to the end).
    text = text.replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[^\n]*$/gm, '');
    text = text.replace(/^ {0,3}(`{3,}|~{3,})[\s\S]*$/m, '');

    // HTML: comments and script/style content go entirely; block-level
    // closing tags become paragraph breaks; every other tag is dropped.
    text = text
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|li|h[1-6]|blockquote|tr|section|article)>/gi, '\n\n')
        .replace(/<\/?[a-zA-Z][^>]*>/g, '');

    const out = [];
    for (const rawLine of text.split('\n')) {
        let line = rawLine.replace(BLOCKQUOTE, '');
        if (!line.trim()) {
            out.push('');
            continue;
        }
        if (REF_DEFINITION.test(line) || HR.test(line) || SETEXT_UNDERLINE.test(line) || TABLE_SEPARATOR.test(line)) {
            out.push('');
            continue;
        }

        const heading = HEADING.exec(line);
        if (heading) {
            // Its own paragraph, so it's never glued onto the next sentence.
            out.push('', punctuate(cleanInline(heading[1])), '');
            continue;
        }

        if (isTableRow(line)) {
            const cells = line
                .split('|')
                .map((cell) => cleanInline(cell))
                .filter(Boolean);
            out.push(punctuate(cells.join(', ')));
            continue;
        }

        const item = LIST_ITEM.exec(line);
        if (item) {
            out.push(punctuate(cleanInline(item[1])));
            continue;
        }

        line = cleanInline(line);
        if (line) out.push(line);
    }

    return decodeEntities(out.join('\n'))
        .split(/\n\s*\n/)
        .map((paragraph) =>
            paragraph
                .split('\n')
                .map((l) => l.trim())
                .filter(Boolean)
                .join(' ')
                .replace(/\s+/g, ' ')
                .trim()
        )
        // Drop paragraphs left with nothing to say (e.g. only punctuation).
        .filter((paragraph) => /[\p{L}\p{N}]/u.test(paragraph))
        .join('\n\n');
};

// The full narration for one chapter: its title (read first, followed by a
// pause added at the audio level) then the body. `text` is what's hashed
// and counted. An empty `body` means there's nothing to narrate.
const chapterNarration = (chapter = {}) => {
    const title = punctuate(decodeEntities(cleanInline(String(chapter.title || ''))));
    const body = markdownToNarration(chapter.content || '');
    return { title, body, text: body ? `${title}\n\n${body}` : '' };
};

const hashText = (text) => crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');

// Common abbreviations whose trailing full stop doesn't end a sentence.
const ABBREVIATIONS = new Set([
    'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'mt', 'vs', 'etc', 'e.g', 'i.e',
    'no', 'fig', 'vol', 'ch', 'approx', 'inc', 'ltd', 'co', 'gen', 'gov', 'rev', 'hon', 'sgt', 'capt',
]);

// Splits one paragraph into sentences. Each sentence keeps its own
// punctuation and closing quotes.
const splitSentences = (paragraph) => {
    const sentences = [];
    const boundary = /[.!?…]+["'”’)\]]*(?=\s+|$)/g;
    let start = 0;
    let match;
    while ((match = boundary.exec(paragraph))) {
        const end = match.index + match[0].length;
        // Followed by a lowercase word ('"Wow!" she said', 'wait... and'):
        // the sentence carries on.
        if (/^\s+\p{Ll}/u.test(paragraph.slice(end))) continue;
        if (match[0].startsWith('.') && match[0].length === 1) {
            const wordBefore = /([\p{L}.]+)$/u.exec(paragraph.slice(start, match.index));
            const word = (wordBefore?.[1] || '').toLowerCase();
            // "Dr." / "e.g." / an initial like "J." aren't sentence ends.
            if (ABBREVIATIONS.has(word) || /^\p{L}$/u.test(word)) continue;
        }
        const sentence = paragraph.slice(start, end).trim();
        if (sentence) sentences.push(sentence);
        start = end;
    }
    const rest = paragraph.slice(start).trim();
    if (rest) sentences.push(rest);
    return sentences;
};

// Packs pieces (in order) into strings no longer than maxChars.
const pack = (pieces, maxChars, separator = ' ') => {
    const out = [];
    let current = '';
    for (const piece of pieces) {
        if (!current) current = piece;
        else if (current.length + separator.length + piece.length <= maxChars) current += separator + piece;
        else {
            out.push(current);
            current = piece;
        }
    }
    if (current) out.push(current);
    return out;
};

// Last resort for a single sentence longer than a whole chunk (very rare in
// prose): split at clause punctuation, then between words. Never inside a word.
const splitOversizedSentence = (sentence, maxChars) => {
    const clauses = sentence.split(/(?<=[,;:—–])\s+/);
    const pieces = [];
    for (const clause of clauses) {
        if (clause.length <= maxChars) pieces.push(clause);
        else {
            for (const word of clause.split(/\s+/)) {
                if (word.length <= maxChars) pieces.push(word);
                else for (let i = 0; i < word.length; i += maxChars) pieces.push(word.slice(i, i + maxChars));
            }
        }
    }
    return pack(pieces, maxChars);
};

// Splits narration text into chunks of at most maxChars. Boundaries fall
// between paragraphs where possible, otherwise between sentences; a chunk
// never ends mid-sentence unless that one sentence is itself longer than
// maxChars. Paragraph breaks inside a chunk are kept, so the model still
// pauses there.
const splitIntoChunks = (text, maxChars = DEFAULT_CHUNK_CHARS) => {
    const units = []; // { text, startsParagraph }
    for (const paragraph of String(text || '').split(/\n\s*\n/)) {
        const p = paragraph.trim();
        if (!p) continue;
        const pieces =
            p.length <= maxChars
                ? [p]
                : splitSentences(p).flatMap((s) => (s.length <= maxChars ? [s] : splitOversizedSentence(s, maxChars)));
        pieces.forEach((piece, i) => units.push({ text: piece, startsParagraph: i === 0 }));
    }

    const chunks = [];
    let current = '';
    for (const unit of units) {
        const separator = unit.startsParagraph ? '\n\n' : ' ';
        if (!current) current = unit.text;
        else if (current.length + separator.length + unit.text.length <= maxChars) current += separator + unit.text;
        else {
            chunks.push(current);
            current = unit.text;
        }
    }
    if (current) chunks.push(current);
    return chunks;
};

const estimateDurationSec = (chars) => Math.round(chars / ESTIMATED_CHARS_PER_SECOND);

module.exports = {
    DEFAULT_CHUNK_CHARS,
    ESTIMATED_CHARS_PER_SECOND,
    markdownToNarration,
    chapterNarration,
    hashText,
    splitSentences,
    splitIntoChunks,
    estimateDurationSec,
};
