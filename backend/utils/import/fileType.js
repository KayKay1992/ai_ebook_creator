// Works out what an uploaded file really is from its bytes (magic numbers),
// never from its name or the browser's MIME type alone. Returns
// 'pdf' | 'docx' | 'epub' | 'markdown' | 'text' or throws ImportError.
// docx vs epub are both ZIPs; they're told apart by their contents in
// detectZipFormat (zipSafe.js) once the archive has been checked.

class ImportError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.name = 'ImportError';
        this.status = status;
    }
}

const startsWith = (buffer, bytes) => buffer.length >= bytes.length && bytes.every((b, i) => buffer[i] === b);

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const ZIP = [0x50, 0x4b, 0x03, 0x04]; // PK\x03\x04
const ZIP_EMPTY = [0x50, 0x4b, 0x05, 0x06];
// Formats we must never accept even with a text-looking extension.
const BLOCKED = [
    [0x4d, 0x5a], // MZ: Windows executable
    [0x7f, 0x45, 0x4c, 0x46], // ELF
    [0xcf, 0xfa, 0xed, 0xfe], // Mach-O
    [0xd0, 0xcf, 0x11, 0xe0], // old Office (.doc): not supported
    [0x1f, 0x8b], // gzip
    [0x52, 0x61, 0x72, 0x21], // RAR
    [0x37, 0x7a, 0xbc, 0xaf], // 7z
];

const extensionOf = (name = '') => (String(name).toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';

// Valid UTF-8 (optionally with a BOM) with no NUL bytes and few control
// characters: plain text or Markdown.
const looksLikeText = (buffer) => {
    if (buffer.includes(0)) return false;
    let text;
    try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
        return false;
    }
    const sample = text.slice(0, 20000);
    const controls = (sample.match(/[\u0001-\u0008\u000b\u000c\u000e-\u001f]/g) || []).length;
    return controls <= sample.length * 0.01;
};

const detectFormat = (buffer, fileName) => {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new ImportError('The file is empty.');
    const ext = extensionOf(fileName);
    if (BLOCKED.some((sig) => startsWith(buffer, sig))) {
        throw new ImportError(ext === 'doc' ? 'Old Word (.doc) files aren\'t supported. Save it as .docx and try again.' : 'That file type isn\'t supported.');
    }
    if (startsWith(buffer, PDF)) {
        if (ext && ext !== 'pdf') throw new ImportError(`This is a PDF, but it's named .${ext}. Rename it to .pdf and try again.`);
        return 'pdf';
    }
    if (startsWith(buffer, ZIP) || startsWith(buffer, ZIP_EMPTY)) {
        if (!['docx', 'epub'].includes(ext)) throw new ImportError('That archive isn\'t a .docx or .epub file.');
        return 'zip';
    }
    if (['md', 'markdown', 'txt', 'text'].includes(ext)) {
        if (!looksLikeText(buffer)) throw new ImportError('That file doesn\'t look like plain text.');
        return ext === 'txt' || ext === 'text' ? 'text' : 'markdown';
    }
    throw new ImportError('Unsupported file. Upload a .docx, .epub, .pdf, .md or .txt file.');
};

module.exports = { detectFormat, extensionOf, looksLikeText, ImportError };
