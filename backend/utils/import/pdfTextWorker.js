// Runs in a worker thread (utils/import/pdfText.js): extracts the text of a
// PDF with unpdf (a serverless build of Mozilla's PDF.js). Only text is
// read: no scripts, forms or embedded files are executed, and the worker
// has a memory cap and is terminated if it takes too long, so a hostile or
// huge PDF can't hang or exhaust the server.
const { parentPort, workerData } = require('worker_threads');

(async () => {
    try {
        const { getDocumentProxy } = require('unpdf');
        const pdf = await getDocumentProxy(new Uint8Array(workerData.buffer), {
            isEvalSupported: false,
            disableFontFace: true,
            useSystemFonts: false,
            verbosity: 0,
        });
        const pages = Math.min(pdf.numPages, workerData.maxPages);
        const texts = [];
        for (let i = 1; i <= pages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            // Rebuild lines: PDF.js gives positioned text runs; hasEOL marks
            // line ends.
            let line = '';
            const lines = [];
            for (const item of content.items) {
                if (typeof item.str !== 'string') continue;
                line += item.str;
                if (item.hasEOL) {
                    lines.push(line);
                    line = '';
                }
            }
            if (line) lines.push(line);
            texts.push(lines.join('\n'));
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
        parentPort.postMessage({ ok: true, totalPages: pdf.numPages, pages: texts, title, author });
        await pdf.destroy();
    } catch (error) {
        parentPort.postMessage({ ok: false, error: String(error?.message || error) });
    }
})();
