// Recognising chapter lines and named sections in an imported book
// (utils/import/chapters.js). Pure functions, unit-tested in
// tests/bookImport.test.js.
//   parseChapterLine("CHAPTER TWELVE: The Road")  → { kind: 'chapter', number: 12, title: 'The Road' }
//   parseChapterLine("Part One")                  → { kind: 'part', number: 1, title: '' }
//   namedSection("The Preface")                   → { name: 'Preface', side: 'front' }
// Only ever applied to a standalone short line (a heading or a paragraph
// of its own), never to text inside a paragraph.

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50 };

// "one" … "fifty" (also "twenty-one", "twenty one", "Thirty Five") → number.
const wordToNumber = (word) => {
    const w = String(word || '').toLowerCase().trim().replace(/\s+/g, ' ');
    const small = ONES.indexOf(w);
    if (small > 0) return small;
    if (TENS[w]) return TENS[w];
    const m = /^(twenty|thirty|forty)[\s-](one|two|three|four|five|six|seven|eight|nine)$/.exec(w);
    return m ? TENS[m[1]] + ONES.indexOf(m[2]) : null;
};

const ROMAN = /^(?=[ivxlc])(c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/i;
const romanToNumber = (text) => {
    const s = String(text || '').toLowerCase();
    if (!s || !ROMAN.test(s)) return null;
    const values = { i: 1, v: 5, x: 10, l: 50, c: 100 };
    let total = 0;
    for (let i = 0; i < s.length; i++) {
        const v = values[s[i]];
        total += v < (values[s[i + 1]] || 0) ? -v : v;
    }
    return total || null;
};

const WORD_NUMBER = '(?:(?:twenty|thirty|forty)[\\s-](?:one|two|three|four|five|six|seven|eight|nine)|twenty|thirty|forty|fifty|nineteen|eighteen|seventeen|sixteen|fifteen|fourteen|thirteen|twelve|eleven|ten|nine|eight|seven|six|five|four|three|two|one)';
const NUMBER = `(\\d{1,3}|${WORD_NUMBER}|[ivxlc]{1,7})`;
// "Chapter 3", "CHAPTER THREE", "Chapter 3: Title", "Chapter 3 - Title",
// "Chapter 3. Title", "Chapter 3 Title" (title must then start with a
// capital or a quote, so "Chapter 3 was hard" is not a chapter line).
const CHAPTER_RE = new RegExp(`^(chapter|chap\\.|part|book)\\s+${NUMBER}(?:\\s*[:.\\-–—]\\s*(.*)|\\s+(["“‘'A-Z].*))?$`, 'i');

const parseNumber = (token) => {
    if (/^\d+$/.test(token)) return Number(token);
    return wordToNumber(token) ?? romanToNumber(token);
};

// Plain text of a one-line Markdown block (escapes and emphasis removed).
const lineText = (markdown) =>
    String(markdown || '')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/^#{1,6}\s+/, '')
        .replace(/\\(.)/g, '$1')
        .replace(/(\*\*|__|\*|_|`)/g, '')
        .replace(/\s+/g, ' ')
        .trim();

const parseChapterLine = (text) => {
    const line = String(text || '').trim();
    if (!line || line.length > 100) return null;
    const m = CHAPTER_RE.exec(line);
    if (!m) return null;
    const number = parseNumber(m[2]);
    if (!number || number > 300) return null;
    // (The regex is case-insensitive, so the capital is checked here.)
    if (m[4] !== undefined && !/^["“‘'\p{Lu}]/u.test(m[4])) return null;
    const title = (m[3] ?? m[4] ?? '').trim();
    // A sentence, not a title.
    if (title && (/[.;,]$/.test(title) || /[.!?]\s+\S/.test(title))) return null;
    const word = m[1].toLowerCase();
    return { kind: word === 'part' || word === 'book' ? 'part' : 'chapter', number, title };
};

// Named front/back matter. `side` is where it usually sits; the importer
// decides by position (before the first chapter = front, after = back).
const NAMED = [
    ['Dedication', 'front', 'dedication'],
    ['Epigraph', 'front', 'epigraph'],
    ['Foreword', 'front', 'fore-?words?|forward'],
    ['Preface', 'front', 'preface'],
    ['Introduction', 'front', 'introduction'],
    ['Prologue', 'front', 'prologue'],
    ["Author's note", 'front', "(?:a\\s+)?(?:note\\s+from\\s+the\\s+author|author[’']?s\\s+note|note\\s+to\\s+(?:the\\s+)?readers?|a\\s+note\\s+on\\s+.{2,40})"],
    ['Acknowledgements', 'back', 'acknowledge?ments?'],
    ['Epilogue', 'back', 'epilogue'],
    ['Conclusion', 'back', 'conclusion'],
    ['Afterword', 'back', 'afterword'],
    ['Postscript', 'back', 'postscript'],
    ['About the author', 'back', 'about\\s+the\\s+authors?'],
    ['Appendix', 'back', 'append(?:ix|ices)(?:\\s+(?:[a-z]|\\d{1,2}|[ivx]{1,4}))?'],
    ['Glossary', 'back', 'glossary'],
    ['Bibliography', 'back', 'bibliography'],
    ['References', 'back', 'references'],
    ['Notes', 'back', '(?:end)?notes'],
    ['Index', 'back', 'index'],
    ['Further reading', 'back', 'further\\s+reading'],
    ['Also by the author', 'back', 'also\\s+by\\s+.{2,60}'],
];
const NAMED_RE = NAMED.map(([name, side, pattern]) => [name, side, new RegExp(`^(?:the\\s+)?(?:${pattern})(?:\\s*[:.\\-–—]\\s*(.{1,80}))?$`, 'i')]);

const namedSection = (text) => {
    const line = String(text || '').trim();
    if (!line || line.length > 90) return null;
    for (const [name, side, re] of NAMED_RE) {
        if (re.test(line)) return { name, side };
    }
    return null;
};

const CONTENTS_RE = /^(?:table\s+of\s+contents|contents|content|toc)$/i;
const isContentsTitle = (text) => CONTENTS_RE.test(String(text || '').trim());

// "THE MAN WHO DESIRED GOLD" → "The Man Who Desired Gold". Only for titles
// written entirely in capitals; anything else is kept as the author wrote it.
const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'into', 'nor', 'of', 'on', 'or', 'the', 'to', 'with']);
const tidyTitle = (title) => {
    const t = String(title || '').replace(/\s+/g, ' ').trim();
    // "CHAPTER TWO: The River" → "Chapter Two: The River".
    const label = /^((?:chapter|part|book)\s+\S+)(\s*[:.\-–—]\s*|\s+)(.+)$/i.exec(t);
    if (label && parseChapterLine(t) && label[1] === label[1].toUpperCase() && label[3] !== label[3].toUpperCase()) {
        return `${tidyTitle(label[1])}${label[2]}${label[3]}`;
    }
    const letters = t.replace(/[^A-Za-z]/g, '');
    if (letters.length < 4 || letters !== letters.toUpperCase()) return t;
    return t
        .toLowerCase()
        .split(' ')
        .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.replace(/^(["“‘'(]?)(\p{L})/u, (all, lead, c) => lead + c.toUpperCase())))
        .join(' ')
        .replace(/\b(i{1,3}|iv|vi{0,3}|ix|xi{0,3})\b/g, (r) => r.toUpperCase());
};

// For comparing titles: lower case, letters and digits only.
const normTitle = (text) =>
    String(text || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

module.exports = { wordToNumber, romanToNumber, parseChapterLine, namedSection, isContentsTitle, tidyTitle, normTitle, lineText };
