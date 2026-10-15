const path = require('path');
const { createRequire } = require('module');

// Loads Kokoro-82M (Apache-2.0) through kokoro-js, once per process. Kept
// apart from utils/localTts.js so tests can mock just this file.
//
// kokoro-js is NOT a backend dependency: it lives in scripts/local-tts/
// with its own package.json, so its ~400MB ONNX runtime never ships to
// Render. Install it on the machine that narrates:
//   npm install --prefix scripts/local-tts      (from backend/)
// The model (311MB fp32, 89MB q8) downloads from Hugging Face on first use
// into scripts/local-tts/.model-cache/ (gitignored); after that it loads
// in ~2s with no network. fp32 is the default: on an i7-6600U it ran at
// ~0.95x real time, while q8 was ~2x real time (older CPUs lack fast int8).

const LOCAL_TTS_DIR = path.join(__dirname, '..', 'scripts', 'local-tts');
const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const INSTALL_HINT = 'Local narration needs kokoro-js. From backend/, run: npm install --prefix scripts/local-tts';

const getDtype = () => (process.env.LOCAL_TTS_DTYPE === 'q8' ? 'q8' : 'fp32');

class LocalTtsUnavailableError extends Error {
    constructor(message = INSTALL_HINT) {
        super(message);
        this.name = 'LocalTtsUnavailableError';
    }
}

const loadModule = () => {
    const localRequire = createRequire(path.join(LOCAL_TTS_DIR, 'package.json'));
    try {
        const { KokoroTTS, TextSplitterStream } = localRequire('kokoro-js');
        // The same module instance kokoro-js uses, so the cache dir applies.
        const { env } = localRequire('@huggingface/transformers');
        env.cacheDir = path.join(LOCAL_TTS_DIR, '.model-cache');
        return { KokoroTTS, TextSplitterStream };
    } catch (error) {
        if (error.code === 'MODULE_NOT_FOUND') throw new LocalTtsUnavailableError();
        throw error;
    }
};

let enginePromise = null;

// Resolves to { tts, TextSplitterStream, dtype }. The first call loads (and
// on a fresh machine downloads) the model; later calls share it.
const getEngine = () => {
    if (!enginePromise) {
        enginePromise = (async () => {
            const { KokoroTTS, TextSplitterStream } = loadModule();
            const dtype = getDtype();
            const tts = await KokoroTTS.from_pretrained(MODEL_ID, { dtype, device: 'cpu' });
            return { tts, TextSplitterStream, dtype };
        })();
        // A failed load (not installed, download interrupted) can be retried.
        enginePromise.catch(() => {
            enginePromise = null;
        });
    }
    return enginePromise;
};

const engineKey = () => `kokoro-82m-v1.0-${getDtype()}`;

module.exports = { MODEL_ID, LOCAL_TTS_DIR, INSTALL_HINT, LocalTtsUnavailableError, getEngine, engineKey };
