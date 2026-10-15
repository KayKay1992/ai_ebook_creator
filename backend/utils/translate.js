const { getClient } = require('./geminiClient');
const { withGeminiRetry, rateLimitKind, DAILY_LIMIT_MESSAGE } = require('./geminiRetry');

// One Gemini request translating a chunk of chapter "items" (the title
// and/or markdown blocks, see utils/translationText.js). Sent and returned
// as a JSON array of strings with a response schema, so the reply must have
// exactly one translation per item: that's what keeps translated chapters
// aligned paragraph for paragraph with the original. A reply of the wrong
// shape is retried (it usually comes right on a second try).

const DEFAULT_TRANSLATION_MODEL = 'gemini-2.5-flash';
const getTranslationModel = () => process.env.TRANSLATION_MODEL || DEFAULT_TRANSLATION_MODEL;

const getMinIntervalMs = () => {
    const n = parseInt(process.env.TRANSLATION_MIN_INTERVAL_MS, 10);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 10 * 60 * 1000) : 0;
};

class TranslationError extends Error {
    constructor(message, { retryable = false } = {}) {
        super(message);
        this.name = 'TranslationError';
        this.retryable = retryable;
    }
}

const buildPrompt = (items, language, bookTitle) => `
You are a professional literary translator. Translate each string in the
JSON array below into ${language.promptName}. The text is part of a
chapter of the book "${bookTitle}".

Rules:
- Return a JSON array with exactly ${items.length} strings: the translation
  of each input string, in the same order. Never merge, split, drop or add
  strings.
- Keep all markdown exactly: heading marks (#), list markers (-, *, 1.),
  blockquote marks (>), **bold**, *italics*, \`code\`, links [text](url) and
  images ![alt](url). Translate the visible text only; never change URLs.
- Keep every line break inside a string where it is.
- Keep all numbers, figures, dates written as digits, percentages and money
  amounts exactly as written, including naira amounts such as ₦5,000 (same
  digits, same commas and decimal points, same currency sign).
- Do not translate the names of people, brands, companies, products, places
  or organisations. Keep them exactly as written.
- Write naturally for a native reader, in the same tone as the original.
  Do not add explanations, notes or anything that is not in the original.

Input:
${JSON.stringify(items)}
`;

// All translation requests share one spacing queue (TRANSLATION_MIN_INTERVAL_MS).
const throttle = { next: 0 };

// items: string[]; returns string[] of the same length.
const translateItems = (items, { language, bookTitle = '', model = getTranslationModel(), onWait, retries = 3 } = {}) =>
    withGeminiRetry(
        async () => {
            const response = await getClient().models.generateContent({
                model,
                contents: buildPrompt(items, language, bookTitle),
                config: {
                    responseMimeType: 'application/json',
                    responseSchema: { type: 'ARRAY', items: { type: 'STRING' } },
                    temperature: 0.2,
                },
            });
            let parsed;
            try {
                parsed = JSON.parse(String(response?.text || ''));
            } catch {
                throw new TranslationError('Gemini returned something that is not a JSON list.', { retryable: true });
            }
            if (!Array.isArray(parsed) || parsed.length !== items.length || parsed.some((s) => typeof s !== 'string')) {
                throw new TranslationError(
                    `Gemini returned ${Array.isArray(parsed) ? parsed.length : 'no'} paragraphs for ${items.length}, so the translation would be misaligned.`,
                    { retryable: true }
                );
            }
            if (parsed.some((s, i) => items[i].trim() && !s.trim())) {
                throw new TranslationError('Gemini returned an empty paragraph.', { retryable: true });
            }
            return parsed;
        },
        { retries, onWait, throttle, minIntervalMs: getMinIntervalMs() }
    );

const DAILY_QUOTA_MESSAGE = `${DAILY_LIMIT_MESSAGE} Translation continues from where it stopped when you translate again.`;

// A short message for the admin's status table.
const describeTranslationError = (error) => {
    const kind = rateLimitKind(error);
    if (kind === 'daily') return DAILY_QUOTA_MESSAGE;
    if (kind === 'minute') return "Gemini's per-minute limit kept being hit, even after waiting. Try again in a few minutes.";
    if (kind === 'other') return 'Gemini rate limit or quota reached, even after retrying. Try again later.';
    const message = String(error?.message || 'Unknown error').replace(/\s+/g, ' ');
    return message.length > 300 ? `${message.slice(0, 297)}...` : message;
};

module.exports = {
    DEFAULT_TRANSLATION_MODEL,
    DAILY_QUOTA_MESSAGE,
    getTranslationModel,
    translateItems,
    describeTranslationError,
    TranslationError,
};
