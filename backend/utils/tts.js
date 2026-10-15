const { getClient } = require('./geminiClient');
const { pcmFromInlineData } = require('./audioEncoding');
const { withGeminiRetry, isRetryable, parseQuotaError, rateLimitKind, QuotaExhaustedError } = require('./geminiRetry');

// Gemini text-to-speech. Verified against @google/genai 1.51 and the live
// API (see scripts/tts-sample.js): generateContent with
// responseModalities ['AUDIO'] returns one inlineData part of 24 kHz 16-bit
// mono PCM (WAV on the 3.8 models, headerless L16 on older ones).
// gemini-3.8-flash-tts is the non-preview model; TTS_MODEL overrides it.
//
// Retries and quota handling (per-minute waits, daily-limit stop) live in
// utils/geminiRetry.js, shared with summaries and translations.
// AUDIO_TTS_MIN_INTERVAL_MS spaces narration requests out so per-minute
// limits are hit less in the first place.

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

// TTS requests in flight per chapter. Default 1: the free tier's
// per-minute limits are low enough that parallel requests mostly just
// trade places in the retry queue.
const getConcurrency = () => {
    const n = parseInt(process.env.AUDIO_TTS_CONCURRENCY, 10);
    return Number.isFinite(n) ? Math.min(Math.max(n, 1), 4) : 1;
};

// Minimum gap between the starts of two Gemini TTS requests, process-wide.
const getMinIntervalMs = () => {
    const n = parseInt(process.env.AUDIO_TTS_MIN_INTERVAL_MS, 10);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 10 * 60 * 1000) : 0;
};

class TtsError extends Error {
    constructor(message, { retryable = false, status } = {}) {
        super(message);
        this.name = 'TtsError';
        this.retryable = retryable;
        this.status = status;
    }
}

const DAILY_QUOTA_MESSAGE =
    'Daily Gemini limit reached. Try again after it resets, or use local narration.';

// All narration requests share one spacing queue (AUDIO_TTS_MIN_INTERVAL_MS).
const throttle = { next: 0 };

// One TTS request. Returns { samples: Int16Array, sampleRate }. Retries,
// per-minute waits and the daily-limit stop come from utils/geminiRetry.js.
const synthesizeSpeech = (text, { voice = DEFAULT_VOICE, model = getTtsModel(), retries = 4, onWait } = {}) =>
    withGeminiRetry(
        async () => {
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
        },
        { retries, onWait, throttle, minIntervalMs: getMinIntervalMs() }
    );

// A short message for the admin's status table.
const describeTtsError = (error) => {
    const kind = rateLimitKind(error);
    if (kind === 'daily') return DAILY_QUOTA_MESSAGE;
    if (kind === 'minute') {
        return "Gemini's per-minute limit kept being hit, even after waiting. Try again in a few minutes, or lower AUDIO_TTS_CONCURRENCY / raise AUDIO_TTS_MIN_INTERVAL_MS.";
    }
    if (kind === 'other') return 'Gemini rate limit or quota reached, even after retrying. Try again later.';
    const message = String(error?.message || 'Unknown error').replace(/\s+/g, ' ');
    return message.length > 300 ? `${message.slice(0, 297)}...` : message;
};

module.exports = {
    DEFAULT_TTS_MODEL,
    DEFAULT_VOICE,
    DAILY_QUOTA_MESSAGE,
    VOICES,
    getTtsModel,
    getConcurrency,
    getMinIntervalMs,
    isValidVoice,
    isRetryable,
    parseQuotaError,
    synthesizeSpeech,
    describeTtsError,
    TtsError,
    QuotaExhaustedError,
};
