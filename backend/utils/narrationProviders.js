const tts = require('./tts');
const localTts = require('./localTts');

// Which engine turns narration text into speech. AUDIO_PROVIDER picks the
// one the server's job worker (utils/audioJobs.js) uses:
//   gemini (default) — Gemini TTS over the API. Counts toward
//                      AUDIO_DAILY_CHAR_LIMIT and Google's own quota.
//   local            — Kokoro-82M on this machine's CPU, free and offline
//                      (utils/localTts.js). Only for a backend running on
//                      your own PC with kokoro-js installed; Render's free
//                      instance has neither the memory (~900MB) nor the
//                      package. scripts/narrate-book.js uses it directly.
// Both return 24 kHz mono PCM, so chunking, encoding, storage and the
// reader player are identical either way.

const PROVIDERS = {
    gemini: {
        name: 'gemini',
        label: 'Gemini',
        voices: tts.VOICES,
        defaultVoice: tts.DEFAULT_VOICE,
        isValidVoice: tts.isValidVoice,
        model: () => tts.getTtsModel(),
        // Changes whenever the output would sound different, so resumed
        // chapters never mix parts from two engines.
        engineKey: () => `gemini:${tts.getTtsModel()}`,
        chargesQuota: true,
        concurrency: () => tts.getConcurrency(),
        synthesize: (text, options) => tts.synthesizeSpeech(text, options),
        describeError: tts.describeTtsError,
    },
    local: {
        name: 'local',
        label: 'Local (Kokoro)',
        voices: localTts.VOICES,
        defaultVoice: localTts.DEFAULT_VOICE,
        isValidVoice: localTts.isValidVoice,
        model: () => localTts.engineKey(),
        engineKey: () => `local:${localTts.engineKey()}`,
        chargesQuota: false,
        // CPU-bound and already multi-threaded inside ONNX Runtime.
        concurrency: () => 1,
        synthesize: (text, { voice } = {}) => localTts.synthesizeSpeech(text, { voice }),
        describeError: localTts.describeError,
    },
};

const PROVIDER_NAMES = Object.keys(PROVIDERS);

let warnedUnknown = false;
const getProviderName = () => {
    const name = String(process.env.AUDIO_PROVIDER || 'gemini').trim().toLowerCase();
    if (PROVIDERS[name]) return name;
    if (!warnedUnknown) {
        console.warn(`[audio] Unknown AUDIO_PROVIDER "${name}"; using gemini.`);
        warnedUnknown = true;
    }
    return 'gemini';
};

// getProvider() → the configured one; getProvider('local') → that one.
const getProvider = (name = getProviderName()) => {
    const provider = PROVIDERS[name];
    if (!provider) throw new Error(`Unknown narration provider "${name}" (use ${PROVIDER_NAMES.join(' or ')}).`);
    return provider;
};

module.exports = { PROVIDER_NAMES, getProvider, getProviderName };
