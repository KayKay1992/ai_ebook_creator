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

module.exports = { PNG, makeDocx, makeEpub, epubFiles, zipOf, makePdf };
