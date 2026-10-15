const { getEngine, engineKey, LocalTtsUnavailableError } = require('./kokoroEngine');
const { silence } = require('./audioEncoding');

// Free, offline narration with Kokoro-82M (utils/kokoroEngine.js). Same
// contract as utils/tts.js's synthesizeSpeech: text in, { samples:
// Int16Array, sampleRate } out (24 kHz mono), so the rest of the pipeline
// doesn't care which engine made it.
//
// Kokoro truncates input past 512 tokens, so each chunk is spoken one
// sentence at a time (kokoro-js's own sentence splitter), with short pauses
// between sentences and longer ones between paragraphs.

const DEFAULT_VOICE = 'af_heart';
const SENTENCE_GAP_MS = 120;
const PARAGRAPH_GAP_MS = 450;

// kokoro-js's English voices (it refuses the other languages' voice files)
// with Kokoro's own quality grade. Copied here so listing voices doesn't
// load the model.
const VOICES = [
    ['af_heart', 'American female, grade A'], ['af_bella', 'American female, grade A-'],
    ['af_nicole', 'American female, grade B-'], ['af_aoede', 'American female, grade C+'],
    ['af_kore', 'American female, grade C+'], ['af_sarah', 'American female, grade C+'],
    ['af_alloy', 'American female, grade C'], ['af_nova', 'American female, grade C'],
    ['af_sky', 'American female, grade C-'], ['af_jessica', 'American female, grade D'],
    ['af_river', 'American female, grade D'], ['am_fenrir', 'American male, grade C+'],
    ['am_michael', 'American male, grade C+'], ['am_puck', 'American male, grade C+'],
    ['am_echo', 'American male, grade D'], ['am_eric', 'American male, grade D'],
    ['am_liam', 'American male, grade D'], ['am_onyx', 'American male, grade D'],
    ['am_santa', 'American male, grade D-'], ['am_adam', 'American male, grade F+'],
    ['bf_emma', 'British female, grade B-'], ['bf_isabella', 'British female, grade C'],
    ['bf_alice', 'British female, grade D'], ['bf_lily', 'British female, grade D'],
    ['bm_fable', 'British male, grade C'], ['bm_george', 'British male, grade C'],
    ['bm_lewis', 'British male, grade D+'], ['bm_daniel', 'British male, grade D'],
].map(([name, description]) => ({ name, description }));
const VOICE_NAMES = new Set(VOICES.map((v) => v.name));
const isValidVoice = (voice) => typeof voice === 'string' && VOICE_NAMES.has(voice);

// Float32 in [-1, 1] → Int16.
const toInt16 = (float32) => {
    const out = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
        const s = Math.max(-1, Math.min(1, float32[i]));
        out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
};

const concat = (segments) => {
    const out = new Int16Array(segments.reduce((sum, s) => sum + s.length, 0));
    let offset = 0;
    for (const segment of segments) {
        out.set(segment, offset);
        offset += segment.length;
    }
    return out;
};

const synthesizeSpeech = async (text, { voice = DEFAULT_VOICE, speed = 1 } = {}) => {
    const { tts, TextSplitterStream } = await getEngine();
    const segments = [];
    let sampleRate = 24000;
    const paragraphs = String(text).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    for (const [p, paragraph] of paragraphs.entries()) {
        const splitter = new TextSplitterStream();
        splitter.push(paragraph);
        splitter.close();
        let first = true;
        for await (const { audio } of tts.stream(splitter, { voice, speed })) {
            sampleRate = audio.sampling_rate;
            if (!first) segments.push(silence(sampleRate, SENTENCE_GAP_MS));
            segments.push(toInt16(audio.audio));
            first = false;
        }
        if (p < paragraphs.length - 1) segments.push(silence(sampleRate, PARAGRAPH_GAP_MS));
    }
    const samples = concat(segments);
    if (!samples.length) throw new Error('Local narration produced no audio.');
    return { samples, sampleRate };
};

const describeError = (error) => {
    if (error instanceof LocalTtsUnavailableError) return error.message;
    const message = String(error?.message || 'Unknown error').replace(/\s+/g, ' ');
    return `Local narration failed: ${message.length > 280 ? `${message.slice(0, 277)}...` : message}`;
};

module.exports = { DEFAULT_VOICE, VOICES, isValidVoice, synthesizeSpeech, describeError, engineKey, toInt16 };
