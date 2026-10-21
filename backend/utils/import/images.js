const crypto = require('crypto');
const { ImportError } = require('./fileType');

// Collects images found inside an imported file (docx media, epub images,
// pictures in a PDF) for the review screen, then Cloudinary on save
// (importController.commitImport). Only real raster images are kept: PNG,
// JPEG, GIF and WebP, recognised by their bytes and with a readable size in
// their header (never SVG, which can carry scripts; a damaged file is left
// out). The same picture used twice is stored once (sha256), and there are
// caps per image, on the number of images and on their total size
// (utils/import/limits.js).

const SIGNATURES = [
    ['image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
    ['image/jpeg', [0xff, 0xd8, 0xff]],
    ['image/gif', [0x47, 0x49, 0x46, 0x38]],
];
const imageTypeOf = (buffer) => {
    if (!Buffer.isBuffer(buffer)) return null;
    for (const [type, sig] of SIGNATURES) if (buffer.length >= sig.length && sig.every((b, i) => buffer[i] === b)) return type;
    if (buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
    return null;
};

// Width and height from the header, or null if it isn't readable (a
// truncated or damaged file).
const jpegSize = (buffer) => {
    let i = 2;
    while (i + 9 < buffer.length) {
        if (buffer[i] !== 0xff) return null;
        const marker = buffer[i + 1];
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
            i += 2;
            continue;
        }
        const length = buffer.readUInt16BE(i + 2);
        if (length < 2) return null;
        // SOF0-SOF15, except DHT (C4), JPG (C8) and DAC (CC).
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
            return { height: buffer.readUInt16BE(i + 5), width: buffer.readUInt16BE(i + 7) };
        }
        i += 2 + length;
    }
    return null;
};
const imageInfo = (buffer) => {
    const type = imageTypeOf(buffer);
    if (!type) return null;
    let size = null;
    try {
        if (type === 'image/png' && buffer.length >= 33 && buffer.toString('ascii', 12, 16) === 'IHDR') {
            size = { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
            if (buffer.toString('ascii', buffer.length - 8, buffer.length - 4) !== 'IEND') size = null; // truncated
        } else if (type === 'image/gif' && buffer.length >= 10) {
            size = { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
        } else if (type === 'image/jpeg') {
            size = jpegSize(buffer);
        } else if (type === 'image/webp' && buffer.length >= 30) {
            const chunk = buffer.toString('ascii', 12, 16);
            if (chunk === 'VP8X') size = { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
            else if (chunk === 'VP8 ') size = { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
            else if (chunk === 'VP8L') {
                const bits = buffer.readUInt32LE(21);
                size = { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
            }
        }
    } catch {
        size = null;
    }
    if (!size || !size.width || !size.height || size.width > 30000 || size.height > 30000) return null;
    return { type, ...size };
};

const createImageStore = (limits) => {
    const images = {};
    const byHash = new Map();
    let count = 0;
    let total = 0;
    const skipped = { invalid: 0, tooLarge: 0, tooMany: 0 };
    return {
        // Returns a key for the image, or null if it was left out.
        add(buffer) {
            if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null;
            const hash = crypto.createHash('sha256').update(buffer).digest('hex');
            if (byHash.has(hash)) return byHash.get(hash);
            const info = imageInfo(buffer);
            if (!info) {
                skipped.invalid++;
                return null;
            }
            if (buffer.length > limits.maxImageBytes) {
                skipped.tooLarge++;
                return null;
            }
            if (count >= limits.maxImages || total + buffer.length > limits.maxTotalImageBytes) {
                skipped.tooMany++;
                return null;
            }
            count++;
            total += buffer.length;
            const key = `img${count}`;
            byHash.set(hash, key);
            images[key] = { contentType: info.type, bytes: buffer.length, width: info.width, height: info.height, dataUri: `data:${info.type};base64,${buffer.toString('base64')}` };
            return key;
        },
        has: (key) => Boolean(images[key]),
        remove(key) {
            if (!images[key]) return;
            total -= images[key].bytes;
            delete images[key];
            for (const [hash, k] of byHash) if (k === key) byHash.delete(hash);
        },
        result: () => ({ images, skipped }),
    };
};

// Warnings for the review screen about images that were left out.
const skippedImageWarnings = (skipped, limits) => {
    const out = [];
    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    if (skipped.invalid) out.push(`${plural(skipped.invalid, 'picture was', 'pictures were')} left out: not a PNG, JPEG, GIF or WebP, or damaged.`);
    if (skipped.tooLarge) out.push(`${plural(skipped.tooLarge, 'picture was', 'pictures were')} left out: larger than ${Math.round(limits.maxImageBytes / 1024 / 1024)} MB.`);
    if (skipped.tooMany) out.push(`${plural(skipped.tooMany, 'picture was', 'pictures were')} left out: the import allows ${limits.maxImages} pictures and ${Math.round(limits.maxTotalImageBytes / 1024 / 1024)} MB in total.`);
    return out;
};

// Decodes a data URI sent back by the review screen; only our own image
// types, only within the caps.
const decodeImageDataUri = (dataUri, limits) => {
    const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUri || ''));
    if (!match) throw new ImportError('An image in the import is not valid.');
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length > limits.maxImageBytes || imageInfo(buffer)?.type !== match[1]) throw new ImportError('An image in the import is not valid.');
    return buffer;
};

module.exports = { createImageStore, imageTypeOf, imageInfo, skippedImageWarnings, decodeImageDataUri };
