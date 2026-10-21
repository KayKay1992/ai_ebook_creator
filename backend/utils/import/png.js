const zlib = require('zlib');

// Encodes raw pixels (from a PDF, utils/import/pdfTextWorker.js) as a PNG
// with Node's own zlib: no image library needed. `channels` is 1 (grey),
// 3 (RGB) or 4 (RGBA), 8 bits each.
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});
const crc32 = (buffer) => {
    let c = 0xffffffff;
    for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
};
const COLOR_TYPE = { 1: 0, 3: 2, 4: 6 };

const encodePng = ({ width, height, channels, data }) => {
    const colorType = COLOR_TYPE[channels];
    if (colorType === undefined || !width || !height || data.length < width * height * channels) throw new Error('Unsupported image data');
    const stride = width * channels;
    const raw = Buffer.alloc((stride + 1) * height);
    const src = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    for (let y = 0; y < height; y++) src.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride); // filter byte 0
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = colorType;
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
};

module.exports = { encodePng };
