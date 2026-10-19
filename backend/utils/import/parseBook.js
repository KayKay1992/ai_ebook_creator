const path = require('path').posix;
const MarkdownIt = require('markdown-it');
const mammoth = require('mammoth');
const { DOMParser } = require('@xmldom/xmldom');
const { detectFormat, ImportError } = require('./fileType');
const { readZip, detectZipFormat } = require('./zipSafe');
const { htmlToBlocks, stripDoctype } = require('./htmlToMarkdown');
const { splitIntoChapters, wordCount } = require('./chapters');
const { createImageStore } = require('./images');
const { extractPdfText } = require('./pdfText');
const { importLimits } = require('./limits');

// "Import a book": parses an uploaded .docx / .epub / .pdf / .md / .txt
// (already in memory; the original file is never stored) into a draft for
// the review screen:
//   { format, title, author, description, chapters: [{ title, content,
//     wordCount }], images: { key: { contentType, bytes, dataUri } },
//     coverKey, warnings: [] }
// Chapter content is Markdown; images are `kenlibs-import:<key>`
// placeholders until the book is saved (importController.commitImport).

const quiet = { warning() {}, error() {}, fatalError() {} };
const parseXml = (text) => new DOMParser({ errorHandler: quiet }).parseFromString(stripDoctype(text), 'application/xml');
const byLocalName = (node, name) => Array.from(node.getElementsByTagName('*')).filter((el) => (el.localName || el.nodeName) === name || el.nodeName.endsWith(`:${name}`));
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
    const result = await mammoth.convertToHtml(
        { buffer },
        {
            // Images become placeholders; external/linked images are dropped.
            convertImage: mammoth.images.imgElement((image) =>
                image.read().then((data) => {
                    const key = imageStore.add(Buffer.from(data));
                    return { src: key ? `kenlibs-import:${key}` : '' };
                })
            ),
            ignoreEmptyParagraphs: true,
            // Word's quote styles become block quotes.
            styleMap: ["p[style-name='Quote'] => blockquote > p:fresh", "p[style-name='Intense Quote'] => blockquote > p:fresh", 'p.Quote => blockquote > p:fresh', 'p.IntenseQuote => blockquote > p:fresh'],
        }
    );
    const blocks = htmlToBlocks(result.value, { resolveImage: (src) => (src.startsWith('kenlibs-import:') ? src.slice(15) : '') });
    return { blocks, title, author, description: '', coverKey: null, warnings: [] };
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
    const resolve = (from, href) => {
        const clean = decodeURIComponent(String(href || '').split('#')[0]);
        if (!clean || /^[a-z]+:/i.test(clean)) return null;
        const joined = path.normalize(path.join(from === '.' ? '' : from, clean));
        return joined.startsWith('..') ? null : joined.replace(/^\.\//, '');
    };

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

    // Table of contents: EPUB 3 nav, else EPUB 2 NCX. file → first label.
    const tocLabels = new Map();
    const navItem = [...manifest.values()].find((m) => m.properties.split(/\s+/).includes('nav'));
    if (navItem && read(navItem.href)) {
        const nav = parseXml(read(navItem.href));
        for (const a of byLocalName(nav, 'a')) {
            const file = resolve(path.dirname(navItem.href), a.getAttribute('href'));
            const label = a.textContent.replace(/\s+/g, ' ').trim();
            if (file && label && !tocLabels.has(file)) tocLabels.set(file, label);
        }
    } else {
        const tocId = byLocalName(opf, 'spine')[0]?.getAttribute('toc');
        const ncxItem = manifest.get(tocId) || [...manifest.values()].find((m) => m.type === 'application/x-dtbncx+xml');
        if (ncxItem && read(ncxItem.href)) {
            const ncx = parseXml(read(ncxItem.href));
            for (const point of byLocalName(ncx, 'navPoint')) {
                const label = firstText(point, 'text');
                const src = byLocalName(point, 'content')[0]?.getAttribute('src');
                const file = resolve(path.dirname(ncxItem.href), src);
                if (file && label && !tocLabels.has(file)) tocLabels.set(file, label);
            }
        }
    }

    // Cover image (EPUB 3 property or EPUB 2 <meta name="cover">).
    let coverKey = null;
    const coverMetaId = byLocalName(opf, 'meta').find((m) => m.getAttribute('name') === 'cover')?.getAttribute('content');
    const coverItem = [...manifest.values()].find((m) => m.properties.split(/\s+/).includes('cover-image')) || manifest.get(coverMetaId);
    if (coverItem && IMAGE_EXT.test(coverItem.href || '') && zip.files.get(coverItem.href)) {
        coverKey = imageStore.add(zip.files.get(coverItem.href));
    }

    // Spine order; one chapter per document (TOC label, else its first heading).
    const chapters = [];
    const warnings = [];
    let order = 0;
    for (const ref of byLocalName(opf, 'itemref')) {
        if (ref.getAttribute('linear') === 'no') continue;
        const item = manifest.get(ref.getAttribute('idref'));
        if (!item || !/html|xml/.test(item.type) || !item.href) continue;
        const source = read(item.href);
        if (!source) continue;
        const dir = path.dirname(item.href);
        const blocks = htmlToBlocks(source, {
            xhtml: true,
            resolveImage: (src) => {
                const file = resolve(dir, src);
                if (!file || !IMAGE_EXT.test(file) || !zip.files.get(file)) return '';
                if (coverItem && file === coverItem.href) return coverKey || '';
                return imageStore.add(zip.files.get(file)) || '';
            },
        });
        const textBlocks = blocks.filter((b) => b.kind !== 'image');
        if (!textBlocks.length) continue; // cover page, image-only page
        order++;
        const firstHeading = blocks.find((b) => b.kind === 'heading');
        const chapterTitle = tocLabels.get(item.href) || firstHeading?.text || `Chapter ${order}`;
        // Drop a leading heading that just repeats the chapter title.
        const body = blocks[0]?.kind === 'heading' && blocks[0].text.toLowerCase() === chapterTitle.toLowerCase() ? blocks.slice(1) : blocks;
        const content = body.map((b) => b.markdown).join('\n\n').trim();
        chapters.push({ title: chapterTitle.slice(0, 300), content, wordCount: wordCount(content) });
    }
    if (!chapters.length) warnings.push('No readable chapters were found in this .epub.');
    return { chapters, title, author, description, coverKey, warnings };
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
    const warnings = externalImages ? [`${externalImages} image link${externalImages === 1 ? ' was' : 's were'} left out of the Markdown (upload images in the editor instead).`] : [];
    return { blocks, title: '', author: '', description: '', coverKey: null, warnings };
};

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Plain text: blank lines separate paragraphs.
const paragraphsToHtml = (paragraphs) => paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('');
const parseText = (buffer) => {
    const text = new TextDecoder('utf-8').decode(buffer).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    const paragraphs = text.split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
    return { blocks: htmlToBlocks(paragraphsToHtml(paragraphs)), title: '', author: '', description: '', coverKey: null, warnings: [] };
};

// ---------- .pdf (text only) ----------
const parsePdf = async (buffer) => {
    const { totalPages, pages, title, author } = await extractPdfText(buffer);
    const allText = pages.join('\n');
    const chars = allText.replace(/\s/g, '').length;
    const warnings = [];
    if (chars < 50) {
        throw new ImportError('This PDF has almost no text. It looks scanned (pictures of pages); run it through OCR first or use a .docx/.epub.');
    }
    if (chars / Math.max(totalPages, 1) < 200) {
        warnings.push(`This PDF has very little text for ${totalPages} page${totalPages === 1 ? '' : 's'}. It may be partly scanned; check the chapters carefully.`);
    }
    if (pages.length < totalPages) warnings.push(`Only the first ${pages.length} pages were read.`);
    // Lines → paragraphs: a line that ends a sentence and is clearly shorter
    // than the page's usual line length ends its paragraph.
    const paragraphs = [];
    for (const page of pages) {
        const lines = page.split('\n').map((l) => l.trim()).filter(Boolean);
        const lengths = lines.map((l) => l.length).sort((a, b) => a - b);
        const typical = lengths[Math.floor(lengths.length * 0.75)] || 0;
        let current = '';
        for (const line of lines) {
            if (/^\d{1,4}$/.test(line)) continue; // page numbers
            current = current ? `${current} ${line}` : line;
            const shortLine = line.length < typical * 0.7;
            if ((shortLine && /[.!?:"”’)]$/.test(line)) || (shortLine && line.length <= 80 && /^(chapter|part)\b/i.test(line))) {
                paragraphs.push(current);
                current = '';
            }
        }
        if (current) paragraphs.push(current);
    }
    warnings.push('PDF import keeps text only: check paragraph breaks, and add images in the editor.');
    return { blocks: htmlToBlocks(paragraphsToHtml(paragraphs)), title, author, description: '', coverKey: null, warnings };
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
    } else if (format === 'pdf') parsed = await parsePdf(buffer);
    else if (format === 'markdown') parsed = parseMarkdown(buffer);
    else parsed = parseText(buffer);

    let chapters = parsed.chapters;
    let titleCandidate = '';
    if (!chapters) {
        const split = splitIntoChapters(parsed.blocks, { defaultTitle: 'Chapter 1' });
        chapters = split.chapters;
        titleCandidate = split.titleCandidate;
    }
    if (!chapters.length) throw new ImportError('No text was found in the file.');
    if (chapters.length > limits.maxChapters) throw new ImportError(`The file has more than ${limits.maxChapters} chapters; split it into smaller books.`);
    const totalChars = chapters.reduce((sum, c) => sum + c.content.length, 0);
    if (totalChars > limits.maxTotalChars) throw new ImportError('The book is too long to import in one go.');

    const { images, skipped } = imageStore.result();
    const warnings = [...parsed.warnings];
    if (skipped) warnings.push(`${skipped} image${skipped === 1 ? ' was' : 's were'} left out (unsupported type, or too large).`);
    return {
        format,
        title: (parsed.title || titleCandidate || fileTitle(fileName)).slice(0, 300),
        author: (parsed.author || '').slice(0, 200),
        description: parsed.description || '',
        chapters,
        images,
        coverKey: parsed.coverKey || null,
        warnings,
    };
};

module.exports = { parseUpload, parseDocx, parseEpub, parseMarkdown, parseText, parsePdf };
