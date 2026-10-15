const { GoogleGenAI } = require('@google/genai');
const { pcmFromInlineData } = require('./audioEncoding');

// Gemini text-to-speech. Verified against @google/genai 1.51 and the live
// API (see scripts/tts-sample.js): generateContent with
// responseModalities ['AUDIO'] returns one inlineData part of 24 kHz 16-bit
// mono PCM (WAV on the 3.8 models, headerless L16 on older ones).
// gemini-3.8-flash-tts is the non-preview model; TTS_MODEL overrides it.
//
// Quota handling (the free tier is small): a 429 carries a google.rpc
// QuotaFailure naming the exhausted quota (e.g.
// "GenerateRequestsPerMinutePerProjectPerModel-FreeTier") and usually a
// RetryInfo delay. Per-minute limits are waited out and the request is
// tried again; a daily limit throws QuotaExhaustedError straight away,
// since retrying can't succeed until it resets. AUDIO_TTS_MIN_INTERVAL_MS
// spaces requests out so per-minute limits are hit less in the first place.

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

const DAILY_QUOTA_MESSAGE =
    'Daily Gemini limit reached. Try again after it resets, or use local narration.';

// A daily (or otherwise long-term) Gemini quota is used up. Never retried.
class QuotaExhaustedError extends TtsError {
    constructor(quotaId = '') {
        super(DAILY_QUOTA_MESSAGE, { retryable: false, status: 429 });
        this.name = 'QuotaExhaustedError';
        this.quotaId = quotaId;
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

// "39s" / "1.5s" (protobuf Duration as JSON) → ms.
const parseDuration = (value) => {
    const match = /^(\d+(?:\.\d+)?)s$/.exec(String(value || '').trim());
    return match ? Math.round(Number(match[1]) * 1000) : null;
};

// Reads a Gemini 429's error details. The SDK's ApiError message is the
// JSON error body: {"error":{"code":429,"status":"RESOURCE_EXHAUSTED",
// "message":..., "details":[{QuotaFailure: violations[{quotaId, quotaMetric}]},
// {RetryInfo: retryDelay "39s"}]}}. Returns null for anything that isn't a
// rate limit, else { kind: 'daily' | 'minute' | 'unknown', retryAfterMs, quotaId }.
const parseQuotaError = (error) => {
    if (!error || error instanceof TtsError || !isRateLimit(error)) return null;
    let body = null;
    const text = String(error.message || '');
    if (text.includes('{')) {
        try {
            body = JSON.parse(text.slice(text.indexOf('{')));
        } catch {
            body = null;
        }
    }
    const details = Array.isArray(body?.error?.details) ? body.error.details : [];
    const violations = details.flatMap((d) => (Array.isArray(d?.violations) ? d.violations : []));
    const quotaIds = violations.map((v) => `${v.quotaId || ''} ${v.quotaMetric || ''}`.trim()).filter(Boolean);
    const retryAfterMs = details.map((d) => parseDuration(d?.retryDelay)).find((ms) => ms !== null) ?? null;
    const described = `${quotaIds.join(' ')} ${body?.error?.message || ''}`;

    let kind = 'unknown';
    if (/PerDay|per[_ ]day|daily/i.test(described)) kind = 'daily';
    else if (/PerMinute|per[_ ]minute/i.test(described) || retryAfterMs !== null) kind = 'minute';
    return { kind, retryAfterMs, quotaId: quotaIds[0] || '' };
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Read per call so tests can shrink them.
const retryBaseMs = () => {
    const n = Number(process.env.TTS_RETRY_BASE_MS);
    return Number.isFinite(n) && n >= 0 ? n : 2000;
};
// Longest single wait for a per-minute limit (Gemini usually asks for < 60s).
const rateWaitCapMs = () => {
    const n = Number(process.env.TTS_RATE_WAIT_CAP_MS);
    return Number.isFinite(n) && n >= 0 ? n : 5 * 60 * 1000;
};
// Per-minute waits allowed for one request before giving up. Generous:
// waiting is the right thing to do, it just mustn't loop forever.
const MAX_RATE_WAITS = 10;

let nextRequestAt = 0;
const awaitRequestSlot = async () => {
    const interval = getMinIntervalMs();
    if (!interval) return;
    const now = Date.now();
    const startAt = Math.max(now, nextRequestAt);
    nextRequestAt = startAt + interval;
    if (startAt > now) await sleep(startAt - now);
};

// One TTS request. Returns { samples: Int16Array, sampleRate }.
// - Per-minute rate limits: waits as long as Gemini asks (RetryInfo, else
//   a minute) and tries again, without using up `retries`.
// - Daily quota: throws QuotaExhaustedError immediately.
// - Other rate limits and transient failures: exponential backoff with
//   jitter. Anything else (bad voice, bad key) fails fast.
const synthesizeSpeech = async (text, { voice = DEFAULT_VOICE, model = getTtsModel(), retries = 4, onWait } = {}) => {
    let attempt = 0;
    let rateWaits = 0;
    for (;;) {
        try {
            await awaitRequestSlot();
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
            const quota = parseQuotaError(error);
            if (quota?.kind === 'daily') throw new QuotaExhaustedError(quota.quotaId);
            if (quota?.kind === 'minute' && rateWaits < MAX_RATE_WAITS) {
                rateWaits += 1;
                const waitMs = Math.min(quota.retryAfterMs ?? 60000, rateWaitCapMs()) + Math.random() * retryBaseMs();
                if (onWait) onWait({ waitMs, quotaId: quota.quotaId });
                await sleep(waitMs);
                continue;
            }
            if (attempt >= retries || !isRetryable(error)) throw error;
            const base = retryBaseMs() * 2 ** attempt * (isRateLimit(error) ? 3 : 1);
            attempt += 1;
            await sleep(base + Math.random() * retryBaseMs());
        }
    }
};

// A short message for the admin's status table.
const describeTtsError = (error) => {
    if (error instanceof QuotaExhaustedError) return DAILY_QUOTA_MESSAGE;
    if (isRateLimit(error)) {
        return parseQuotaError(error)?.kind === 'minute'
            ? "Gemini's per-minute limit kept being hit, even after waiting. Try again in a few minutes, or lower AUDIO_TTS_CONCURRENCY / raise AUDIO_TTS_MIN_INTERVAL_MS."
            : 'Gemini rate limit or quota reached, even after retrying. Try again later.';
    }
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
