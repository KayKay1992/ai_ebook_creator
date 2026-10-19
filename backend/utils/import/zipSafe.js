const yauzl = require('yauzl');
const { ImportError } = require('./fileType');

// Reads a .docx/.epub archive defensively before anything else touches it:
//   - at most maxZipEntries entries;
//   - no absolute paths, no "..", no backslashes or drive letters, at most
//     maxZipDepth folders deep;
//   - every entry's DECLARED and ACTUAL inflated size is checked against
//     maxZipEntryBytes, and the running total against maxZipTotalBytes
//     (bytes are counted while inflating, and yauzl's validateEntrySizes
//     rejects entries that inflate to more than they claim), so a zip bomb
//     is stopped early instead of filling memory;
//   - nested archives are never opened.
// Returns { names: [...], files: Map(name -> Buffer) } where `files` holds
// only the entries `keep(name)` asks for (the rest are inflated, counted
// and discarded).

const isUnsafePath = (name) =>
    name.startsWith('/') || name.includes('\\') || /^[a-zA-Z]:/.test(name) || name.split('/').some((part) => part === '..');

const readZip = (buffer, limits, keep = () => true) =>
    new Promise((resolve, reject) => {
        yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true, strictFileNames: false }, (openError, zip) => {
            if (openError) return reject(new ImportError("The file is damaged or isn't a valid .docx/.epub archive."));
            const names = [];
            const files = new Map();
            let total = 0;
            let failed = false;
            const fail = (message) => {
                if (failed) return;
                failed = true;
                zip.close();
                reject(new ImportError(message));
            };
            zip.on('error', () => fail("The file is damaged or isn't a valid archive."));
            zip.on('end', () => {
                if (!failed) resolve({ names, files });
            });
            zip.on('entry', (entry) => {
                if (failed) return;
                const name = entry.fileName;
                if (names.length >= limits.maxZipEntries) return fail('The file contains too many parts to import.');
                if (isUnsafePath(name)) return fail('The file contains an unsafe path and was rejected.');
                if (name.split('/').length - 1 > limits.maxZipDepth) return fail('The file is nested too deeply to import.');
                names.push(name);
                if (name.endsWith('/')) return zip.readEntry(); // folder
                if (entry.uncompressedSize > limits.maxZipEntryBytes) return fail('A part of the file is too large to import.');
                if (total + entry.uncompressedSize > limits.maxZipTotalBytes) return fail('The file is too large once unpacked.');
                zip.openReadStream(entry, (streamError, stream) => {
                    if (streamError) return fail("The file is damaged and couldn't be read.");
                    const chunks = [];
                    let size = 0;
                    const wanted = keep(name);
                    stream.on('data', (chunk) => {
                        size += chunk.length;
                        total += chunk.length;
                        if (size > limits.maxZipEntryBytes || total > limits.maxZipTotalBytes) {
                            stream.destroy();
                            return fail('The file is too large once unpacked.');
                        }
                        if (wanted) chunks.push(chunk);
                    });
                    stream.on('error', () => fail("The file is damaged and couldn't be read."));
                    stream.on('end', () => {
                        if (failed) return;
                        if (wanted) files.set(name, Buffer.concat(chunks));
                        zip.readEntry();
                    });
                });
            });
            zip.readEntry();
        });
    });

// 'docx' | 'epub' from the archive's real contents.
const detectZipFormat = ({ names, files }) => {
    const mimetype = files.get('mimetype');
    if (mimetype && mimetype.toString('utf8').trim() === 'application/epub+zip') return 'epub';
    if (names.includes('[Content_Types].xml') && names.includes('word/document.xml')) return 'docx';
    return null;
};

module.exports = { readZip, detectZipFormat, isUnsafePath };
