const { parseChapterLine, namedSection, isContentsTitle, tidyTitle, normTitle, lineText } = require('./sectionNames');

// Turns the flat list of blocks every format produces (htmlToMarkdown.js,
// pdfLayout.js) into the book's sections. Strategies, tried in order; the
// first that finds at least two sections wins:
//   1. real structure: split markers from an EPUB's table of contents, or
//      real headings (.docx Heading 1, or Heading 2 when there is no
//      Heading 1 / the only Heading 1 is the book title; Markdown #).
//   2. patterns on standalone short lines: "Chapter 1", "CHAPTER ONE",
//      "Chapter 3: Title", sequential "1. Title" lines, "Part I" dividers,
//      and named sections (Preface, Epilogue, About the author …).
//   3. a printed table of contents: the lines it lists are found in the
//      text, in order.
// PDFs have no real headings, only bigger text (pdfLayout.js marks those
// headings `guessed`), so for a PDF the printed contents go first, then
// patterns, then the big-text headings.
// A printed table of contents near the start is always removed from the
// text (and used to check the result). Front and back matter keep their own
// names and get no chapter number (`kind` 'front' / 'back'); text before
// the first section becomes "Front matter" only if it has real text.
// One very long chapter is never accepted silently (`needsSplit`).
//
// Blocks: { kind: 'heading', level, markdown, text } | { kind: 'block',
// markdown } | { kind: 'image', key, markdown } | { kind: 'split', title }
// (EPUB table-of-contents entries). Chapter content is Markdown.

const MIN_FRONT_MATTER_WORDS = 20;
const MIN_PART_TEXT_WORDS = 30;
const DEFAULT_LONG_CHAPTER_WORDS = 8000;

const plain = (markdown) =>
    String(markdown)
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\\(.)/g, '$1')
        .replace(/^\s*>\s?/gm, ' ')
        .replace(/^\s*#{1,6}\s+/gm, ' ')
        .replace(/^\s*(?:[-+]|\d+[.)])\s+/gm, ' ')
        .replace(/[*_`~]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

const wordCount = (markdown) => {
    const text = plain(markdown);
    return text ? text.split(' ').length : 0;
};
const IMAGE_MD = /!\[[^\]]*\]\([^)]*\)/g;
const imageCount = (markdown) => (String(markdown).match(IMAGE_MD) || []).length;

const textOf = (block) => (block.kind === 'heading' ? lineText(block.text || block.markdown) : lineText(block.markdown));
// A heading, or a one-line paragraph short enough to be a title.
const isStandalone = (block) => {
    if (block.kind === 'heading') return true;
    if (block.kind !== 'block' || block.markdown.includes('\n')) return false;
    if (/^\s*(?:>|```|\|)/.test(block.markdown)) return false;
    const text = textOf(block);
    return text.length > 0 && text.length <= 120;
};
// A short line that can be a chapter's title (after a bare "Chapter 3").
const looksLikeTitle = (block) => {
    if (!isStandalone(block)) return false;
    const text = textOf(block);
    return text.length <= 90 && !/[.,;:]$/.test(text) && !/[.!?]\s+\S/.test(text) && /^["“‘'(\p{Lu}\d]/u.test(text);
};

// ---------- printed table of contents ----------
const PAGE_TAIL = /(?:\s*[.·…_]{2,}\s*|\s+|\t)(\d{1,4}|[ivxlc]{1,7})$/i;
const tocLinesOf = (block) => {
    if (block.kind !== 'block' && block.kind !== 'heading') return null;
    const lines = block.markdown.split('\n').map((l) => l.trim()).filter(Boolean);
    const isList = lines.every((l) => /^(?:[-+]|\d+[.)])\s+/.test(l));
    if (lines.length > 1 && !isList) return null;
    return lines.map((l) => {
        const text = lineText(isList ? l.replace(/^(?:[-+]|\d+[.)])\s+/, '') : l);
        const page = PAGE_TAIL.exec(text);
        const title = (page ? text.slice(0, page.index) : text).replace(/[\s.·…_]+$/, '').trim();
        return { title, hasPage: Boolean(page) };
    });
};

// → { start, end, entries: [{ title }] } (blocks start..end-1 are the
// contents), or null.
const findToc = (blocks) => {
    const limit = Math.min(blocks.length, Math.max(60, Math.ceil(blocks.length * 0.3)));
    for (let i = 0; i < limit; i++) {
        if (!isStandalone(blocks[i]) || !isContentsTitle(textOf(blocks[i]))) continue;
        const entries = [];
        let numbered = null;
        let j = i + 1;
        for (; j < blocks.length; j++) {
            const block = blocks[j];
            if (block.kind === 'heading' && entries.length) break;
            const lines = tocLinesOf(block);
            if (!lines || !lines.length) break;
            const valid = lines.every((l) => l.title.length > 0 && l.title.length <= 120 && !/[;,]$/.test(l.title) && !/[.!?]\s+\S/.test(l.title));
            if (!valid) break;
            if (numbered === null && lines[0].hasPage) numbered = true;
            if (numbered === null) numbered = false;
            if (numbered && !lines.every((l) => l.hasPage)) break;
            // Without page numbers, the contents end where the first listed
            // title appears again (the book itself starts).
            if (!numbered && entries.some((e) => lines.some((l) => normTitle(l.title) === normTitle(e.title)))) break;
            if (!numbered && lines.some((l) => /[.]$/.test(l.title))) break;
            entries.push(...lines.map((l) => ({ title: l.title })));
        }
        if (entries.length >= (numbered ? 2 : 3)) return { start: i, end: j, entries };
    }
    return null;
};

const titleMatches = (candidate, entry) => {
    const c = normTitle(candidate);
    const e = normTitle(entry);
    if (!c || !e) return false;
    if (c === e) return true;
    // "Chapter 1: The Market" vs "The Market", or the other way round.
    if (e.length >= 4 && (c.endsWith(` ${e}`) || c.startsWith(`${e} `)) && c.length <= e.length + 25) return true;
    if (c.length >= 4 && (e.startsWith(`${c} `) || e.endsWith(` ${c}`)) && e.length <= c.length + 40 && (parseChapterLine(candidate) || namedSection(candidate))) return true;
    return false;
};

// Each entry, in order, at the first standalone line after the previous
// one that matches it. → { splits, missing }
const matchToc = (blocks, entries) => {
    const splits = [];
    const missing = [];
    let pos = 0;
    for (const entry of entries) {
        let found = -1;
        for (let k = pos; k < blocks.length; k++) {
            if (isStandalone(blocks[k]) && titleMatches(textOf(blocks[k]), entry.title)) {
                found = k;
                break;
            }
        }
        if (found === -1) {
            missing.push(entry.title);
            continue;
        }
        splits.push({ index: found, title: entry.title, sourceText: textOf(blocks[found]) });
        pos = found + 1;
    }
    return { splits, missing };
};

// ---------- headings ----------
const headingCounts = (blocks) => {
    const counts = {};
    for (const b of blocks) if (b.kind === 'heading') counts[b.level] = (counts[b.level] || 0) + 1;
    return counts;
};
const splitLevel = (blocks, { guessed = false } = {}) => {
    const counts = headingCounts(blocks);
    const levels = Object.keys(counts).map(Number).sort((a, b) => a - b);
    if (!levels.length) return null;
    // Big text in a PDF: the biggest size used for at least two headings
    // (the title page's one-off giant type is not a chapter).
    if (guessed) return levels.find((l) => counts[l] >= 2) ?? null;
    const [top, next] = levels;
    // The only top-level heading is the book's title.
    if (counts[top] === 1 && next && counts[next] >= 2) return next;
    // Top-level headings are all "Part …": chapters are one level down.
    const tops = blocks.filter((b) => b.kind === 'heading' && b.level === top);
    if (next && counts[next] >= 2 && tops.every((b) => parseChapterLine(textOf(b))?.kind === 'part')) return next;
    return top;
};

const headingSplits = (blocks, { guessed = false } = {}) => {
    const level = splitLevel(blocks, { guessed });
    if (level === null) return null;
    const splits = [];
    blocks.forEach((b, index) => {
        if (b.kind !== 'heading') return;
        const parsed = parseChapterLine(textOf(b));
        if (b.level === level) splits.push({ index, title: textOf(b), part: parsed?.kind === 'part' });
        else if (b.level < level && parsed?.kind === 'part') splits.push({ index, title: textOf(b), part: true });
    });
    return splits;
};

// ---------- patterns ----------
const NUMBERED_LINE = /^(\d{1,3})([.)]?)\s+(\S.{0,90})$/;
const MIN_WORDS_BETWEEN_NUMBERED = 100;

const patternSplits = (blocks) => {
    const splits = [];
    const named = [];
    const numbered = [];
    blocks.forEach((b, index) => {
        if (!isStandalone(b)) {
            // "CHAPTER ONE  \nThe Market" (a line break, one paragraph).
            const lines = b.kind === 'block' ? b.markdown.split('\n').map((l) => lineText(l)).filter(Boolean) : [];
            const p = lines.length === 2 && lines[1].length <= 90 ? parseChapterLine(lines[0]) : null;
            if (p && !p.title) splits.push({ index, title: `${lines[0]}: ${lines[1]}`, part: p.kind === 'part' });
            return;
        }
        const text = textOf(b);
        const p = parseChapterLine(text);
        if (p) return splits.push({ index, title: text, part: p.kind === 'part' });
        const n = namedSection(text);
        if (n) return named.push({ index, title: text, named: true });
        const m = NUMBERED_LINE.exec(text);
        if (m && /^["“‘'\p{Lu}]/u.test(m[3]) && !/[.,;:]$/.test(m[3]) && !/[.!?]\s+\S/.test(m[3])) numbered.push({ index, number: Number(m[1]), sep: m[2], title: text });
    });
    // "1. Title" lines count only as a clean sequence 1, 2, 3 … with the
    // same punctuation, each followed by real text.
    if (splits.filter((s) => !s.part).length < 2 && numbered.length >= 3) {
        const run = [];
        for (const c of numbered) {
            if (c.number !== run.length + 1 || (run.length && c.sep !== run[0].sep)) continue;
            if (run.length) {
                const between = blocks.slice(run[run.length - 1].index + 1, c.index).reduce((sum, b) => sum + wordCount(b.markdown), 0);
                if (between < MIN_WORDS_BETWEEN_NUMBERED) continue;
            }
            run.push(c);
        }
        if (run.length >= 3) splits.push(...run.map((c) => ({ index: c.index, title: c.title })));
    }
    splits.sort((a, b) => a.index - b.index);
    return { splits, named };
};

// Named sections (Preface, Epilogue …) written as plain lines, outside the
// chapters: before the first one or after the last one. Inside a chapter, a
// line that says "Conclusion" is usually just a subheading.
const addNamedOutside = (splits, named) => {
    if (!named.length) return splits;
    const chapters = splits.filter((s) => !s.part);
    if (!chapters.length) return [...splits, ...named].sort((a, b) => a.index - b.index);
    const first = chapters[0].index;
    const last = chapters[chapters.length - 1].index;
    const taken = new Set(splits.map((s) => s.index));
    const extra = named.filter((n) => !taken.has(n.index) && (n.index < first || n.index > last));
    return [...splits, ...extra].sort((a, b) => a.index - b.index);
};
const namedLines = (blocks) =>
    blocks.flatMap((b, index) => (isStandalone(b) && namedSection(textOf(b)) ? [{ index, title: textOf(b), named: true }] : []));

// ---------- building the sections ----------
const contentOf = (blocks, { bookTitle }) => {
    const out = [];
    for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        if (b.kind === 'split') continue;
        if (b.kind === 'heading') {
            // A half-title page: the book's title on its own.
            const next = blocks[i + 1];
            if (bookTitle && normTitle(textOf(b)) === normTitle(bookTitle) && (!next || next.kind === 'heading')) continue;
            // Chapter titles are shown above the text: headings inside a
            // chapter start at ##.
            out.push(b.level <= 1 ? b.markdown.replace(/^#\s/, '## ') : b.markdown);
            continue;
        }
        out.push(b.markdown);
    }
    return out.join('\n\n').trim();
};

const makeSection = (title, kind, content) => ({
    title: String(title || '').trim().slice(0, 300) || 'Untitled chapter',
    kind,
    content,
    wordCount: wordCount(content),
    imageCount: imageCount(content),
});

const buildSections = (blocks, splits, { bookTitle, notes }) => {
    const sections = [];
    const lead = blocks.slice(0, splits.length ? splits[0].index : blocks.length);
    const leadContent = contentOf(lead, { bookTitle });
    const leadWords = wordCount(leadContent);
    if (leadWords >= MIN_FRONT_MATTER_WORDS || (leadWords > 0 && !splits.length)) {
        sections.push(makeSection(splits.length ? 'Front matter' : 'Chapter 1', splits.length ? 'front' : 'chapter', leadContent));
    } else if (leadWords > 0 || imageCount(leadContent) > 0) {
        notes.push(`Left out the start of the file before the first chapter (title page or blank pages, ${leadWords} word${leadWords === 1 ? '' : 's'}).`);
    }

    let pendingParts = [];
    splits.forEach((split, n) => {
        const end = n + 1 < splits.length ? splits[n + 1].index : blocks.length;
        let from = split.index + 1;
        let title = split.title;
        // "Chapter 3" followed by its title on the next line.
        const parsed = parseChapterLine(lineText(title));
        if (parsed && !parsed.title && from < end && looksLikeTitle(blocks[from]) && !parseChapterLine(textOf(blocks[from])) && !namedSection(textOf(blocks[from]))) {
            title = `${title}: ${textOf(blocks[from])}`;
            from++;
        }
        const body = blocks.slice(from, end);
        // Drop a first heading that only repeats the title.
        if (body[0]?.kind === 'heading' && normTitle(textOf(body[0])) === normTitle(title)) body.shift();
        let content = contentOf(body, { bookTitle });
        title = tidyTitle(lineText(title));
        if (isContentsTitle(title)) {
            notes.push(`Left out "${title}" (the book's table of contents).`);
            return;
        }
        if (split.part && wordCount(content) < MIN_PART_TEXT_WORDS) {
            // A divider page: kept as a line at the top of the next chapter.
            pendingParts.push(title);
            if (content.trim()) pendingParts.push(content.trim());
            return;
        }
        if (pendingParts.length) {
            content = [...pendingParts.map((p, i) => (i === 0 ? `*${p}*` : p)), content].filter(Boolean).join('\n\n');
            pendingParts = [];
        }
        const kind = split.part ? 'part' : split.named || namedSection(title) ? 'named' : split.back ? 'back' : 'chapter';
        if (!content.trim() && kind === 'chapter' && !title) return;
        sections.push(makeSection(title, kind, content));
    });
    if (pendingParts.length && sections.length) {
        const last = sections[sections.length - 1];
        Object.assign(last, makeSection(last.title, last.kind, [last.content, `*${pendingParts[0]}*`, ...pendingParts.slice(1)].join('\n\n')));
    }
    // Named sections: front matter before the first chapter, back matter after.
    const firstChapter = sections.findIndex((s) => s.kind === 'chapter');
    sections.forEach((s, i) => {
        if (s.kind === 'named') s.kind = firstChapter === -1 ? (namedSection(s.title)?.side || 'front') : i < firstChapter ? 'front' : 'back';
    });
    return sections;
};

const enough = (splits) => splits && splits.length >= 2;

// → { chapters: [{ title, kind, content, wordCount, imageCount }],
//     titleCandidate, method, notes: [], warnings: [], needsSplit }
const splitIntoChapters = (inputBlocks, { bookTitle = '', guessedHeadings = false, longChapterWords = DEFAULT_LONG_CHAPTER_WORDS } = {}) => {
    const notes = [];
    const warnings = [];
    let blocks = inputBlocks.slice();

    // The book's own title: a single top-level heading above the chapters.
    let titleCandidate = '';
    const counts = headingCounts(blocks);
    const levels = Object.keys(counts).map(Number).sort((a, b) => a - b);
    if (levels.length && counts[levels[0]] === 1) {
        const top = blocks.find((b) => b.kind === 'heading' && b.level === levels[0]);
        if (top && blocks.indexOf(top) < Math.max(20, blocks.length * 0.1) && !parseChapterLine(textOf(top)) && !namedSection(textOf(top))) titleCandidate = textOf(top);
    }
    const knownTitle = bookTitle || titleCandidate;

    // Printed table of contents: remember it, take it out of the text.
    const toc = findToc(blocks);
    if (toc) {
        blocks = [...blocks.slice(0, toc.start), ...blocks.slice(toc.end)];
        notes.push(`Left out the printed table of contents (${toc.entries.length} entries); it was used to check the chapters.`);
    }

    let method = null;
    let splits = null;
    let tocMissing = [];
    const tryToc = () => {
        if (!toc) return null;
        const { splits: found, missing } = matchToc(blocks, toc.entries);
        if (found.length < 2 || found.length < toc.entries.length * 0.5) return null;
        tocMissing = missing;
        // After the last listed chapter, a heading in the chapters' own
        // style starts back matter the contents don't list (an "About the
        // author" page, the publisher's other books).
        const levels = found.map((s) => blocks[s.index]).filter((b) => b.kind === 'heading').map((b) => b.level);
        const level = levels.sort((a, b) => levels.filter((l) => l === b).length - levels.filter((l) => l === a).length)[0];
        const lastIndex = found[found.length - 1].index;
        // Everything from there on is one section (split it on the review
        // screen if needed). In a PDF any heading in bigger type counts.
        const extraIndex = level === undefined ? -1 : blocks.findIndex((b, index) => index > lastIndex && b.kind === 'heading' && !b.sub && (b.level <= level || b.guessed) && normTitle(textOf(b)) !== normTitle(knownTitle));
        const extra = extraIndex === -1 ? [] : [{ index: extraIndex, title: textOf(blocks[extraIndex]), back: true }];
        return addNamedOutside([...found, ...extra], namedLines(blocks));
    };
    const tryPatterns = () => {
        const { splits: found, named } = patternSplits(blocks);
        const all = addNamedOutside(found, named);
        return all.filter((s) => !s.part).length >= 2 ? all : null;
    };
    const tryHeadings = (guessed) => {
        const found = headingSplits(blocks, { guessed });
        return found && found.filter((s) => !s.part).length >= 2 ? addNamedOutside(found, namedLines(blocks)) : null;
    };
    const markers = blocks.flatMap((b, index) => (b.kind === 'split' ? [{ index, title: b.title, part: Boolean(b.part || parseChapterLine(b.title)?.kind === 'part') }] : []));

    const attempts = [];
    if (markers.length) attempts.push(['contents', () => (markers.length >= 2 ? markers : null)]);
    if (guessedHeadings) attempts.push(['contents', tryToc], ['patterns', tryPatterns], ['headings', () => tryHeadings(true)]);
    else attempts.push(['headings', () => tryHeadings(false)], ['patterns', tryPatterns], ['contents', tryToc]);
    for (const [name, attempt] of attempts) {
        const result = attempt();
        if (enough(result)) {
            method = name;
            splits = result;
            break;
        }
    }
    // A single EPUB marker, or nothing found: one section (still split from
    // any front matter before it).
    if (!splits) splits = markers.length ? markers : [];

    const chapters = buildSections(blocks, splits, { bookTitle: knownTitle, notes });

    // The printed contents as a check.
    if (toc) {
        if (method === 'contents' && tocMissing.length) {
            warnings.push(`The table of contents lists ${tocMissing.length} title${tocMissing.length === 1 ? '' : 's'} not found in the text: ${tocMissing.slice(0, 5).map((t) => `"${t}"`).join(', ')}${tocMissing.length > 5 ? '…' : ''}.`);
        } else if (method !== 'contents') {
            const unmatched = toc.entries.filter((e) => !chapters.some((c) => titleMatches(c.title, e.title)));
            if (unmatched.length) warnings.push(`${unmatched.length} title${unmatched.length === 1 ? '' : 's'} in the table of contents ${unmatched.length === 1 ? "doesn't" : "don't"} match a chapter: ${unmatched.slice(0, 5).map((e) => `"${e.title}"`).join(', ')}${unmatched.length > 5 ? '…' : ''}. Check the chapter list.`);
            // A fuller title from the contents ("Chapter 3" → "Chapter 3: The Market").
            for (const c of chapters) {
                const fuller = toc.entries.find((e) => normTitle(e.title).startsWith(`${normTitle(c.title)} `) && titleMatches(c.title, e.title));
                if (fuller) c.title = tidyTitle(fuller.title);
            }
        }
    }

    const regular = chapters.filter((c) => c.kind === 'chapter');
    const longest = chapters.reduce((max, c) => Math.max(max, c.wordCount), 0);
    const needsSplit = regular.length <= 1 && longest > longChapterWords;
    if (needsSplit) {
        warnings.unshift(`Only one chapter was found, and it is ${longest.toLocaleString('en-US')} words long. Split it by a pattern (for example "Chapter") or at a paragraph before saving.`);
    }
    return { chapters, titleCandidate, method: method || 'single', notes, warnings, needsSplit };
};

module.exports = { splitIntoChapters, wordCount, imageCount, plain, findToc, matchToc, patternSplits, DEFAULT_LONG_CHAPTER_WORDS };
