const path = require('path').posix;
const MarkdownIt = require('markdown-it');
const mammoth = require('mammoth');
const { DOMParser } = require('@xmldom/xmldom');
const { detectFormat, ImportError } = require('./fileType');
const { readZip, detectZipFormat } = require('./zipSafe');
const { htmlToBlocks, stripDoctype } = require('./htmlToMarkdown');
const { splitIntoChapters, imageCount } = require('./chapters');
const { createImageStore, skippedImageWarnings } = require('./images');
const { extractPdfText } = require('./pdfText');
const { layoutPdf } = require('./pdfLayout');
const { parseChapterLine, tidyTitle } = require('./sectionNames');
const { importLimits } = require('./limits');

// "Import a book": parses an uploaded .docx / .epub / .pdf / .md / .txt
// (already in memory; the original file is never stored) into a draft for
// the review screen:
//   { format, title, author, description, chapters: [{ title, kind,
//     content, wordCount, imageCount }], images: { key: { contentType,
//     bytes, width, height, dataUri } }, coverKey, warnings: [], notes: [],
//     needsSplit, method }
// Every format becomes a list of blocks (htmlToMarkdown.js, pdfLayout.js)
// that utils/import/chapters.js splits into chapters. Chapter content is
// Markdown; pictures are `kenlibs-import:<key>` placeholders until the book
// is saved (importController.commitImport). `kind` is 'chapter' (numbered),
// 'front' / 'back' (front and back matter) or 'part'.

const quiet = { warning() {}, error() {}, fatalError() {} };
const parseXml = (text) => new DOMParser({ errorHandler: quiet }).parseFromString(stripDoctype(text), 'application/xml');
const byLocalName = (node, name) => Array.from(node.getElementsByTagName('*')).filter((el) => (el.localName || el.nodeName) === name || el.nodeName.endsWith(`:${name}`));
const childrenNamed = (node, name) => Array.from(node.childNodes || []).filter((el) => el.nodeType === 1 && ((el.localName || el.nodeName) === name || el.nodeName.endsWith(`:${name}`)));
const firstText = (node, name) => (byLocalName(node, name)[0]?.textContent || '').replace(/\s+/g, ' ').trim();
const stripTags = (html) => String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const fileTitle = (fileName) => String(fileName || '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 200) || 'Untitled book';

// ---------- .docx (mammoth) ----------
const parseDocx = async (buffer, limits, imageStore) => {
    // Check the whole archive first (zip-bomb limits), keeping only the
    // document properties for title/author.
    const zip = await readZip(buffer, limits, (name) => name === 'docProps/core.xml');
    if (detectZipFormat(zip) !== 'docx') throw new ImportError("That isn't a valid .docx file.");
    let title = '';
    let author = '';
    const core = zip.files.get('docProps/core.xml');
    if (core) {
        const doc = parseXml(core.toString('utf8'));
        title = firstText(doc, 'title');
        author = firstText(doc, 'creator');
    }
    let externalImages = 0;
    const result = await mammoth.convertToHtml(
        { buffer },
        {
            // Embedded pictures become placeholders (with their alt text);
            // linked (external) pictures are never fetched.
            convertImage: mammoth.images.imgElement((image) =>
                image.read().then(
                    (data) => {
                        const key = imageStore.add(Buffer.from(data));
                        return { src: key ? `kenlibs-import:${key}` : '', alt: image.altText || '' };
                    },
                    () => {
                        externalImages++;
                        return { src: '' };
                    }
                )
            ),
            ignoreEmptyParagraphs: true,
            styleMap: [
                // Word's quote styles become block quotes, captions captions.
                "p[style-name='Quote'] => blockquote > p:fresh",
                "p[style-name='Intense Quote'] => blockquote > p:fresh",
                'p.Quote => blockquote > p:fresh',
                'p.IntenseQuote => blockquote > p:fresh',
                "p[style-name='Caption'] => figcaption:fresh",
                'p.Caption => figcaption:fresh',
            ],
        }
    );
    const blocks = htmlToBlocks(result.value, { resolveImage: (src) => (src.startsWith('kenlibs-import:') ? src.slice(15) : '') });
    const warnings = externalImages ? [`${externalImages} linked picture${externalImages === 1 ? ' was' : 's were'} left out (only pictures saved inside the file are imported).`] : [];
    return { blocks, title, author, description: '', coverKey: null, warnings, notes: [] };
};

// ---------- .epub ----------
const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;
const parseEpub = async (buffer, limits, imageStore) => {
    const zip = await readZip(buffer, limits, (name) => /\.(xhtml|html|htm|xml|opf|ncx)$/i.test(name) || IMAGE_EXT.test(name) || name === 'mimetype');
    if (detectZipFormat(zip) !== 'epub') throw new ImportError("That isn't a valid .epub file.");
    const read = (name) => zip.files.get(name)?.toString('utf8');
    const container = read('META-INF/container.xml');
    if (!container) throw new ImportError('The .epub is missing its table of contents.');
    const rootPath = byLocalName(parseXml(container), 'rootfile')[0]?.getAttribute('full-path');
    const opfText = rootPath && read(rootPath);
    if (!opfText) throw new ImportError('The .epub is missing its package file.');
    const opf = parseXml(opfText);
    const base = path.dirname(rootPath);
    // → { file, anchor } inside the archive, or null for anything outside it.
    const resolveRef = (from, href) => {
        const [rawFile, rawAnchor] = String(href || '').split('#');
        let file;
        try {
            file = decodeURIComponent(rawFile);
        } catch {
            return null;
        }
        if (/^[a-z]+:/i.test(file)) return null;
        const joined = file ? path.normalize(path.join(from === '.' ? '' : from, file)) : null;
        if (!joined || joined.startsWith('..')) return null;
        return { file: joined.replace(/^\.\//, ''), anchor: rawAnchor || '' };
    };
    const resolve = (from, href) => resolveRef(from, href)?.file || null;

    const manifest = new Map();
    for (const item of byLocalName(opf, 'item')) {
        manifest.set(item.getAttribute('id'), {
            href: resolve(base, item.getAttribute('href')),
            type: item.getAttribute('media-type') || '',
            properties: item.getAttribute('properties') || '',
        });
    }
    const title = firstText(opf, 'title');
    const author = byLocalName(opf, 'creator').map((c) => c.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).join(', ');
    const description = stripTags(firstText(opf, 'description')).slice(0, 2000);

    // Table of contents (EPUB 3 nav, else EPUB 2 NCX) → ordered entries
    // { file, anchor, label, depth, hasChildren }.
    const entries = [];
    const navItem = [...manifest.values()].find((m) => m.properties.split(/\s+/).includes('nav'));
    if (navItem && read(navItem.href)) {
        const nav = parseXml(read(navItem.href));
        const navs = byLocalName(nav, 'nav');
        const tocNav = navs.find((n) => /\btoc\b/.test(n.getAttribute('epub:type') || n.getAttribute('type') || '')) || navs[0];
        const walk = (ol, depth) => {
            for (const li of childrenNamed(ol, 'li')) {
                const a = childrenNamed(li, 'a')[0] || childrenNamed(li, 'span')[0];
                const nested = childrenNamed(li, 'ol')[0];
                const ref = a && resolveRef(path.dirname(navItem.href), a.getAttribute('href'));
                const label = a ? a.textContent.replace(/\s+/g, ' ').trim() : '';
                if (label) entries.push({ file: ref?.file || null, anchor: ref?.anchor || '', label, depth, hasChildren: Boolean(nested) });
                if (nested) walk(nested, depth + 1);
            }
        };
        const top = tocNav && childrenNamed(tocNav, 'ol')[0];
        if (top) walk(top, 0);
    } else {
        const tocId = byLocalName(opf, 'spine')[0]?.getAttribute('toc');
        const ncxItem = manifest.get(tocId) || [...manifest.values()].find((m) => m.type === 'application/x-dtbncx+xml');
        if (ncxItem && read(ncxItem.href)) {
            const ncx = parseXml(read(ncxItem.href));
            const walk = (node, depth) => {
                for (const point of childrenNamed(node, 'navPoint')) {
                    const label = (byLocalName(childrenNamed(point, 'navLabel')[0] || point, 'text')[0]?.textContent || '').replace(/\s+/g, ' ').trim();
                    const ref = resolveRef(path.dirname(ncxItem.href), childrenNamed(point, 'content')[0]?.getAttribute('src'));
                    const nested = childrenNamed(point, 'navPoint').length > 0;
                    if (label) entries.push({ file: ref?.file || null, anchor: ref?.anchor || '', label, depth, hasChildren: nested });
                    walk(point, depth + 1);
                }
            };
            const navMap = byLocalName(ncx, 'navMap')[0];
            if (navMap) walk(navMap, 0);
        }
    }
    // Chapters are the top level of the contents; when every top-level
    // entry holds others (Part One › Chapter 1 …), the next level down, with
    // the parts as dividers.
    const topLevel = entries.filter((e) => e.depth === 0);
    const useDepth = topLevel.length && topLevel.every((e) => e.hasChildren || parseChapterLine(e.label)?.kind === 'part') && entries.some((e) => e.depth === 1) ? 1 : 0;
    const splitEntries = entries.filter((e) => e.file && e.depth <= useDepth);

    // Cover image (EPUB 3 property or EPUB 2 <meta name="cover">). Offered
    // on the review screen, never set automatically.
    let coverKey = null;
    const coverMetaId = byLocalName(opf, 'meta').find((m) => m.getAttribute('name') === 'cover')?.getAttribute('content');
    const coverItem = [...manifest.values()].find((m) => m.properties.split(/\s+/).includes('cover-image')) || manifest.get(coverMetaId);
    if (coverItem && IMAGE_EXT.test(coverItem.href || '') && zip.files.get(coverItem.href)) {
        coverKey = imageStore.add(zip.files.get(coverItem.href));
    }

    const blocks = [];
    const warnings = [];
    const notes = [];
    let seenText = false;
    for (const ref of byLocalName(opf, 'itemref')) {
        if (ref.getAttribute('linear') === 'no') continue;
        const item = manifest.get(ref.getAttribute('idref'));
        if (!item || !/html|xml/.test(item.type) || !item.href) continue;
        const source = read(item.href);
        if (!source) continue;
        const dir = path.dirname(item.href);
        const here = splitEntries.filter((e) => e.file === item.href);
        const anchors = new Set(here.map((e) => e.anchor).filter(Boolean));
        const docBlocks = htmlToBlocks(source, {
            xhtml: true,
            anchors,
            resolveImage: (src) => {
                const file = resolve(dir, src);
                if (!file || !IMAGE_EXT.test(file) || !zip.files.get(file)) return '';
                if (coverItem && file === coverItem.href) return ''; // the cover is offered separately
                return imageStore.add(zip.files.get(file)) || '';
            },
        });
        const hasText = docBlocks.some((b) => b.kind === 'heading' || b.kind === 'block');
        // A cover page (picture only) before any text.
        if (!hasText && !seenText) continue;
        if (hasText) seenText = true;
        const marker = (entry) => ({ kind: 'split', title: entry.label, part: entry.depth < useDepth });
        const placed = new Set();
        const out = docBlocks.flatMap((b) => {
            if (b.kind !== 'anchor') return [b];
            const entry = here.find((e) => e.anchor === b.id && !placed.has(e));
            if (!entry) return [];
            placed.add(entry);
            return [marker(entry)];
        });
        // Entries for the file itself (or whose anchor wasn't found) start it.
        const atStart = here.filter((e) => !placed.has(e)).slice(0, 1);
        if (!atStart.length && !here.length && docBlocks[0]?.kind === 'heading' && !splitEntries.length) {
            // No table of contents at all: each file that starts with a
            // heading is a chapter.
            atStart.push({ label: docBlocks[0].text, depth: 0 });
        }
        // (A first heading that repeats the title is dropped by chapters.js.)
        blocks.push(...atStart.map(marker), ...out);
    }
    if (!blocks.some((b) => b.kind === 'block' || b.kind === 'heading')) warnings.push('No readable chapters were found in this .epub.');
    return { blocks, title, author, description, coverKey, warnings, notes };
};

// ---------- .md / .txt ----------
const md = new MarkdownIt({ html: false, linkify: false });
const parseMarkdown = (buffer) => {
    const text = new TextDecoder('utf-8').decode(buffer).replace(/^﻿/, '');
    let externalImages = 0;
    const blocks = htmlToBlocks(md.render(text), {
        resolveImage: () => {
            externalImages++;
            return '';
        },
    });
    const warnings = externalImages ? [`${externalImages} picture link${externalImages === 1 ? ' was' : 's were'} left out of the Markdown (pictures next to a Markdown file and web addresses aren't imported; add them in the editor).`] : [];
    return { blocks, title: '', author: '', description: '', coverKey: null, warnings, notes: [] };
};

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Plain text: blank lines separate paragraphs.
const paragraphsToHtml = (paragraphs) => paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('');
const parseText = (buffer) => {
    const text = new TextDecoder('utf-8').decode(buffer).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    const paragraphs = text.split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
    return { blocks: htmlToBlocks(paragraphsToHtml(paragraphs)), title: '', author: '', description: '', coverKey: null, warnings: [], notes: [] };
};

// ---------- .pdf ----------
const parsePdf = async (buffer, limits, imageStore) => {
    const { totalPages, pages, title, author, imageFailures, imageLimitReached } = await extractPdfText(buffer, { maxImages: limits.maxImages });
    const chars = pages.reduce((sum, p) => sum + p.items.reduce((s, i) => s + String(i[0]).replace(/\s/g, '').length, 0), 0);
    const warnings = [];
    if (chars < 50) {
        throw new ImportError('This PDF has almost no text. It looks scanned (pictures of pages); run it through OCR first or use a .docx/.epub.');
    }
    if (chars / Math.max(totalPages, 1) < 200) {
        warnings.push(`This PDF has very little text for ${totalPages} page${totalPages === 1 ? '' : 's'}. It may be partly scanned; check the chapters carefully.`);
    }
    if (pages.length < totalPages) warnings.push(`Only the first ${pages.length} pages were read.`);
    const { blocks, coverKey, notes } = layoutPdf(pages, { addImage: (png) => imageStore.add(Buffer.from(png)) });
    if (imageFailures) warnings.push(`${imageFailures} picture${imageFailures === 1 ? '' : 's'} in this PDF couldn't be read and ${imageFailures === 1 ? 'was' : 'were'} left out. If pictures are missing, import the .docx or .epub instead.`);
    if (imageLimitReached) warnings.push(`Only the first ${limits.maxImages} pictures in the PDF were read.`);
    notes.push('PDF: headings, paragraphs and picture positions were rebuilt from the page layout. Check paragraph breaks and that every picture is in the right place.');
    // PDF authors are often the software or a user name ("Usertz"): only a
    // real-looking name is kept.
    const realAuthor = /^[\p{L}][\p{L}.'’-]*(\s+[\p{L}][\p{L}.'’-]*)+$/u.test(author) ? author : '';
    return { blocks, title, author: realAuthor, description: '', coverKey, warnings, notes };
};

// ---------- entry point ----------
const parseUpload = async (buffer, fileName, limits = importLimits()) => {
    if (buffer.length > limits.maxFileBytes) throw new ImportError(`The file is larger than ${limits.maxFileMb} MB.`, 413);
    let format = detectFormat(buffer, fileName);
    const imageStore = createImageStore(limits);
    let parsed;
    if (format === 'zip') {
        const ext = String(fileName).toLowerCase().endsWith('.epub') ? 'epub' : 'docx';
        format = ext;
        parsed = ext === 'epub' ? await parseEpub(buffer, limits, imageStore) : await parseDocx(buffer, limits, imageStore);
    } else if (format === 'pdf') parsed = await parsePdf(buffer, limits, imageStore);
    else if (format === 'markdown') parsed = parseMarkdown(buffer);
    else parsed = parseText(buffer);

    const split = splitIntoChapters(parsed.blocks, { bookTitle: parsed.title, guessedHeadings: format === 'pdf', longChapterWords: limits.longChapterWords });
    const chapters = split.chapters;
    if (!chapters.length) throw new ImportError('No text was found in the file.');
    if (chapters.length > limits.maxChapters) throw new ImportError(`The file has more than ${limits.maxChapters} chapters; split it into smaller books.`);
    const totalChars = chapters.reduce((sum, c) => sum + c.content.length, 0);
    if (totalChars > limits.maxTotalChars) throw new ImportError('The book is too long to import in one go.');

    const { images, skipped } = imageStore.result();
    // Only pictures still in the text (or the cover) are sent to the review screen.
    const used = new Set(chapters.flatMap((c) => [...c.content.matchAll(/kenlibs-import:([\w-]+)/g)].map((m) => m[1])));
    if (parsed.coverKey) used.add(parsed.coverKey);
    const keptImages = Object.fromEntries(Object.entries(images).filter(([key]) => used.has(key)));
    const warnings = [...split.warnings, ...parsed.warnings, ...skippedImageWarnings(skipped, limits)];
    return {
        format,
        title: tidyTitle(parsed.title || split.titleCandidate || fileTitle(fileName)).slice(0, 300),
        author: (parsed.author || '').slice(0, 200),
        description: parsed.description || '',
        chapters,
        images: keptImages,
        coverKey: parsed.coverKey || null,
        warnings,
        notes: [...parsed.notes, ...split.notes],
        needsSplit: split.needsSplit,
        longChapterWords: limits.longChapterWords,
        method: split.method,
        imageCount: chapters.reduce((sum, c) => sum + imageCount(c.content), 0),
    };
};

module.exports = { parseUpload, parseDocx, parseEpub, parseMarkdown, parseText, parsePdf };
