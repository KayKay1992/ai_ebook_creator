const { escapeText } = require('./htmlToMarkdown');
const { romanToNumber } = require('./sectionNames');

// Turns what pdfTextWorker.js read from a PDF (positioned text runs and
// pictures per page) into the same blocks every other format produces, for
// utils/import/chapters.js. A PDF has no structure of its own, so it is
// rebuilt from the layout:
//   - text runs are grouped into lines by position (not stream order);
//   - running headers and footers ("12 THE BOOK TITLE", "Chapter Name 13",
//     a page number on its own) are removed;
//   - lines in clearly bigger type than the body text are headings
//     (marked `guessed`; consecutive lines in the same size are one heading,
//     so a title over two lines stays one title); short centred lines in
//     body type are subheadings;
//   - paragraphs end at an indent, a larger gap, a short line that ends a
//     sentence, or a list marker, and continue across page breaks;
//     "fi-\nnancial" is joined back into "financial";
//   - pictures are placed where they sit between the lines; a picture
//     filling most of a page that also has text (a scanned page behind its
//     OCR text) and tiny ones are left out; a first page that is only a
//     picture is offered as the cover, a last page that is only pictures
//     (the back cover) is left out.

const median = (values) => {
    if (!values.length) return 0;
    const s = values.slice().sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
};
const percentile = (values, p) => {
    if (!values.length) return 0;
    const s = values.slice().sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};

const groupLines = (items) => {
    const runs = items.map(([s, x, y, w, size, font]) => ({ s, x, y, w, size, font })).sort((a, b) => b.y - a.y || a.x - b.x);
    const lines = [];
    for (const run of runs) {
        const line = lines[lines.length - 1];
        if (line && Math.abs(line.y - run.y) <= Math.max(1.5, 0.45 * Math.min(line.size || run.size, run.size || line.size))) {
            line.runs.push(run);
            if (run.s.trim() && run.size > line.size) line.size = run.size;
        } else lines.push({ y: run.y, size: run.s.trim() ? run.size : 0, runs: [run] });
    }
    return lines
        .map((line) => {
            line.runs.sort((a, b) => a.x - b.x);
            let text = '';
            let prev = null;
            for (const run of line.runs) {
                if (prev && text && !/\s$/.test(text) && !/^\s/.test(run.s) && run.x - (prev.x + prev.w) > 0.2 * (run.size || prev.size || 10)) text += ' ';
                text += run.s;
                prev = run;
            }
            const visible = line.runs.filter((r) => r.s.trim());
            const first = visible[0] || line.runs[0];
            const last = visible[visible.length - 1] || first;
            // The size most of the line's characters are in.
            const bySize = {};
            for (const r of visible) bySize[r.size] = (bySize[r.size] || 0) + r.s.length;
            const size = Number(Object.entries(bySize).sort((a, b) => b[1] - a[1])[0]?.[0]) || line.size;
            // A contents line: the page number set apart at the right
            // ("Foreword ........ ix" or a wide gap before it).
            const beforeLast = visible[visible.length - 2];
            const leader = /\.{3,}|…{2,}/.test(text) || Boolean(beforeLast && isPageToken(last.s.trim()) && last.x - (beforeLast.x + beforeLast.w) > 2 * (size || 10));
            return { text: text.replace(/\s+/g, ' ').trim(), x: first.x, xEnd: last.x + last.w, y: line.y, size, leader };
        })
        .filter((l) => l.text);
};

// A page number: 1-4 digits or a real roman numeral (not just any word
// made of i, v, x, l and c).
const isPageToken = (t) => /^\d{1,4}$/.test(t) || (t.length <= 7 && (t === t.toLowerCase() || t === t.toUpperCase()) && Boolean(romanToNumber(t)));
const isPageNumber = (text) => isPageToken(String(text).trim());
// "12 THE BOOK TITLE" / "Chapter Name 13" → the text without the number;
// null when neither end is a number.
const withoutPageNumber = (text) => {
    const words = String(text).trim().split(/\s+/);
    if (words.length < 2) return null;
    if (isPageToken(words[0])) return words.slice(1).join(' ');
    if (isPageToken(words[words.length - 1])) return words.slice(0, -1).join(' ').replace(/[\s.·]+$/, '');
    return null;
};
const headerKey = (text) => (withoutPageNumber(text) ?? text).toLowerCase().replace(/[^a-z]+/g, ' ').trim();

const LIST_START = /^(\d{1,3}[.)]|[•●▪◦–-])\s/;
const SENTENCE_END = /[.!?:"”’')\]]$/;

// → { blocks, coverKey, notes }
const layoutPdf = (pages, { addImage }) => {
    const notes = [];
    const pageLines = pages.map((p) => groupLines(p.items || []));

    // Body text: the size most characters are in.
    const chars = {};
    pageLines.flat().forEach((l) => (chars[l.size] = (chars[l.size] || 0) + l.text.length));
    const body = Number(Object.entries(chars).sort((a, b) => b[1] - a[1])[0]?.[0]) || 11;
    const isBodySize = (l) => l.size <= body * 1.12;

    // Line spacing, line length and left margin of body text.
    const gaps = [];
    pageLines.forEach((lines) => {
        for (let i = 1; i < lines.length; i++) {
            const g = lines[i - 1].y - lines[i].y;
            if (isBodySize(lines[i]) && isBodySize(lines[i - 1]) && g > 0 && g < body * 3) gaps.push(g);
        }
    });
    const spacing = median(gaps) || body * 1.2;
    const bodyLines = pageLines.flat().filter(isBodySize);
    const docMargin = percentile(bodyLines.map((l) => l.x), 0.2);
    const margins = pageLines.map((lines) => {
        const xs = lines.filter(isBodySize).map((l) => l.x);
        return xs.length >= 4 ? percentile(xs, 0.2) : docMargin;
    });
    const columnWidth = percentile(bodyLines.map((l) => l.xEnd - docMargin), 0.9) || 300;

    // Running headers / footers.
    const firstKeys = {};
    pageLines.forEach((lines) => {
        if (lines.length) firstKeys[headerKey(lines[0].text)] = (firstKeys[headerKey(lines[0].text)] || 0) + 1;
    });
    let dropped = 0;
    pageLines.forEach((lines, p) => {
        if (!lines.length) return;
        const height = pages[p].height || 800;
        const top = lines[0];
        const gapBelow = lines[1] ? top.y - lines[1].y : Infinity;
        const repeated = firstKeys[headerKey(top.text)] >= 3 && headerKey(top.text).length > 0;
        const numbered = withoutPageNumber(top.text) !== null || isPageNumber(top.text);
        if (isBodySize(top) && top.text.length <= 90 && top.y > height * 0.7 && ((numbered && gapBelow >= spacing * 1.3) || (repeated && gapBelow >= spacing * 1.3) || isPageNumber(top.text))) {
            lines.shift();
            dropped++;
        }
        const bottom = lines[lines.length - 1];
        if (bottom && bottom.y < height * 0.2 && isPageNumber(bottom.text)) {
            lines.pop();
            dropped++;
        }
    });
    if (dropped) notes.push(`Removed ${dropped} running header${dropped === 1 ? '' : 's'}, footer${dropped === 1 ? '' : 's'} and page number${dropped === 1 ? '' : 's'}.`);

    // Heading sizes, biggest first → levels.
    const headingSizes = [...new Set(pageLines.flat().filter((l) => l.size >= body * 1.25).map((l) => Math.round(l.size * 2) / 2))].sort((a, b) => b - a);
    const levelOf = (size) => Math.min(6, headingSizes.indexOf(Math.round(size * 2) / 2) + 1 || 6);
    const subLevel = Math.min(6, Math.max(2, headingSizes.length + 1));

    const out = [];
    let para = null; // { text, size, ended }
    const flush = () => {
        if (para && para.text.trim()) out.push({ kind: 'block', markdown: escapeText(para.text.trim()).replace(/^(\s*)(#{1,6}\s|[-+]\s|\d+[.)]\s)/, '$1\\$2') });
        para = null;
    };
    let coverKey = null;
    let scans = 0;
    let tiny = 0;
    let backCover = 0;

    pages.forEach((page, p) => {
        const lines = pageLines[p];
        const margin = margins[p];
        const pageArea = (page.width || 600) * (page.height || 800);
        // A paragraph runs on to the next page only if the page's last
        // line was full.
        if (para && para.lastShort) para.ended = true;
        const images = (page.images || []).filter((img) => {
            if (img.width < 16 || img.height < 16 || img.right - img.left < 12 || img.top - img.bottom < 12) {
                tiny++;
                return false;
            }
            if (lines.length && ((img.right - img.left) * (img.top - img.bottom)) / pageArea > 0.6) {
                scans++;
                return false;
            }
            return true;
        });
        // Cover / back cover: a page with pictures and no text.
        if (!lines.length && images.length) {
            if (p === 0 && !coverKey) {
                const biggest = images.slice().sort((a, b) => b.width * b.height - a.width * a.height)[0];
                coverKey = addImage(biggest.png) || null;
                return;
            }
            if (p === pages.length - 1) {
                backCover += images.length;
                return;
            }
        }
        const entries = [...lines.map((l) => ({ line: l, y: l.y })), ...images.map((img) => ({ image: img, y: img.top }))].sort((a, b) => b.y - a.y);
        let prev = null;
        for (const entry of entries) {
            if (entry.image) {
                flush();
                const key = addImage(entry.image.png);
                if (key) out.push({ kind: 'image', key, markdown: `![](kenlibs-import:${key})` });
                prev = null;
                continue;
            }
            const line = entry.line;
            const gap = prev ? prev.y - line.y : null;
            if (line.size >= body * 1.25 && line.text.length <= 150 && /\p{L}/u.test(line.text)) {
                flush();
                const last = out[out.length - 1];
                // A title over several lines (sizes may vary a little on a
                // title page) is one heading.
                const similar = last && last.size && Math.min(last.size, line.size) / Math.max(last.size, line.size) >= 0.75;
                if (last && last.kind === 'heading' && !last.sub && last.page === p && similar && gap !== null && gap <= Math.max(last.size, line.size) * 2.4) {
                    last.text = `${last.text} ${line.text}`;
                    last.size = Math.max(last.size, line.size);
                } else out.push({ kind: 'heading', size: line.size, page: p, text: line.text, guessed: true });
                prev = line;
                continue;
            }
            const center = (line.x + line.xEnd) / 2;
            const columnCenter = margin + columnWidth / 2;
            const centred = line.x > margin + columnWidth * 0.1 && Math.abs(center - columnCenter) < columnWidth * 0.08;
            if (centred && isBodySize(line) && line.text.length <= 70 && !/[.,;:]$/.test(line.text) && /\p{L}/u.test(line.text) && (gap === null || gap >= spacing * 1.5)) {
                flush();
                out.push({ kind: 'heading', size: 0, sub: true, page: p, text: line.text, guessed: true });
                prev = line;
                continue;
            }
            // The second line of a centred subheading.
            const lastOut = out[out.length - 1];
            if (!para && centred && lastOut?.sub && lastOut.page === p && isBodySize(line) && line.text.length <= 70 && gap !== null && gap <= spacing * 1.6) {
                lastOut.text = `${lastOut.text} ${line.text}`;
                prev = line;
                continue;
            }
            const indented = line.x > margin + Math.max(3, body * 0.25);
            const startNew =
                !para ||
                para.ended ||
                indented ||
                LIST_START.test(line.text) ||
                (gap !== null && gap > spacing * 1.6) ||
                Math.abs(para.size - line.size) > 1.5;
            if (startNew) {
                flush();
                para = { text: line.text, size: line.size };
            } else if (/\p{L}-$/u.test(para.text) && /^\p{Ll}/u.test(line.text)) {
                para.text = para.text.slice(0, -1) + line.text;
            } else para.text = `${para.text} ${line.text}`;
            const short = line.xEnd < margin + columnWidth * 0.85;
            para.ended = line.leader || (short && (SENTENCE_END.test(line.text) || withoutPageNumber(line.text) !== null));
            para.lastShort = short;
            prev = line;
        }
    });
    flush();

    if (coverKey) notes.push('The first page is a picture only: it is offered as the cover.');
    if (backCover) notes.push(`Left out the back cover (${backCover} picture${backCover === 1 ? '' : 's'} on the last page, no text).`);
    if (scans) notes.push(`Left out ${scans} full-page scan${scans === 1 ? '' : 's'} behind the text.`);
    if (tiny) notes.push(`Left out ${tiny} tiny picture${tiny === 1 ? '' : 's'} (spacers or dots).`);

    const blocks = out.map((b) => {
        if (b.kind !== 'heading') return b;
        // `level` ranks the sizes (for choosing where chapters start); in
        // the text, headings are at most three levels deep.
        const level = b.sub ? subLevel : levelOf(b.size);
        return { kind: 'heading', level, text: b.text, markdown: `${'#'.repeat(b.sub ? 3 : Math.min(level, 3))} ${escapeText(b.text)}`, guessed: true, ...(b.sub ? { sub: true } : {}) };
    });
    return { blocks, coverKey, notes };
};

module.exports = { layoutPdf, groupLines };
