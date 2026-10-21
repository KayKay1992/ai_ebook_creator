const { DOMParser } = require('@xmldom/xmldom');

// Converts (untrusted) HTML or XHTML from an imported book into the
// Markdown chapters are stored as, keeping only basic structure:
// headings, paragraphs, bold/italic, lists, block quotes, code, rules,
// links (http/https/mailto only) and images (only ones the importer
// extracted from the file itself, as `kenlibs-import:<key>` placeholders).
// It is a whitelist: anything else becomes its plain text, and whole
// subtrees of scripts, styles, frames, forms, SVG, media and the like are
// dropped. All text is escaped, so no raw HTML can survive into a chapter.
// DOCTYPEs are removed before parsing (no entity tricks), and the parser
// never fetches anything.
//
// Returns an array of blocks: { kind: 'heading', level, markdown, text }
// | { kind: 'block', markdown } | { kind: 'image', key, markdown }, so the
// importer can split chapters at headings.

const DROP = new Set([
    'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'svg', 'math', 'form', 'input', 'button',
    'select', 'textarea', 'option', 'noscript', 'template', 'head', 'title', 'meta', 'link', 'base', 'audio', 'video',
    'source', 'track', 'canvas', 'map', 'area', 'nav', 'dialog', 'portal',
]);
const BLOCK_CONTAINERS = new Set(['body', 'html', 'div', 'section', 'article', 'main', 'header', 'footer', 'aside', 'center', 'dl', 'details', 'summary']);

const quiet = { warning() {}, error() {}, fatalError() {} };

const stripDoctype = (html) => String(html).replace(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>/gi, '').replace(/<\?xml[^>]*\?>/gi, '');

const parseHtml = (html, { xhtml = false } = {}) => {
    const source = stripDoctype(html);
    const parser = new DOMParser({ errorHandler: quiet, locator: {} });
    const doc = parser.parseFromString(xhtml ? source : `<html><body>${source}</body></html>`, xhtml ? 'application/xhtml+xml' : 'text/html');
    const body = doc.getElementsByTagName('body')[0] || doc.documentElement;
    return body;
};

// Markdown escaping for text content.
const escapeText = (text) => text.replace(/([\\`*_[\]<>])/g, '\\$1');
const collapse = (text) => text.replace(/[\s ]+/g, ' ');
const safeHref = (href) => {
    const value = String(href || '').trim();
    return /^(https?:|mailto:)/i.test(value) ? value.replace(/[()\s]/g, encodeURIComponent) : null;
};
const tagOf = (node) => (node.localName || node.nodeName || '').toLowerCase();
const ELEMENT = 1;
const TEXT = 3;
const CDATA = 4;

// Inline content → Markdown on one line.
const inline = (node, ctx) => {
    let out = '';
    for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === TEXT || child.nodeType === CDATA) {
            out += escapeText(collapse(child.nodeValue || ''));
            continue;
        }
        if (child.nodeType !== ELEMENT) continue;
        const tag = tagOf(child);
        if (DROP.has(tag)) continue;
        if (tag === 'br') out += '  \n';
        else if (tag === 'strong' || tag === 'b') out += wrap(inline(child, ctx), '**');
        else if (tag === 'em' || tag === 'i' || tag === 'cite') out += wrap(inline(child, ctx), '*');
        else if (tag === 'code' || tag === 'kbd' || tag === 'samp') {
            const code = collapse(child.textContent || '').replace(/`/g, "'").trim();
            if (code) out += '`' + code + '`';
        } else if (tag === 'a') {
            const text = inline(child, ctx);
            const href = safeHref(child.getAttribute && child.getAttribute('href'));
            out += href && text.trim() ? `[${text.trim()}](${href})` : text;
        } else if (tag === 'img') {
            const image = ctx.resolveImage(child.getAttribute('src'), child.getAttribute('alt'));
            if (image) out += image;
        } else out += inline(child, ctx);
    }
    return out;
};

const wrap = (text, mark) => {
    const trimmed = text.trim();
    if (!trimmed) return text;
    const lead = text.match(/^\s*/)[0];
    const trail = text.match(/\s*$/)[0];
    return `${lead}${mark}${trimmed}${mark}${trail}`;
};

// A paragraph's text must not start like Markdown block syntax.
const guardBlockStart = (markdown) => markdown.replace(/^(\s*)(#{1,6}\s|[-+]\s|\d+[.)]\s|=+\s*$|-{3,}\s*$)/, '$1\\$2');

const listBlock = (node, ctx, depth) => {
    const ordered = tagOf(node) === 'ol';
    const lines = [];
    let index = 1;
    for (let li = node.firstChild; li; li = li.nextSibling) {
        if (li.nodeType !== ELEMENT || tagOf(li) !== 'li') continue;
        const marker = ordered ? `${index++}. ` : '- ';
        const pad = '  '.repeat(depth);
        // Inline text of the item, then any nested lists.
        let text = '';
        const nested = [];
        for (let part = li.firstChild; part; part = part.nextSibling) {
            if (part.nodeType === ELEMENT && (tagOf(part) === 'ul' || tagOf(part) === 'ol')) nested.push(listBlock(part, ctx, depth + 1));
            else if (part.nodeType === ELEMENT && tagOf(part) === 'p') text += ' ' + inline(part, ctx);
            else if (part.nodeType === ELEMENT && DROP.has(tagOf(part))) continue;
            else text += inline({ firstChild: nodeProxy(part) }, ctx);
        }
        lines.push(`${pad}${marker}${collapse(text).trim()}`);
        lines.push(...nested.filter(Boolean));
    }
    return lines.join('\n');
};

// A view of one node with no next sibling, so inline() converts just it.
const nodeProxy = (node) => new Proxy(node, { get: (target, key) => (key === 'nextSibling' ? null : Reflect.get(target, key)) });

const blocks = (node, ctx, out) => {
    let pending = '';
    const flush = () => {
        const text = collapse(pending).trim();
        if (text) out.push({ kind: 'block', markdown: guardBlockStart(text) });
        pending = '';
    };
    for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === TEXT || child.nodeType === CDATA) {
            pending += escapeText(child.nodeValue || '');
            continue;
        }
        if (child.nodeType !== ELEMENT) continue;
        const tag = tagOf(child);
        if (DROP.has(tag)) continue;
        // Where a table-of-contents entry points inside a file (EPUB).
        if (ctx.anchors.size) {
            const id = anchorOf(child, ctx, !BLOCK_CONTAINERS.has(tag));
            if (id) {
                flush();
                out.push({ kind: 'anchor', id });
            }
        }
        if (/^h[1-6]$/.test(tag)) {
            flush();
            const text = collapse(inline(child, ctx)).trim();
            if (text) out.push({ kind: 'heading', level: Number(tag[1]), markdown: `${'#'.repeat(Number(tag[1]))} ${text}`, text: collapse(child.textContent || '').trim() });
        } else if (tag === 'figcaption') {
            flush();
            // A caption: plain text, in italics.
            const text = escapeText(collapse(child.textContent || '')).trim();
            if (text) out.push({ kind: 'block', markdown: guardBlockStart(`*${text}*`) });
        } else if (tag === 'figure') {
            // A picture with its caption: the caption is also the picture's
            // alt text when it has none.
            flush();
            const inner = [];
            blocks(child, ctx, inner);
            const captionEl = Array.from(child.getElementsByTagName('figcaption'))[0];
            const caption = captionEl ? altText(captionEl.textContent) : '';
            for (const b of inner) {
                if (b.kind === 'image' && caption && b.markdown.startsWith('![]')) out.push({ ...b, markdown: `![${caption}]${b.markdown.slice(3)}` });
                else out.push(b);
            }
        } else if (tag === 'p' || tag === 'dt' || tag === 'dd' || tag === 'caption' || tag === 'address') {
            flush();
            const text = collapse(inline(child, ctx)).trim();
            if (text) {
                const only = text.match(/^!\[[^\]]*\]\(kenlibs-import:([\w-]+)\)$/);
                out.push(only ? { kind: 'image', key: only[1], markdown: text } : { kind: 'block', markdown: guardBlockStart(text) });
            }
        } else if (tag === 'ul' || tag === 'ol') {
            flush();
            const list = listBlock(child, ctx, 0);
            if (list.trim()) out.push({ kind: 'block', markdown: list });
        } else if (tag === 'blockquote') {
            flush();
            const inner = [];
            blocks(child, ctx, inner);
            const text = inner.map((b) => b.markdown).join('\n\n');
            if (text.trim()) out.push({ kind: 'block', markdown: text.split('\n').map((line) => `> ${line}`).join('\n') });
        } else if (tag === 'pre') {
            flush();
            const code = String(child.textContent || '').replace(/```/g, "'''").replace(/\s+$/, '');
            if (code.trim()) out.push({ kind: 'block', markdown: '```\n' + code + '\n```' });
        } else if (tag === 'hr') {
            flush();
            out.push({ kind: 'block', markdown: '---' });
        } else if (tag === 'table') {
            flush();
            for (const row of Array.from(child.getElementsByTagName('tr'))) {
                const cells = Array.from(row.childNodes)
                    .filter((c) => c.nodeType === ELEMENT && (tagOf(c) === 'td' || tagOf(c) === 'th'))
                    .map((c) => collapse(inline(c, ctx)).trim())
                    .filter(Boolean);
                if (cells.length) out.push({ kind: 'block', markdown: guardBlockStart(cells.join(' | ')) });
            }
        } else if (tag === 'img') {
            flush();
            const image = ctx.resolveImage(child.getAttribute('src'), child.getAttribute('alt'));
            const key = image && image.match(/\(kenlibs-import:([\w-]+)\)/);
            if (key) out.push({ kind: 'image', key: key[1], markdown: image });
        } else if (BLOCK_CONTAINERS.has(tag) || tag === 'li') {
            flush();
            blocks(child, ctx, out);
        } else {
            pending += inline({ firstChild: nodeProxy(child) }, ctx);
        }
    }
    flush();
    return out;
};

// The id of an element (or, for a paragraph/heading, of anything inside
// it) that a table-of-contents entry points at; each id is used once.
const anchorOf = (node, ctx, deep) => {
    const own = node.getAttribute && node.getAttribute('id');
    if (own && ctx.anchors.has(own) && !ctx.seenAnchors.has(own)) {
        ctx.seenAnchors.add(own);
        return own;
    }
    if (!deep || !node.getElementsByTagName) return null;
    for (const el of Array.from(node.getElementsByTagName('*'))) {
        const id = el.getAttribute('id');
        if (id && ctx.anchors.has(id) && !ctx.seenAnchors.has(id)) {
            ctx.seenAnchors.add(id);
            return id;
        }
    }
    return null;
};

// Alt text / captions: plain words only. Brackets, parentheses and
// Markdown symbols are removed (not escaped) so every reader-side
// `![...](...)` pattern (speech, narration, translation) still sees
// the whole image.
const altText = (text) =>
    collapse(String(text || ''))
        .replace(/[[\]()\\*_`<>#|!~]/g, '')
        .trim()
        .slice(0, 120);

// resolveImage(src) → key or '' to drop the picture; images become
// `![alt](kenlibs-import:key)`. `anchors`: ids to report as
// { kind: 'anchor', id } blocks.
const htmlToBlocks = (html, { xhtml = false, resolveImage = () => '', anchors = new Set() } = {}) => {
    const body = parseHtml(html, { xhtml });
    const ctx = {
        anchors,
        seenAnchors: new Set(),
        resolveImage: (src, alt) => {
            const key = resolveImage(String(src || ''));
            if (!key) return '';
            return `![${altText(alt)}](kenlibs-import:${key})`;
        },
    };
    return blocks(body, ctx, []);
};

module.exports = { htmlToBlocks, escapeText, stripDoctype, parseHtml, altText };
