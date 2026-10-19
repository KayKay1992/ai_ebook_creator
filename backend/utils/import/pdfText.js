const path = require('path');
const { Worker } = require('worker_threads');

// Extract a PDF's text in a worker thread with a memory cap and a timeout
// (see pdfTextWorker.js). Resolves { totalPages, pages: [text], title,
// author } or rejects with a readable error.
const PDF_TIMEOUT_MS = 30000;
const PDF_MAX_PAGES = 2000;
const PDF_WORKER_MEMORY_MB = 256;

const extractPdfText = (buffer, { timeoutMs = PDF_TIMEOUT_MS, maxPages = PDF_MAX_PAGES } = {}) =>
    new Promise((resolve, reject) => {
        const worker = new Worker(path.join(__dirname, 'pdfTextWorker.js'), {
            workerData: { buffer, maxPages },
            resourceLimits: { maxOldGenerationSizeMb: PDF_WORKER_MEMORY_MB, maxYoungGenerationSizeMb: 64 },
        });
        let settled = false;
        const finish = (fn, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            worker.terminate().catch(() => {});
            fn(value);
        };
        const timer = setTimeout(() => finish(reject, new Error('Reading the PDF took too long.')), timeoutMs);
        worker.once('message', (message) =>
            message.ok ? finish(resolve, message) : finish(reject, new Error(`Couldn't read the PDF: ${message.error}`))
        );
        worker.once('error', (error) => finish(reject, new Error(`Couldn't read the PDF: ${error.message}`)));
        worker.once('exit', (code) => finish(reject, new Error(`Couldn't read the PDF (stopped with code ${code}).`)));
    });

module.exports = { extractPdfText, PDF_TIMEOUT_MS, PDF_MAX_PAGES };
