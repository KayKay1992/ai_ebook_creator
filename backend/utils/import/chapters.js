// Turns a flat list of blocks (htmlToMarkdown.js) into chapters:
//   - split at the highest heading level the book uses; if that level only
//     appears once (usually the book title) and the next level appears
//     several times, split at the next level instead;
//   - with no headings at all, lines like "Chapter 3" / "Part II" count as
//     chapter headings;
//   - text before the first chapter heading becomes "Introduction" (unless
//     it's only the title);
//   - no headings and no chapter lines: one chapter.
// Chapter content is Markdown (paragraphs separated by blank lines).

const CHAPTER_LINE = /^(chapter|part|book|prologue|epilogue|introduction|preface|foreword|afterword|conclusion)\b[\s.:\-–—]*([0-9]+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)?\b/i;

const plain = (markdown) =>
    String(markdown)
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[\\*_`>#~-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

const wordCount = (markdown) => {
    const text = plain(markdown);
    return text ? text.split(' ').length : 0;
};

const looksLikeChapterLine = (block) => {
    if (block.kind !== 'block') return false;
    const text = plain(block.markdown);
    return text.length > 0 && text.length <= 80 && CHAPTER_LINE.test(text) && !/[.!?]\s+\S/.test(text);
};

const splitLevel = (blocks) => {
    const counts = {};
    for (const b of blocks) if (b.kind === 'heading') counts[b.level] = (counts[b.level] || 0) + 1;
    const levels = Object.keys(counts).map(Number).sort((a, b) => a - b);
    if (!levels.length) return null;
    const [top, next] = levels;
    if (counts[top] === 1 && next && counts[next] >= 2) return next;
    return top;
};

const makeChapter = (title, contentBlocks) => {
    const content = contentBlocks.map((b) => b.markdown).join('\n\n').trim();
    return { title: String(title || '').trim().slice(0, 300) || 'Untitled chapter', content, wordCount: wordCount(content) };
};

// → { chapters: [{ title, content, wordCount }], titleCandidate }
const splitIntoChapters = (blocks, { defaultTitle = 'Chapter 1' } = {}) => {
    let working = blocks.slice();
    let level = splitLevel(working);
    let titleCandidate = '';
    if (level === null) {
        // Promote "Chapter 3"-style lines to headings.
        if (working.some(looksLikeChapterLine)) {
            working = working.map((b) => (looksLikeChapterLine(b) ? { kind: 'heading', level: 1, markdown: `# ${b.markdown}`, text: plain(b.markdown) } : b));
            level = 1;
        }
    }
    if (level === null) {
        const only = makeChapter(defaultTitle, working);
        return { chapters: only.content ? [only] : [], titleCandidate };
    }
    // A single heading above the split level is the book's title.
    const above = working.filter((b) => b.kind === 'heading' && b.level < level);
    if (above.length === 1) titleCandidate = above[0].text;

    const chapters = [];
    let current = null;
    const intro = [];
    for (const block of working) {
        if (block.kind === 'heading' && block.level === level) {
            if (current) chapters.push(makeChapter(current.title, current.blocks));
            current = { title: block.text, blocks: [] };
        } else if (block.kind === 'heading' && block.level < level) {
            continue; // the title heading
        } else if (current) {
            current.blocks.push(block);
        } else {
            intro.push(block);
        }
    }
    if (current) chapters.push(makeChapter(current.title, current.blocks));
    const introChapter = makeChapter('Introduction', intro);
    if (introChapter.wordCount >= 5) chapters.unshift(introChapter);
    return { chapters: chapters.filter((c) => c.content || c.title), titleCandidate };
};

module.exports = { splitIntoChapters, wordCount, plain, looksLikeChapterLine, CHAPTER_LINE };
