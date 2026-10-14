const { GoogleGenAI } = require('@google/genai');
const { pcmFromInlineData } = require('./audioEncoding');

// Gemini text-to-speech. Verified against @google/genai 1.51 and the live
// API (see scripts/tts-sample.js): generateContent with
// responseModalities ['AUDIO'] returns one inlineData part of 24 kHz 16-bit
// mono PCM (WAV on the 3.8 models, headerless L16 on older ones).
// gemini-3.8-flash-tts is the non-preview model; TTS_MODEL overrides it.

const DEFAULT_TTS_MODEL = 'gemini-3.8-flash-tts';
const getTtsModel = () => process.env.TTS_MODEL || DEFAULT_TTS_MODEL;

const DEFAULT_VOICE = 'Sulafat';

// Google's 30 prebuilt voices with its own one-word descriptions (the SDK
// accepts any string, so this list is what we validate against).
const VOICES = [
    ['Zephyr', 'Bright'], ['Puck', 'Upbeat'], ['Charon', 'Informative'], ['Kore', 'Firm'],
    ['Fenrir', 'Excitable'], ['Leda', 'Youthful'], ['Orus', 'Firm'], ['Aoede', 'Breezy'],
    ['Callirrhoe', 'Easy-going'], ['Autonoe', 'Bright'], ['Enceladus', 'Breathy'], ['Iapetus', 'Clear'],
    ['Umbriel', 'Easy-going'], ['Algieba', 'Smooth'], ['Despina', 'Smooth'], ['Erinome', 'Clear'],
    ['Algenib', 'Gravelly'], ['Rasalgethi', 'Informative'], ['Laomedeia', 'Upbeat'], ['Achernar', 'Soft'],
    ['Alnilam', 'Firm'], ['Schedar', 'Even'], ['Gacrux', 'Mature'], ['Pulcherrima', 'Forward'],
    ['Achird', 'Friendly'], ['Zubenelgenubi', 'Casual'], ['Vindemiatrix', 'Gentle'], ['Sadachbia', 'Lively'],
    ['Sadaltager', 'Knowledgeable'], ['Sulafat', 'Warm'],
].map(([name, description]) => ({ name, description }));
const VOICE_NAMES = new Set(VOICES.map((v) => v.name));
const isValidVoice = (voice) => typeof voice === 'string' && VOICE_NAMES.has(voice);

let client = null;
const getClient = () => {
    if (!client) {
        client = new GoogleGenAI({
            apiKey: process.env.GEMINI_API_KEY,
            // A ~2-minute chunk normally takes well under a minute; this
            // just stops a stuck request holding a job forever.
            httpOptions: { timeout: 180000 },
        });
    }
    return client;
};

class TtsError extends Error {
    constructor(message, { retryable = false, status } = {}) {
        super(message);
        this.name = 'TtsError';
        this.retryable = retryable;
        this.status = status;
    }
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const RETRYABLE_MESSAGE = /RESOURCE_EXHAUSTED|UNAVAILABLE|INTERNAL|DEADLINE|timed? ?out|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|socket hang up|overloaded/i;

const statusOf = (error) => error?.status ?? error?.code ?? error?.response?.status;

const isRetryable = (error) => {
    if (error instanceof TtsError) return error.retryable;
    const status = Number(statusOf(error));
    if (RETRYABLE_STATUS.has(status)) return true;
    return RETRYABLE_MESSAGE.test(String(error?.message || ''));
};

const isRateLimit = (error) => Number(statusOf(error)) === 429 || /RESOURCE_EXHAUSTED|quota|rate/i.test(String(error?.message || ''));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Read per call so tests can shrink it.
const retryBaseMs = () => {
    const n = Number(process.env.TTS_RETRY_BASE_MS);
    return Number.isFinite(n) && n >= 0 ? n : 2000;
};

// One TTS request. Returns { samples: Int16Array, sampleRate }. Retries
// rate limits and transient failures with exponential backoff and jitter
// (longer for rate limits); anything else (bad voice, bad key) fails fast.
const synthesizeSpeech = async (text, { voice = DEFAULT_VOICE, model = getTtsModel(), retries = 4 } = {}) => {
    for (let attempt = 0; ; attempt++) {
        try {
            const response = await getClient().models.generateContent({
                model,
                contents: [{ parts: [{ text }] }],
                config: {
                    responseModalities: ['AUDIO'],
                    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
                },
            });
            const inline = response?.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data)?.inlineData;
            if (!inline) {
                // Occasionally the model answers with text or nothing;
                // asking again usually works.
                throw new TtsError('The speech model returned no audio.', { retryable: true });
            }
            const decoded = pcmFromInlineData(inline);
            if (!decoded.samples.length) throw new TtsError('The speech model returned empty audio.', { retryable: true });
            return decoded;
        } catch (error) {
            if (attempt >= retries || !isRetryable(error)) throw error;
            const base = retryBaseMs() * 2 ** attempt * (isRateLimit(error) ? 3 : 1);
            await sleep(base + Math.random() * retryBaseMs());
        }
    }
};

// A short message for the admin's status table.
const describeTtsError = (error) => {
    if (isRateLimit(error)) return 'Gemini rate limit or quota reached, even after retrying. Try again later.';
    const message = String(error?.message || 'Unknown error').replace(/\s+/g, ' ');
    return message.length > 300 ? `${message.slice(0, 297)}...` : message;
};

module.exports = {
    DEFAULT_TTS_MODEL,
    DEFAULT_VOICE,
    VOICES,
    getTtsModel,
    isValidVoice,
    isRetryable,
    synthesizeSpeech,
    describeTtsError,
    TtsError,
};
