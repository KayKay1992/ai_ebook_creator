// Local quality check for AI narration, before the audiobook feature is
// built on top of it. Generates a short MP3 (~20s) with Gemini TTS using
// your backend/.env, so you can listen to voices and models.
//
// Usage (from backend/):
//   node scripts/tts-sample.js                         default voice + model
//   node scripts/tts-sample.js --voice Charon
//   node scripts/tts-sample.js --voice Kore --model gemini-2.5-pro-preview-tts
//   node scripts/tts-sample.js --text "Your own paragraph here."
//   node scripts/tts-sample.js --style "Read warmly and slowly, like an audiobook narrator"
//   node scripts/tts-sample.js --list-voices
//   node scripts/tts-sample.js --upload                also tests Cloudinary (see below)
//
// Needs GEMINI_API_KEY. Writes tts-sample-<voice>-<model>.mp3 in the
// current directory (gitignored) and prints its path.
//
// --upload additionally uploads the MP3 to Cloudinary as an *authenticated*
// asset (needs the CLOUDINARY_* vars), checks that the plain URL is refused,
// that a time-limited private_download_url works and supports seeking (HTTP
// Range), and that an expired one is refused, then deletes the asset again.
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');
const { pcmFromInlineData, encodeMp3, DEFAULT_KBPS } = require('../utils/audioEncoding');

// The 30 prebuilt voices from Google's speech-generation docs, with
// Google's own one-word descriptions. The SDK types accept any string.
const VOICES = {
    Zephyr: 'Bright', Puck: 'Upbeat', Charon: 'Informative', Kore: 'Firm', Fenrir: 'Excitable',
    Leda: 'Youthful', Orus: 'Firm', Aoede: 'Breezy', Callirrhoe: 'Easy-going', Autonoe: 'Bright',
    Enceladus: 'Breathy', Iapetus: 'Clear', Umbriel: 'Easy-going', Algieba: 'Smooth', Despina: 'Smooth',
    Erinome: 'Clear', Algenib: 'Gravelly', Rasalgethi: 'Informative', Laomedeia: 'Upbeat', Achernar: 'Soft',
    Alnilam: 'Firm', Schedar: 'Even', Gacrux: 'Mature', Pulcherrima: 'Forward', Achird: 'Friendly',
    Zubenelgenubi: 'Casual', Vindemiatrix: 'Gentle', Sadachbia: 'Lively', Sadaltager: 'Knowledgeable', Sulafat: 'Warm',
};

const DEFAULT_MODEL = process.env.TTS_MODEL || 'gemini-3.8-flash-tts';
const DEFAULT_VOICE = 'Sulafat';

// ~55 words: about 20 seconds at a normal narration pace.
const SAMPLE_TEXT = [
    'Chapter One. The Quiet Hour.',
    'Every morning, before the city woke, Amara walked to the edge of the lagoon and watched the light arrive.',
    'She had learned that the best ideas came quietly, the way the tide did: not all at once, but a little more each day.',
].join('\n\n');

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

const fetchStatus = async (url, headers = {}) => {
    const res = await fetch(url, { headers, redirect: 'follow' });
    const info = {
        status: res.status,
        contentType: res.headers.get('content-type'),
        contentLength: res.headers.get('content-length'),
        acceptRanges: res.headers.get('accept-ranges'),
        contentRange: res.headers.get('content-range'),
        cacheControl: res.headers.get('cache-control'),
    };
    await res.arrayBuffer().catch(() => {});
    return info;
};

const testCloudinary = async (mp3) => {
    const cloudinary = require('../config/cloudinary');
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_SECRET) {
        throw new Error('--upload needs CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET.');
    }

    console.log('\nCloudinary check');
    const uploaded = await new Promise((resolve, reject) => {
        cloudinary.uploader
            .upload_stream(
                { folder: 'ebook-creator/audio/_samples', resource_type: 'video', type: 'authenticated', format: 'mp3' },
                (error, result) => (error ? reject(error) : resolve(result))
            )
            .end(mp3);
    });
    const { public_id: publicId } = uploaded;
    console.log(`  uploaded ${publicId} (${uploaded.bytes} bytes, ${uploaded.duration}s, type=${uploaded.type})`);

    try {
        const plainUrl = cloudinary.url(publicId, { resource_type: 'video', type: 'authenticated', format: 'mp3' });
        console.log('  unsigned delivery URL:      ', (await fetchStatus(plainUrl)).status, '(expect 401/404: not public)');

        const nowSec = Math.floor(Date.now() / 1000);
        const signed = (expiresAt) =>
            cloudinary.utils.private_download_url(publicId, 'mp3', {
                resource_type: 'video',
                type: 'authenticated',
                expires_at: expiresAt,
            });

        const full = await fetchStatus(signed(nowSec + 600));
        console.log('  private_download_url (10m): ', full);
        const ranged = await fetchStatus(signed(nowSec + 600), { Range: 'bytes=1000-1999' });
        console.log('  same URL, Range 1000-1999:  ', ranged, ranged.status === 206 ? '→ seeking works' : '→ NO byte ranges');
        console.log('  expired URL:                ', (await fetchStatus(signed(nowSec - 60))).status, '(expect 4xx)');
    } finally {
        const destroyed = await cloudinary.uploader.destroy(publicId, { resource_type: 'video', type: 'authenticated' });
        console.log(`  deleted test asset: ${destroyed.result}`);
    }
};

const main = async () => {
    const args = parseArgs(process.argv.slice(2));

    if (args['list-voices']) {
        Object.entries(VOICES).forEach(([name, desc]) => console.log(`${name.padEnd(15)} ${desc}`));
        return;
    }
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set in backend/.env');

    const voice = args.voice || DEFAULT_VOICE;
    const model = args.model || DEFAULT_MODEL;
    if (!VOICES[voice]) console.warn(`Note: "${voice}" isn't in the documented voice list; trying anyway.`);
    const text = typeof args.text === 'string' ? args.text : SAMPLE_TEXT;
    // A style instruction is sent as a lead-in the model follows rather
    // than reads out (Google's documented prompting style for TTS).
    const prompt = typeof args.style === 'string' ? `${args.style}:\n\n${text}` : text;

    console.log(`Model: ${model}\nVoice: ${voice} (${VOICES[voice] || '?'})\nCharacters: ${text.length}`);

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const started = Date.now();
    const response = await ai.models.generateContent({
        model,
        contents: [{ parts: [{ text: prompt }] }],
        config: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
        },
    });
    const inline = response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
    if (!inline) throw new Error(`No audio in the response: ${JSON.stringify(response).slice(0, 300)}`);

    const { samples, sampleRate } = pcmFromInlineData(inline);
    const { buffer, durationSec } = await encodeMp3([samples], { sampleRate });

    const file = path.resolve(`tts-sample-${voice}-${model}.mp3`);
    fs.writeFileSync(file, buffer);
    console.log(
        `Returned: ${inline.mimeType}\n` +
            `Audio: ${durationSec.toFixed(1)}s, ${(buffer.length / 1024).toFixed(0)} KB at ${DEFAULT_KBPS} kbps mono ` +
            `(≈ ${((buffer.length / durationSec) * 600 / 1e6).toFixed(1)} MB per 10 min)\n` +
            `Took: ${((Date.now() - started) / 1000).toFixed(1)}s, ` +
            `tokens: ${JSON.stringify(response.usageMetadata?.candidatesTokenCount ?? '?')} audio\n` +
            `Saved: ${file}`
    );

    if (args.upload) await testCloudinary(buffer);
};

main().catch((error) => {
    console.error(`\nFailed: ${error.message}`);
    process.exitCode = 1;
});
