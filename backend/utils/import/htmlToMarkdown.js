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
const BLOCK_CONTAINERS = new Set(['body', 'html', 'div', 'section', 'article', 'main', 'header', 'footer', 'aside', 'figure', 'center', 'dl', 'details', 'summary']);

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
        if (/^h[1-6]$/.test(tag)) {
            flush();
            const text = collapse(inline(child, ctx)).trim();
            if (text) out.push({ kind: 'heading', level: Number(tag[1]), markdown: `${'#'.repeat(Number(tag[1]))} ${text}`, text: collapse(child.textContent || '').trim() });
        } else if (tag === 'p' || tag === 'dt' || tag === 'dd' || tag === 'caption' || tag === 'figcaption' || tag === 'address') {
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

// resolveImage(src, alt) → `![alt](kenlibs-import:key)` or '' to drop it.
const htmlToBlocks = (html, { xhtml = false, resolveImage = () => '' } = {}) => {
    const body = parseHtml(html, { xhtml });
    const ctx = {
        resolveImage: (src, alt) => {
            const key = resolveImage(String(src || ''));
            if (!key) return '';
            const label = escapeText(collapse(String(alt || '')).trim()).slice(0, 120);
            return `![${label}](kenlibs-import:${key})`;
        },
    };
    return blocks(body, ctx, []);
};

module.exports = { htmlToBlocks, escapeText, stripDoctype, parseHtml };
