// Free, offline narration sample: Kokoro-82M (Apache-2.0) via kokoro-js,
// running on the CPU with no account, API key or network after the first
// run. Makes a ~30s MP3 through the same code and encoder as real
// narration (utils/localTts.js), to compare against the Gemini samples
// from scripts/tts-sample.js.
//
// One-time setup (from backend/; installs into scripts/local-tts/ only, so
// the ~400MB ONNX runtime never ends up in the Render deploy):
//   npm install --prefix scripts/local-tts
//
// Usage (from backend/):
//   node scripts/local-tts-sample.js                     default voice (af_heart)
//   node scripts/local-tts-sample.js --voice bm_george
//   node scripts/local-tts-sample.js --text "Your own paragraph here."
//   node scripts/local-tts-sample.js --dtype q8          smaller, but slower on older CPUs
//   node scripts/local-tts-sample.js --list-voices
//
// The first run downloads the model (311MB fp32) into
// scripts/local-tts/.model-cache/ (gitignored). Writes
// tts-sample-local-<voice>.mp3 in the current directory (gitignored).
const fs = require('fs');
const path = require('path');

const parseArgs = (argv) => {
    const args = {};
    for (let i = 0; i < argv.length; i++) {
        const key = argv[i];
        if (!key.startsWith('--')) continue;
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

const args = parseArgs(process.argv.slice(2));
// Read by utils/kokoroEngine.js, so set before it loads.
if (args.dtype === 'q8') process.env.LOCAL_TTS_DTYPE = 'q8';

const { encodeMp3, DEFAULT_KBPS } = require('../utils/audioEncoding');
const { VOICES, DEFAULT_VOICE, isValidVoice, synthesizeSpeech, engineKey } = require('../utils/localTts');
const { getEngine } = require('../utils/kokoroEngine');

// The first two paragraphs are word for word the Gemini sample's text, for
// a like-for-like comparison; the third makes it up to ~30 seconds.
const SAMPLE_TEXT = [
    'Chapter One. The Quiet Hour.',
    'Every morning, before the city woke, Amara walked to the edge of the lagoon and watched the light arrive.',
    'She had learned that the best ideas came quietly, the way the tide did: not all at once, but a little more each day.',
    "Her grandmother used to say that patience was a kind of courage. Back then, Amara hadn't understood. Now, with the first boats sliding out across the silver water, she was beginning to.",
].join('\n\n');

const printVoices = () => VOICES.forEach((v) => console.log(`${v.name.padEnd(13)} ${v.description}`));

const main = async () => {
    if (args['list-voices']) {
        printVoices();
        return;
    }
    const voice = typeof args.voice === 'string' ? args.voice : DEFAULT_VOICE;
    if (!isValidVoice(voice)) {
        printVoices();
        throw new Error(`Unknown voice "${voice}" (see the list above).`);
    }
    const text = typeof args.text === 'string' ? args.text : SAMPLE_TEXT;

    let started = Date.now();
    await getEngine();
    console.log(`Engine: ${engineKey()}, loaded in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    console.log(`Voice: ${voice} (${VOICES.find((v) => v.name === voice).description})\nCharacters: ${text.length}`);

    started = Date.now();
    const { samples, sampleRate } = await synthesizeSpeech(text, { voice });
    const synthSec = (Date.now() - started) / 1000;

    const { buffer, durationSec } = await encodeMp3([samples], { sampleRate });
    const file = path.resolve(`tts-sample-local-${voice}.mp3`);
    fs.writeFileSync(file, buffer);
    console.log(
        `Audio: ${durationSec.toFixed(1)}s, ${(buffer.length / 1024).toFixed(0)} KB at ${DEFAULT_KBPS} kbps mono\n` +
            `Synthesis: ${synthSec.toFixed(1)}s (real-time factor ${(synthSec / durationSec).toFixed(2)}; ` +
            `below 1 is faster than real time)\n` +
            `Peak memory (RSS): ${(process.memoryUsage().rss / 1e6).toFixed(0)} MB\n` +
            `Saved: ${file}`
    );
};

main().catch((error) => {
    console.error(`\nFailed: ${error.message}`);
    process.exitCode = 1;
});
