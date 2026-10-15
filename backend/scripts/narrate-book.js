// Free audiobook narration on your own PC: narrates a book's chapters with
// Kokoro-82M (local, offline, no API costs) and publishes the audio exactly
// as the server's narration job does: same text cleaning and chunking
// (utils/narrationText.js), same MP3 encoder, same authenticated Cloudinary
// storage, same book.audio fields (status ready, duration, bytes, textHash,
// voice, source 'local'). The result shows up in the editor's Audiobook tab
// and the reader's player with no further steps.
//
// It talks to your real database and Cloudinary using backend/.env
// (MONGO_URI and the CLOUDINARY_* vars). It never prints their values.
//
// One-time setup (from backend/):
//   npm install --prefix scripts/local-tts
//
// Usage (from backend/):
//   node scripts/narrate-book.js                        list books and their narration status
//   node scripts/narrate-book.js --owner you@mail.com   only books owned by that account
//   node scripts/narrate-book.js <bookId>               narrate every chapter that's missing audio or out of date
//   node scripts/narrate-book.js <bookId> --dry-run     show what would be narrated; changes nothing
//   node scripts/narrate-book.js <bookId> --chapter 3   just chapter 3 (its number in the book, or its id)
//   node scripts/narrate-book.js <bookId> --voice bm_george
//   node scripts/narrate-book.js <bookId> --skip-existing   leave chapters that have any audio alone,
//                                                           even if their text changed since
//   node scripts/narrate-book.js <bookId> --force       also redo chapters whose audio is up to date
//   node scripts/narrate-book.js --list-voices
//   node scripts/narrate-book.js <bookId> --provider gemini   use Gemini instead (needs GEMINI_API_KEY;
//                                                              counts toward its quota)
//
// Resumable: chapters that are ready and up to date are skipped, and inside
// a chapter every finished ~2-minute part is saved as it's made, so after a
// crash or Ctrl+C, running the same command again carries on where it
// stopped. Ctrl+C once finishes the current part and stops cleanly; twice
// quits immediately.
//
// Speed: about real time on a laptop CPU (a 10-minute chapter takes ~10
// minutes). Leave it running; the server doesn't need to be up.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

// --- Secrets never reach the terminal --------------------------------------
// Anything printed (including errors from Mongo, Cloudinary or Gemini, which
// can echo connection strings or keys) goes through redact().
const SECRET_ENV = ['MONGO_URI', 'JWT_SECRET', 'GEMINI_API_KEY', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET', 'BREVO_API_KEY', 'GMAIL_APP_PASSWORD'];
const redact = (value) => {
    let text = String(value);
    for (const name of SECRET_ENV) {
        const secret = process.env[name];
        if (secret && secret.length >= 6) text = text.split(secret).join(`<${name}>`);
    }
    // Credentials inside any URL (mongodb+srv://user:pass@host, etc.).
    return text.replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1***:***@');
};
for (const method of ['log', 'info', 'warn', 'error']) {
    const original = console[method].bind(console);
    console[method] = (...args) => original(...args.map((arg) => (arg instanceof Error ? redact(arg.stack || arg.message) : typeof arg === 'string' ? redact(arg) : arg)));
}

const mongoose = require('mongoose');
const Book = require('../models/Book');
require('../models/User'); // for --owner
const { chapterNarration, hashText, estimateDurationSec } = require('../utils/narrationText');
const { getProvider, PROVIDER_NAMES } = require('../utils/narrationProviders');
const { claimChapter, narrateClaimedChapter, isActivelyGenerating } = require('../utils/narrationPipeline');

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

const formatDuration = (totalSec = 0) => {
    const sec = Math.max(0, Math.round(totalSec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = String(sec % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
};
const formatNumber = (n) => Number(n || 0).toLocaleString('en-US');

const requireEnv = (names) => {
    const missing = names.filter((name) => !process.env[name]);
    if (missing.length) throw new Error(`Missing in backend/.env: ${missing.join(', ')}`);
};

const listBooks = async (ownerEmail) => {
    const filter = {};
    if (ownerEmail) {
        const owner = await mongoose.model('User').findOne({ email: String(ownerEmail).toLowerCase() }).select('_id');
        if (!owner) throw new Error(`No account with the email ${ownerEmail}.`);
        filter.userId = owner._id;
    }
    const books = await Book.find(filter)
        .select('title status chapters._id audio.chapters.chapterId audio.chapters.publicId updatedAt')
        .sort({ updatedAt: -1 })
        .lean();
    if (!books.length) {
        console.log('No books found.');
        return;
    }
    console.log('id                        narrated  status     title');
    for (const book of books) {
        const ids = new Set(book.chapters.map((c) => String(c._id)));
        const narrated = (book.audio?.chapters || []).filter((e) => e.publicId && ids.has(String(e.chapterId))).length;
        console.log(`${book._id}  ${`${narrated}/${book.chapters.length}`.padEnd(8)}  ${String(book.status || '').padEnd(9)}  ${book.title}`);
    }
    console.log('\nNarrate one: node scripts/narrate-book.js <id>   (add --dry-run to preview)');
};

// Decides, per chapter, whether to narrate it and why (or why not).
const planChapters = (book, args) => {
    const entries = new Map((book.audio?.chapters || []).map((e) => [String(e.chapterId), e]));
    let chapters = book.chapters.map((chapter, index) => ({ chapter, index }));

    if (args.chapter !== undefined) {
        const wanted = String(args.chapter);
        const byNumber = /^\d+$/.test(wanted) && wanted.length < 6 ? Number(wanted) - 1 : -1;
        chapters = chapters.filter(({ chapter, index }) => index === byNumber || String(chapter._id) === wanted);
        if (!chapters.length) throw new Error(`No chapter "${wanted}" in this book (it has ${book.chapters.length}).`);
    }

    return chapters.map(({ chapter, index }) => {
        const entry = entries.get(String(chapter._id));
        const { text } = chapterNarration(chapter);
        const base = { chapter, index, entry, charCount: text.length };
        if (!text) return { ...base, action: 'skip', reason: 'no text' };
        if (isActivelyGenerating(entry)) return { ...base, action: 'skip', reason: 'being generated elsewhere right now' };
        if (entry?.publicId) {
            const upToDate = entry.textHash === hashText(text);
            if (args['skip-existing']) return { ...base, action: 'skip', reason: upToDate ? 'has audio' : 'has audio (out of date, kept by --skip-existing)' };
            if (upToDate && !args.force) return { ...base, action: 'skip', reason: 'up to date' };
            return { ...base, action: 'narrate', reason: upToDate ? 'redo (--force)' : 'text changed since its audio was made' };
        }
        const savedParts = entry?.parts?.length || 0;
        return { ...base, action: 'narrate', reason: savedParts ? `continue (${savedParts} part${savedParts === 1 ? '' : 's'} already saved)` : 'no audio yet' };
    });
};

const main = async () => {
    const args = parseArgs(process.argv.slice(2));
    const providerName = typeof args.provider === 'string' ? args.provider.toLowerCase() : 'local';
    if (!PROVIDER_NAMES.includes(providerName)) throw new Error(`--provider must be one of: ${PROVIDER_NAMES.join(', ')}`);
    const provider = getProvider(providerName);

    if (args['list-voices']) {
        provider.voices.forEach((v) => console.log(`${v.name.padEnd(14)} ${v.description}${v.name === provider.defaultVoice ? '  (default)' : ''}`));
        return;
    }

    const [bookId] = args._;
    requireEnv(bookId && !args['dry-run'] ? ['MONGO_URI', 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'] : ['MONGO_URI']);
    if (providerName === 'gemini' && bookId && !args['dry-run']) requireEnv(['GEMINI_API_KEY']);

    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });
    try {
        if (!bookId) {
            await listBooks(args.owner);
            return;
        }
        if (!mongoose.isValidObjectId(bookId)) throw new Error(`"${bookId}" isn't a book id. Run without arguments to list books.`);
        const book = await Book.findById(bookId).select('title chapters audio');
        if (!book) throw new Error(`No book with id ${bookId}.`);

        const voice = typeof args.voice === 'string' ? args.voice : [book.audio?.voice].find((v) => provider.isValidVoice(v)) || provider.defaultVoice;
        if (!provider.isValidVoice(voice)) throw new Error(`Unknown ${provider.label} voice "${voice}". See --list-voices.`);

        const plan = planChapters(book, args);
        const todo = plan.filter((p) => p.action === 'narrate');
        const totalChars = todo.reduce((sum, p) => sum + p.charCount, 0);

        console.log(`"${book.title}" · ${provider.label} · voice ${voice}\n`);
        for (const p of plan) {
            const mark = p.action === 'narrate' ? '→' : '·';
            console.log(`${mark} ${String(p.index + 1).padStart(2)}. ${p.chapter.title}  (${formatNumber(p.charCount)} chars, ~${formatDuration(estimateDurationSec(p.charCount))})  ${p.reason}`);
        }
        console.log(
            `\n${todo.length} chapter${todo.length === 1 ? '' : 's'} to narrate: ${formatNumber(totalChars)} characters, ` +
                `about ${formatDuration(estimateDurationSec(totalChars))} of audio` +
                (provider.name === 'local' ? ' (and roughly as long to make on a laptop CPU).' : '.')
        );
        if (args['dry-run'] || !todo.length) {
            if (args['dry-run']) console.log('Dry run: nothing was changed.');
            return;
        }

        let stopping = false;
        process.on('SIGINT', () => {
            if (stopping) {
                console.log('\nQuitting now. Run the same command again to continue; finished parts are kept.');
                process.exit(130);
            }
            stopping = true;
            console.log('\nStopping after the current part (Ctrl+C again to quit now)...');
        });

        if (provider.name === 'local') {
            const { getEngine } = require('../utils/kokoroEngine');
            const loadStarted = Date.now();
            console.log('\nLoading the Kokoro model (the first run downloads ~311MB)...');
            await getEngine();
            console.log(`Model ready in ${((Date.now() - loadStarted) / 1000).toFixed(1)}s.`);
        }

        const results = { ready: 0, failed: 0, waiting: 0, skipped: 0 };
        for (const [n, p] of todo.entries()) {
            if (stopping) break;
            const label = `[${n + 1}/${todo.length}] ${p.index + 1}. ${p.chapter.title}`;
            console.log(`\n${label}`);
            const claimed = await claimChapter(book._id, p.chapter._id, { voice, charCount: p.charCount });
            if (!claimed) {
                console.log('  Skipped: someone else started generating it.');
                results.skipped += 1;
                continue;
            }

            const started = Date.now();
            let firstFreshAt = null;
            let freshDone = 0;
            const result = await narrateClaimedChapter({
                bookId: book._id,
                chapterId: p.chapter._id,
                provider,
                shouldStop: () => stopping,
                onWait: ({ waitMs }) => console.log(`  Gemini per-minute limit: waiting ${Math.ceil(waitMs / 1000)}s...`),
                onProgress: ({ done, total, reused }) => {
                    if (done === reused) {
                        if (reused) console.log(`  Continuing: ${reused} of ${total} parts already saved.`);
                        firstFreshAt = Date.now();
                        return;
                    }
                    freshDone = done - reused;
                    const perPart = (Date.now() - firstFreshAt) / freshDone;
                    const left = total - done;
                    console.log(
                        `  part ${done} of ${total} done · ${formatDuration((Date.now() - started) / 1000)} elapsed` +
                            (left ? ` · ~${formatDuration((perPart * left) / 1000)} left` : ' · assembling and uploading...')
                    );
                },
            });

            if (result.outcome === 'ready') {
                results.ready += 1;
                console.log(`  Ready: ${formatDuration(result.durationSec)} of audio, ${(result.bytes / 1024 / 1024).toFixed(1)} MB, took ${formatDuration((Date.now() - started) / 1000)}.`);
            } else if (result.outcome === 'gone') {
                results.skipped += 1;
                console.log('  Stopped: its audio entry was deleted or taken over meanwhile.');
            } else {
                results[result.outcome === 'waiting' ? 'waiting' : result.outcome === 'skipped' ? 'skipped' : 'failed'] += 1;
                console.log(`  ${result.outcome === 'waiting' ? 'Waiting for quota' : result.outcome === 'skipped' ? 'Skipped' : 'Failed'}: ${result.error}`);
                if (result.outcome === 'waiting') break; // the rest would hit the same limit
            }
        }

        console.log(
            `\nDone: ${results.ready} ready` +
                (results.failed ? `, ${results.failed} failed` : '') +
                (results.waiting ? `, stopped for quota` : '') +
                (results.skipped ? `, ${results.skipped} skipped` : '') +
                (stopping ? ' (stopped early; run the same command again to continue)' : '') +
                '.'
        );
        if (results.failed || results.waiting) process.exitCode = 1;
    } finally {
        await mongoose.disconnect();
    }
};

main().catch((error) => {
    console.error(`\nFailed: ${error.message}`);
    process.exitCode = 1;
});
