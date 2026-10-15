// Shared retry, backoff and quota handling for Gemini API calls: narration
// (utils/tts.js), chapter summaries and translations all go through
// withGeminiRetry.
//
// Quota handling (the free tier is small): a 429 carries a google.rpc
// QuotaFailure naming the exhausted quota (e.g.
// "GenerateRequestsPerMinutePerProjectPerModel-FreeTier") and usually a
// RetryInfo delay. Per-minute limits are waited out and the request is
// tried again without using up `retries`; a daily limit throws
// QuotaExhaustedError straight away, since retrying can't succeed until it
// resets. Other rate limits and transient failures get exponential backoff
// with jitter; anything else (bad request, bad key) fails fast.

const DAILY_LIMIT_MESSAGE = 'Daily Gemini limit reached. Try again after it resets.';

// A daily (or otherwise long-term) Gemini quota is used up. Never retried.
class QuotaExhaustedError extends Error {
    constructor(quotaId = '', message = DAILY_LIMIT_MESSAGE) {
        super(message);
        this.name = 'QuotaExhaustedError';
        this.retryable = false;
        this.status = 429;
        this.quotaId = quotaId;
    }
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const RETRYABLE_MESSAGE = /RESOURCE_EXHAUSTED|UNAVAILABLE|INTERNAL|DEADLINE|timed? ?out|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|socket hang up|overloaded/i;

const statusOf = (error) => error?.status ?? error?.code ?? error?.response?.status;

// Errors raised by our own code say for themselves (`retryable`).
const isRetryable = (error) => {
    if (typeof error?.retryable === 'boolean') return error.retryable;
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
    if (!error || typeof error.retryable === 'boolean' || !isRateLimit(error)) return null;
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

// Spaces out the starts of requests sharing one `throttle` object
// ({ next: 0 }) by at least `minIntervalMs`, measured from when the
// previous request actually started. (Reserving slots alone isn't enough:
// on a busy event loop a request can start late, and the next reserved
// slot would then come too soon after it.)
const awaitSlot = async (throttle, minIntervalMs) => {
    if (!throttle || !minIntervalMs) return;
    const now = Date.now();
    // Reserve a slot, so concurrent callers keep their order.
    const startAt = Math.max(now, throttle.next || 0);
    throttle.next = startAt + minIntervalMs;
    if (startAt > now) await sleep(startAt - now);
    // Then make sure the last request that actually started is far enough
    // back. Check-and-set happens between awaits, so it can't interleave.
    for (let wait = (throttle.lastStart || 0) + minIntervalMs - Date.now(); wait > 0; ) {
        await sleep(wait);
        wait = (throttle.lastStart || 0) + minIntervalMs - Date.now();
    }
    throttle.lastStart = Date.now();
    throttle.next = Math.max(throttle.next, throttle.lastStart + minIntervalMs);
};

// Runs `attempt()` (one Gemini request) with the retry rules above.
// Options: retries (default 4), onWait({ waitMs, quotaId }) before each
// per-minute wait, maxRateWaits, maxRateWaitMs (caps each per-minute wait;
// an HTTP handler passes something short so a request can't hang), and
// throttle + minIntervalMs for request spacing.
const withGeminiRetry = async (
    attempt,
    { retries = 4, onWait, maxRateWaits = MAX_RATE_WAITS, maxRateWaitMs, throttle, minIntervalMs = 0 } = {}
) => {
    let tries = 0;
    let rateWaits = 0;
    for (;;) {
        try {
            await awaitSlot(throttle, minIntervalMs);
            return await attempt();
        } catch (error) {
            const quota = parseQuotaError(error);
            if (quota?.kind === 'daily') throw new QuotaExhaustedError(quota.quotaId);
            if (quota?.kind === 'minute' && rateWaits < maxRateWaits) {
                rateWaits += 1;
                const cap = Math.min(rateWaitCapMs(), maxRateWaitMs ?? Infinity);
                const waitMs = Math.min(quota.retryAfterMs ?? 60000, cap) + Math.random() * retryBaseMs();
                if (onWait) onWait({ waitMs, quotaId: quota.quotaId });
                await sleep(waitMs);
                continue;
            }
            if (tries >= retries || !isRetryable(error)) throw error;
            const base = retryBaseMs() * 2 ** tries * (isRateLimit(error) ? 3 : 1);
            tries += 1;
            await sleep(base + Math.random() * retryBaseMs());
        }
    }
};

// 'daily' | 'minute' | 'other' | null (not a rate limit), for messages.
const rateLimitKind = (error) => {
    if (error instanceof QuotaExhaustedError) return 'daily';
    if (!isRateLimit(error)) return null;
    return parseQuotaError(error)?.kind === 'minute' ? 'minute' : 'other';
};

module.exports = {
    DAILY_LIMIT_MESSAGE,
    QuotaExhaustedError,
    isRetryable,
    isRateLimit,
    parseQuotaError,
    rateLimitKind,
    withGeminiRetry,
};
