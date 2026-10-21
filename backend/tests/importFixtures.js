// Small book files generated in code for tests/bookImport.test.js (no
// binary fixtures in the repo). JSZip is already installed as a dependency
// of mammoth/docx; it's only used here, to build test archives.
const JSZip = require('jszip');
const PDFDocument = require('pdfkit');
const docx = require('docx');

// 1x1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const makeDocx = async () => {
    const { Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun } = docx;
    const doc = new Document({
        creator: 'Chinwe Okafor',
        title: 'Rivers of Lagos',
        sections: [
            {
                children: [
                    new Paragraph({ text: 'Chapter One: The Market', heading: HeadingLevel.HEADING_1 }),
                    new Paragraph({ children: [new TextRun('The market opened at dawn with '), new TextRun({ text: 'bold voices', bold: true }), new TextRun(' and '), new TextRun({ text: 'quiet deals', italics: true }), new TextRun('.')] }),
                    new Paragraph({ text: 'Fish sellers', bullet: { level: 0 } }),
                    new Paragraph({ text: 'Cloth traders', bullet: { level: 0 } }),
                    new Paragraph({ children: [new ImageRun({ type: 'png', data: PNG, transformation: { width: 10, height: 10 } })] }),
                    new Paragraph({ text: 'Chapter Two: The River', heading: HeadingLevel.HEADING_1 }),
                    new Paragraph('Boats crossed the lagoon all afternoon <script>alert(1)</script> without trouble.'),
                    new Paragraph({ text: 'A quiet aside', style: 'Quote' }),
                ],
            },
        ],
    });
    return Packer.toBuffer(doc);
};

const epubFiles = (extra = {}) => ({
    mimetype: 'application/epub+zip',
    'META-INF/container.xml':
        '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    'OEBPS/content.opf': `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>The Harmattan Letters</dc:title><dc:creator>Ade Bello</dc:creator><dc:description>&lt;p&gt;Letters from the dry season.&lt;/p&gt;</dc:description></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover" href="images/cover.png" media-type="image/png" properties="cover-image"/><item id="pic" href="images/pic.png" media-type="image/png"/><item id="c1" href="text/one.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="text/two.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`,
    'OEBPS/nav.xhtml':
        '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="text/one.xhtml">First Letter</a></li><li><a href="text/two.xhtml#start">Second Letter</a></li></ol></nav></body></html>',
    'OEBPS/text/one.xhtml':
        '<?xml version="1.0"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title><script>alert("x")</script></head><body><h1>First Letter</h1><p>Dear Amaka, the <em>dust</em> came early this year.</p><p><img src="../images/pic.png" alt="Dust"/></p><p><a href="javascript:steal()">click</a> and <a href="https://example.com">a real link</a>.</p></body></html>',
    'OEBPS/text/two.xhtml':
        '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><h2 id="start">Second Letter</h2><blockquote><p>Patience is a long road.</p></blockquote><ol><li>Water</li><li>Shade</li></ol><iframe src="https://evil.example"></iframe></body></html>',
    'OEBPS/images/cover.png': PNG,
    'OEBPS/images/pic.png': PNG,
    ...extra,
});

const zipOf = async (files, options = {}) => {
    const zip = new JSZip();
    for (const [name, content] of Object.entries(files)) zip.file(name, content, name === 'mimetype' ? { compression: 'STORE' } : {});
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', ...options });
};
const makeEpub = (extra) => zipOf(epubFiles(extra));

const makePdf = ({ pages = 2, text = true } = {}) =>
    new Promise((resolve) => {
        const doc = new PDFDocument({ info: { Title: 'Notes from Kano', Author: 'Musa Ibrahim' } });
        const chunks = [];
        doc.on('data', (c) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        for (let p = 0; p < pages; p++) {
            if (p > 0) doc.addPage();
            if (text) {
                doc.fontSize(18).text(`Chapter ${p + 1}`);
                doc.fontSize(11).text('The caravan moved slowly across the plain while the traders counted their goods and told old stories. '.repeat(8));
            } else {
                doc.rect(50, 50, 400, 600).fill('#888888'); // a "scanned" page: no text
            }
        }
        doc.end();
    });

// ---------- chapter-detection and picture fixtures ----------
const { encodePng } = require('../utils/import/png');

// A real w×h PNG in one colour; a different `shade` gives different bytes.
const makePng = (width = 40, height = 30, shade = 90) => encodePng({ width, height, channels: 3, data: Buffer.alloc(width * height * 3, shade) });
// A PNG cut off after its header: right signature, damaged file.
const CORRUPT_PNG = makePng(40, 30, 10).subarray(0, 40);

// `n` words of filler prose, in sentences.
const prose = (n, word = 'river') => `${Array.from({ length: n }, (_, i) => (i % 12 === 11 ? `${word}.` : word)).join(' ')}.`.replace(/\.\.$/, '.');

const docxOf = (children, { title = 'Test Book', creator = 'Test Author' } = {}) => docx.Packer.toBuffer(new docx.Document({ title, creator, sections: [{ children }] }));
const para = (text, { bold = false, heading } = {}) => new docx.Paragraph({ heading, children: [new docx.TextRun({ text, bold })] });
const picture = (data, description = '') =>
    new docx.Paragraph({ children: [new docx.ImageRun({ type: 'png', data, transformation: { width: 40, height: 30 }, altText: { name: 'picture', description, title: description } })] });

// Real Heading 1 structure, with named front/back matter and pictures (one
// used twice, one damaged).
const makeHeadingsDocx = () => {
    const H1 = docx.HeadingLevel.HEADING_1;
    const sunrise = makePng(40, 30, 200);
    return docxOf([
        para('Preface', { heading: H1 }),
        para(`Why I wrote this. ${prose(40)}`),
        para('Chapter 1: Dawn', { heading: H1 }),
        para(`Before the picture. ${prose(60)}`),
        picture(sunrise, 'A sunrise over Lagos'),
        para(`After the picture. ${prose(60)}`),
        para('A quiet street', { heading: docx.HeadingLevel.HEADING_2 }),
        para(prose(30)),
        picture(CORRUPT_PNG),
        para('Chapter 2: Noon', { heading: H1 }),
        para(`The same picture again. ${prose(50)}`),
        picture(sunrise, 'A sunrise over Lagos'),
        para('Epilogue', { heading: H1 }),
        para(prose(30)),
        para('About the Author', { heading: H1 }),
        para(`Ade writes about cities. ${prose(20)}`),
    ]);
};

// No heading styles at all: chapter lines are bold paragraphs, with a
// printed table of contents, a Part divider, named sections and a chapter
// title on the line after "Chapter One".
const WORDS = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];
const makePatternDocx = ({ chapters = 3, toc = true, style = 'words' } = {}) => {
    const label = (i) => (style === 'words' ? (i === 1 ? 'CHAPTER TWO: The River' : `Chapter ${WORDS[i]}`) : `Chapter ${i + 1}`);
    const children = [para('THE HARMATTAN', { bold: true }), para('Ade Bello')];
    if (toc) {
        children.push(para('Contents', { bold: true }), para('Preface ........ ix'));
        for (let i = 0; i < chapters; i++) children.push(para(`${label(i)} ........ ${i * 10 + 1}`));
        children.push(para('Acknowledgments ........ 98'), para('About the Author ........ 99'));
    }
    children.push(para('Preface', { bold: true }), para(`A word first. ${prose(40)}`), para('Part One', { bold: true }));
    for (let i = 0; i < chapters; i++) {
        children.push(para(label(i), { bold: true }));
        if (i === 0 && style === 'words') children.push(para('The Market', { bold: true }));
        children.push(para(`Text of chapter ${i + 1}. Chapter 3 was mentioned here in passing, and the Epilogue too. ${prose(80)}`));
    }
    children.push(para('Acknowledgments', { bold: true }), para(`Thanks to everyone. ${prose(20)}`), para('About the Author', { bold: true }), para(`Ade lives in Lagos. ${prose(20)}`));
    return docxOf(children, { title: '' });
};

// EPUB: front matter, two chapters inside one file (contents entries point
// at anchors), back matter, a cover page, a captioned picture, an SVG and a
// damaged picture.
const makeRichEpub = () =>
    zipOf({
        mimetype: 'application/epub+zip',
        'META-INF/container.xml':
            '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
        'OEBPS/content.opf': `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Lagos Stories</dc:title><dc:creator>Ngozi Eze</dc:creator></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover" href="images/cover.png" media-type="image/png" properties="cover-image"/><item id="coverpage" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="front" href="front.xhtml" media-type="application/xhtml+xml"/><item id="ch" href="chapters.xhtml" media-type="application/xhtml+xml"/><item id="back" href="back.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="coverpage"/><itemref idref="front"/><itemref idref="ch"/><itemref idref="back"/></spine></package>`,
        'OEBPS/nav.xhtml':
            '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="front.xhtml">Dedication</a></li><li><a href="chapters.xhtml#c1">Chapter 1: Arrival</a></li><li><a href="chapters.xhtml#c2">Chapter 2: The Bridge</a></li><li><a href="back.xhtml">Afterword</a></li></ol></nav></body></html>',
        'OEBPS/cover.xhtml': '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><img src="images/cover.png" alt="Cover"/></body></html>',
        'OEBPS/front.xhtml': '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Dedication</h1><p>For my mother, who told the first stories.</p></body></html>',
        'OEBPS/chapters.xhtml': `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><section id="c1"><h1>Chapter 1: Arrival</h1><p>The bus came in at night. ${prose(40)}</p><figure><img src="images/bridge.png"/><figcaption>The Third Mainland Bridge</figcaption></figure><p>Morning came. ${prose(30)}</p><p><img src="images/logo.svg" alt="logo"/></p><p><img src="images/bad.png" alt="bad"/></p></section><section id="c2"><h1>Chapter 2: The Bridge</h1><p>Traffic, always. ${prose(40)}</p></section></body></html>`,
        'OEBPS/back.xhtml': '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Afterword</h1><p>Thank you for reading these stories.</p></body></html>',
        'OEBPS/images/cover.png': makePng(60, 90, 30),
        'OEBPS/images/bridge.png': makePng(80, 40, 120),
        'OEBPS/images/logo.svg': '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        'OEBPS/images/bad.png': CORRUPT_PNG,
    });

// PDF laid out like a printed book: a running header with a page number, a
// title in big type, indented paragraphs and a picture between two
// paragraphs.
const makeLayoutPdf = () =>
    new Promise((resolve) => {
        const doc = new PDFDocument({ size: [380, 540], margins: { top: 60, bottom: 60, left: 50, right: 50 }, info: { Title: 'The Test Tales', Author: 'Musa Ibrahim' } });
        const chunks = [];
        doc.on('data', (c) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        const body = (text) => doc.font('Helvetica').fontSize(11).text(text, { indent: 12, align: 'left', width: 280 });
        const chapter = (n, title) => {
            if (n > 1) doc.addPage();
            doc.font('Helvetica').fontSize(9).text(`${n * 10} THE TEST TALES`, 50, 30, { lineBreak: false });
            doc.font('Helvetica-Bold').fontSize(22).text(title, 50, 80, { width: 280 });
            doc.moveDown(1);
        };
        chapter(1, 'The First Tale');
        body(`It began at the market, where the traders were already shouting their prices. ${prose(50)}`);
        doc.moveDown(0.5);
        doc.image(makePng(120, 60, 160), { width: 120 });
        doc.moveDown(0.5);
        body(`After the picture the story went on. ${prose(40)}`);
        chapter(2, 'The Second Tale');
        body(`A new day. ${prose(60)}`);
        doc.end();
    });

module.exports = { PNG, makeDocx, makeEpub, epubFiles, zipOf, makePdf, makePng, CORRUPT_PNG, prose, docxOf, para, makeHeadingsDocx, makePatternDocx, makeRichEpub, makeLayoutPdf };
