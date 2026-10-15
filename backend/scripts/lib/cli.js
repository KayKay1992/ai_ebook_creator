// Shared bits for the backup/restore scripts (run on your PC, not Render).
const path = require('path');
const { redact } = require('../../utils/backup');

// backend/.env, wherever the script is started from. Never printed.
const loadEnv = () => require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });

// --flag value / --flag; bare words go to args._.
const parseArgs = (argv) => {
    const args = { _: [] };
    for (let i = 0; i < argv.length; i++) {
        const key = argv[i];
        if (!key.startsWith('--')) {
            args._.push(key);
            continue;
        }
        const name = key.slice(2);
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) args[name] = true;
        else {
            args[name] = next;
            i++;
        }
    }
    return args;
};

// Every line any of these scripts prints (including errors from the
// driver, which can echo a connection string) goes through redact():
// credentials and query strings are masked, the given URIs replaced.
const maskConsole = (uris) => {
    for (const method of ['log', 'info', 'warn', 'error']) {
        const original = console[method].bind(console);
        console[method] = (...parts) =>
            original(...parts.map((part) => (part instanceof Error ? redact(part.stack || part.message, uris) : typeof part === 'string' ? redact(part, uris) : part)));
    }
};

const formatCount = (n) => Number(n || 0).toLocaleString('en-US');
const formatBytes = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(0, Math.round((n || 0) / 1024))} KB`);

module.exports = { loadEnv, parseArgs, maskConsole, formatCount, formatBytes };
