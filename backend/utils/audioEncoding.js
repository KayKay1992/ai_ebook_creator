// PCM decoding and MP3 encoding for generated narration.
//
// Gemini TTS returns 16-bit mono PCM, in one of two wrappings depending on
// the model (verified against the live API, @google/genai 1.51):
//   - gemini-3.8-flash-tts / -lite-tts: `audio/wav` (RIFF header + PCM)
//   - gemini-2.5-*-preview-tts, gemini-3.1-flash-tts-preview:
//     `audio/L16;codec=pcm;rate=24000` (headerless, little-endian)
// pcmFromInlineData accepts either, so switching models is config only.
//
// MP3 encoding uses @breezystack/lamejs (pure JS, maintained fork of
// lamejs; the original lamejs package crashes with "MPEGMode is not
// defined"). No native binary, and a 10-minute chapter encodes in ~15s
// within a 64MB heap, which suits Render's free tier. Encoding is
// synchronous CPU work, so encodeMp3 yields to the event loop between
// frames to keep the API responsive while a job runs.

const DEFAULT_SAMPLE_RATE = 24000;
const DEFAULT_KBPS = 64; // mono 64 kbps ≈ 0.48 MB per minute
const FRAMES_PER_SLICE = 1152 * 10; // ~0.5s of audio per encode call

let lame = null;
// The fork's "require" entry is a browser IIFE (`var lamejs = ...`) with no
// CommonJS exports, and its ES module build needs import(), which Jest's
// CommonJS runtime can't do without experimental flags. So the IIFE source
// is evaluated directly and its result returned, without leaking a global.
const loadLame = () => {
    if (!lame) {
        const fs = require('fs');
        const vm = require('vm');
        // Resolves through the package's "require" export: dist/lamejs.iife.js.
        const source = fs.readFileSync(require.resolve('@breezystack/lamejs'), 'utf8');
        lame = vm.runInThisContext(`(function () {\n${source}\nreturn lamejs;\n})()`, {
            filename: 'lamejs.iife.js',
        });
    }
    return lame;
};

const parseWav = (buffer) => {
    let offset = 12; // after "RIFF" <size> "WAVE"
    let sampleRate = DEFAULT_SAMPLE_RATE;
    let channels = 1;
    let bitsPerSample = 16;
    while (offset + 8 <= buffer.length) {
        const id = buffer.toString('latin1', offset, offset + 4);
        const size = buffer.readUInt32LE(offset + 4);
        const body = offset + 8;
        if (id === 'fmt ') {
            channels = buffer.readUInt16LE(body + 2);
            sampleRate = buffer.readUInt32LE(body + 4);
            bitsPerSample = buffer.readUInt16LE(body + 14);
        } else if (id === 'data') {
            if (channels !== 1 || bitsPerSample !== 16) {
                throw new Error(`Unsupported WAV format: ${channels} channel(s), ${bitsPerSample}-bit`);
            }
            // Some streams write 0 or 0xFFFFFFFF as the data size; clamp to
            // what's actually there.
            const end = Math.min(buffer.length, body + (size || buffer.length));
            return { pcm: buffer.subarray(body, end), sampleRate };
        }
        offset = body + size + (size % 2);
    }
    throw new Error('WAV data chunk not found');
};

// `data` is base64 (as returned in inlineData) or a Buffer.
const pcmFromInlineData = ({ mimeType = '', data }) => {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data || '', 'base64');
    let pcm;
    let sampleRate = DEFAULT_SAMPLE_RATE;

    if (/wav/i.test(mimeType) || buffer.toString('latin1', 0, 4) === 'RIFF') {
        ({ pcm, sampleRate } = parseWav(buffer));
    } else if (/l16|pcm/i.test(mimeType)) {
        pcm = buffer;
        const rate = /rate=(\d+)/i.exec(mimeType);
        if (rate) sampleRate = Number(rate[1]);
    } else {
        throw new Error(`Unsupported TTS audio format: ${mimeType || 'unknown'}`);
    }

    // Copy into an aligned Int16Array (the subarray may start at an odd offset).
    const samples = new Int16Array(Math.floor(pcm.length / 2));
    for (let i = 0; i < samples.length; i++) samples[i] = pcm.readInt16LE(i * 2);
    return { samples, sampleRate };
};

const silence = (sampleRate, ms) => new Int16Array(Math.round((sampleRate * ms) / 1000));

const yieldToEventLoop = () => new Promise((resolve) => setImmediate(resolve));

// Encodes a list of Int16Array PCM segments (all at `sampleRate`) into one
// MP3 buffer. Returns { buffer, durationSec }.
const encodeMp3 = async (segments, { sampleRate = DEFAULT_SAMPLE_RATE, kbps = DEFAULT_KBPS } = {}) => {
    const encoder = new (loadLame().Mp3Encoder)(1, sampleRate, kbps);
    const out = [];
    let totalSamples = 0;

    for (const segment of segments) {
        totalSamples += segment.length;
        for (let i = 0; i < segment.length; i += FRAMES_PER_SLICE) {
            const mp3 = encoder.encodeBuffer(segment.subarray(i, i + FRAMES_PER_SLICE));
            if (mp3.length) out.push(Buffer.from(mp3));
            await yieldToEventLoop();
        }
    }
    const tail = encoder.flush();
    if (tail.length) out.push(Buffer.from(tail));

    return { buffer: Buffer.concat(out), durationSec: totalSamples / sampleRate };
};

module.exports = {
    DEFAULT_SAMPLE_RATE,
    DEFAULT_KBPS,
    pcmFromInlineData,
    silence,
    encodeMp3,
};
