const crypto = require('crypto');

// Makes error text safe to store (utils/errorLogger.js): no emails, tokens,
// keys, passwords, connection-string credentials or reset links. Applied to
// every message, stack and path before it's saved, whatever its source.

const MAX_MESSAGE = 1000;
const MAX_STACK = 8000;
const MAX_PATH = 300;

const RULES = [
    // Credentials inside any URL (a user name and password before the "@"
    // of a MongoDB or HTTP URL).
    [/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[credentials]@'],
    // JSON Web Tokens.
    [/\beyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]{5,}\b/g, '[token]'],
    // Authorization header values.
    [/\b(Bearer|Basic)\s+[\w.~+/=-]+/gi, '$1 [token]'],
    // key=value pairs whose key says secret (query strings, logs, JSON-ish).
    [/\b(password|passwd|pwd|token|secret|api[_-]?key|apikey|authorization|cookie|session|signature|reset[_-]?token)(["']?\s*[:=]\s*["']?)[^\s"'&,;}]+/gi, '$1$2[redacted]'],
    // Password reset links: /reset-password/<token>.
    [/(\/reset-password\/)[^\s/?#"']+/gi, '$1[token]'],
    // Emails.
    [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]'],
    // Long hex or base64url runs that look like tokens or keys (24+ chars,
    // with both letters and digits). Mongo ObjectIds (24 hex) are ids, not
    // secrets, and are kept.
    [/\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}\b/g, '[token]'],
];

const scrubText = (value, max = MAX_MESSAGE) => {
    if (value === undefined || value === null) return '';
    let text = String(value);
    for (const [pattern, replacement] of RULES) text = text.replace(pattern, replacement);
    return text.length > max ? `${text.slice(0, max)}…` : text;
};

const scrubMessage = (value) => scrubText(value, MAX_MESSAGE);
const scrubStack = (value) => scrubText(value, MAX_STACK);

// A page path: no query string or hash (they can carry tokens), token-like
// segments replaced.
const scrubPath = (value) => {
    if (!value) return '';
    let pathOnly = String(value);
    try {
        pathOnly = new URL(pathOnly, 'http://x').pathname;
    } catch {
        pathOnly = pathOnly.split(/[?#]/)[0];
    }
    return scrubText(pathOnly, MAX_PATH);
};

// Where an error comes from, for grouping: the first stack frame, with
// build hashes and line/column numbers removed so the same bug groups
// together across deploys and minor edits.
const firstFrame = (stack = '') => {
    const line = String(stack)
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.startsWith('at ') || /@/.test(l));
    if (!line) return '';
    return line
        .replace(/https?:\/\/[^/\s)]+/g, '') // origin
        .replace(/-[A-Za-z0-9_]{6,}\.(js|mjs|css)/g, '.$1') // vite chunk hashes
        .replace(/\?[^\s):]*/g, '') // query strings (?v=…)
        .replace(/:\d+(:\d+)?\)?$/g, '') // line:col
        .replace(/\(\s*$/, '');
};

// Variable parts of a message (ids, numbers, quoted values) normalised so
// "Book 64b… not found" and "Book 64c… not found" group together.
const normaliseMessage = (message = '') =>
    String(message)
        .replace(/\b[a-f0-9]{24}\b/gi, '<id>')
        .replace(/\b\d+(\.\d+)?\b/g, '<n>')
        .replace(/(["'`]).*?\1/g, '<value>')
        .slice(0, 300);

const fingerprintOf = (source, message, stack) =>
    crypto.createHash('sha256').update(`${source}\n${normaliseMessage(message)}\n${firstFrame(stack)}`).digest('hex');

module.exports = { scrubText, scrubMessage, scrubStack, scrubPath, firstFrame, normaliseMessage, fingerprintOf, MAX_MESSAGE, MAX_STACK };
