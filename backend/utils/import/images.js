const { ImportError } = require('./fileType');

// Collects images found inside an imported file (docx media, epub images)
// for the review screen, then Cloudinary on save. Only real raster images
// are kept (PNG, JPEG, GIF, WebP, checked by their bytes; never SVG, which
// can carry scripts), with per-image and total size caps.
const SIGNATURES = [
    ['image/png', [0x89, 0x50, 0x4e, 0x47]],
    ['image/jpeg', [0xff, 0xd8, 0xff]],
    ['image/gif', [0x47, 0x49, 0x46, 0x38]],
];
const imageTypeOf = (buffer) => {
    for (const [type, sig] of SIGNATURES) if (sig.every((b, i) => buffer[i] === b)) return type;
    if (buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
    return null;
};

const createImageStore = (limits) => {
    const images = {};
    let count = 0;
    let total = 0;
    let skipped = 0;
    return {
        // Returns a key for the image, or null if it was skipped.
        add(buffer) {
            if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null;
            const type = imageTypeOf(buffer);
            if (!type || buffer.length > limits.maxImageBytes || count >= limits.maxImages || total + buffer.length > limits.maxTotalImageBytes) {
                skipped++;
                return null;
            }
            count++;
            total += buffer.length;
            const key = `img${count}`;
            images[key] = { contentType: type, bytes: buffer.length, dataUri: `data:${type};base64,${buffer.toString('base64')}` };
            return key;
        },
        result: () => ({ images, skipped }),
    };
};

// Decodes a data URI sent back by the review screen; only our own image
// types, only within the caps.
const decodeImageDataUri = (dataUri, limits) => {
    const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUri || ''));
    if (!match) throw new ImportError('An image in the import is not valid.');
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length > limits.maxImageBytes || imageTypeOf(buffer) !== match[1]) throw new ImportError('An image in the import is not valid.');
    return buffer;
};

module.exports = { createImageStore, imageTypeOf, decodeImageDataUri };
