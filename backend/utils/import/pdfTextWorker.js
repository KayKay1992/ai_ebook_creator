// Runs in a worker thread (utils/import/pdfText.js): reads a PDF with unpdf
// (a serverless build of Mozilla's PDF.js). Only text and pictures are
// read: no scripts, forms or embedded files are executed, and the worker
// has a memory cap and is terminated if it takes too long, so a hostile or
// huge PDF can't hang or exhaust the server.
// Per page it returns the text runs with their position and size (so
// utils/import/pdfLayout.js can find headings, paragraphs and running
// headers) and the pictures drawn on it, encoded as PNG, with where they
// sit on the page.
const { parentPort, workerData } = require('worker_threads');
const { encodePng } = require('./png');

const IMAGE_TIMEOUT_MS = 3000;
const MAX_IMAGE_PIXELS = 25 * 1000 * 1000;

// PDF matrix product (as PDF.js's Util.transform).
const multiply = (m1, m2) => [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
];

// PDF.js image objects: kind 1 = 1 bit grey, 2 = RGB, 3 = RGBA.
const toPixels = (image) => {
    const { width, height, data, kind } = image;
    if (!data || !width || !height || width * height > MAX_IMAGE_PIXELS) return null;
    if (kind === 1 || data.length === Math.ceil(width / 8) * height) {
        const rowBytes = Math.ceil(width / 8);
        const grey = new Uint8Array(width * height);
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) grey[y * width + x] = data[y * rowBytes + (x >> 3)] & (0x80 >> (x & 7)) ? 255 : 0;
        return { width, height, channels: 1, data: grey };
    }
    const channels = data.length / (width * height);
    return [1, 3, 4].includes(channels) ? { width, height, channels, data } : null;
};

const getObject = (page, id) =>
    new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), IMAGE_TIMEOUT_MS);
        try {
            (id.startsWith('g_') ? page.commonObjs : page.objs).get(id, (obj) => {
                clearTimeout(timer);
                resolve(obj);
            });
        } catch {
            clearTimeout(timer);
            resolve(null);
        }
    });

(async () => {
    try {
        const { getDocumentProxy, getResolvedPDFJS } = require('unpdf');
        const pdf = await getDocumentProxy(new Uint8Array(workerData.buffer), {
            isEvalSupported: false,
            isOffscreenCanvasSupported: false,
            disableFontFace: true,
            useSystemFonts: false,
            verbosity: 0,
        });
        const { OPS } = await getResolvedPDFJS();
        const pageCount = Math.min(pdf.numPages, workerData.maxPages);
        const maxImages = workerData.maxImages ?? 0;
        let imagesTaken = 0;
        let imageFailures = 0;
        const pages = [];
        for (let i = 1; i <= pageCount; i++) {
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: 1 });
            const content = await page.getTextContent();
            const items = [];
            for (const item of content.items) {
                if (typeof item.str !== 'string' || !item.str) continue;
                const t = item.transform;
                const size = Math.hypot(t[2], t[3]) || item.height || 0;
                items.push([item.str, t[4], t[5], item.width || 0, Math.round(size * 10) / 10, item.fontName || '']);
            }
            const images = [];
            if (imagesTaken < maxImages) {
                const ops = await page.getOperatorList();
                let ctm = [1, 0, 0, 1, 0, 0];
                const stack = [];
                for (let k = 0; k < ops.fnArray.length && imagesTaken < maxImages; k++) {
                    const fn = ops.fnArray[k];
                    const args = ops.argsArray[k];
                    if (fn === OPS.save) stack.push(ctm);
                    else if (fn === OPS.restore) ctm = stack.pop() || ctm;
                    else if (fn === OPS.transform) ctm = multiply(ctm, args);
                    else if (fn === OPS.paintFormXObjectBegin) {
                        stack.push(ctm);
                        if (Array.isArray(args[0]) && args[0].length === 6) ctm = multiply(ctm, args[0]);
                    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || ctm;
                    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
                        const obj = fn === OPS.paintImageXObject ? await getObject(page, String(args[0])) : args[0];
                        const pixels = obj && toPixels(obj);
                        if (!pixels) {
                            imageFailures++;
                            continue;
                        }
                        // Where the unit square lands on the page.
                        const ys = [ctm[5], ctm[5] + ctm[1], ctm[5] + ctm[3], ctm[5] + ctm[1] + ctm[3]];
                        const xs = [ctm[4], ctm[4] + ctm[0], ctm[4] + ctm[2], ctm[4] + ctm[0] + ctm[2]];
                        let png;
                        try {
                            png = encodePng(pixels);
                        } catch {
                            imageFailures++;
                            continue;
                        }
                        imagesTaken++;
                        images.push({ top: Math.max(...ys), bottom: Math.min(...ys), left: Math.min(...xs), right: Math.max(...xs), width: pixels.width, height: pixels.height, png });
                    }
                }
            }
            pages.push({ width: viewport.width, height: viewport.height, items, images });
            page.cleanup();
        }
        let title = '';
        let author = '';
        try {
            const meta = await pdf.getMetadata();
            title = String(meta?.info?.Title || '').trim();
            author = String(meta?.info?.Author || '').trim();
        } catch {
            /* no metadata */
        }
        parentPort.postMessage({ ok: true, totalPages: pdf.numPages, pages, title, author, imageFailures, imageLimitReached: imagesTaken >= maxImages && maxImages > 0 });
        await pdf.destroy();
    } catch (error) {
        parentPort.postMessage({ ok: false, error: String(error?.message || error) });
    }
})();
