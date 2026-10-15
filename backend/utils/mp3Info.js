// Reads an MP3 file's frame headers to check that it really is MP3 audio
// and to work out its duration. Walks every frame, so CBR and VBR files
// both come out exact, with no decoding and no dependency. Only MPEG audio
// Layer III (MP3) is accepted.

// Layer III bitrates (kbps) by bitrate index; index 0 (free format) and 15
// (bad) are rejected.
const BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SAMPLE_RATES = {
    3: [44100, 48000, 32000], // MPEG-1
    2: [22050, 24000, 16000], // MPEG-2
    0: [11025, 12000, 8000], // MPEG-2.5
};

// Enough consecutive frames that random bytes can't pass (~0.25s of audio).
const MIN_FRAMES = 10;

// Parses the 4-byte frame header at `offset`. Returns null if it isn't one.
const readFrameHeader = (buffer, offset) => {
    if (offset + 4 > buffer.length) return null;
    if (buffer[offset] !== 0xff || (buffer[offset + 1] & 0xe0) !== 0xe0) return null;
    const version = (buffer[offset + 1] >> 3) & 0x03; // 3=V1, 2=V2, 0=V2.5, 1=reserved
    const layer = (buffer[offset + 1] >> 1) & 0x03; // 1 = Layer III
    const bitrateIndex = (buffer[offset + 2] >> 4) & 0x0f;
    const sampleRateIndex = (buffer[offset + 2] >> 2) & 0x03;
    const padding = (buffer[offset + 2] >> 1) & 0x01;
    const channelMode = (buffer[offset + 3] >> 6) & 0x03;
    if (version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) return null;

    const isV1 = version === 3;
    const bitrate = (isV1 ? BITRATES_V1 : BITRATES_V2)[bitrateIndex] * 1000;
    const sampleRate = SAMPLE_RATES[version][sampleRateIndex];
    const samplesPerFrame = isV1 ? 1152 : 576;
    const frameLength = Math.floor(((samplesPerFrame / 8) * bitrate) / sampleRate) + padding;
    return { frameLength, sampleRate, samplesPerFrame, bitrate, channels: channelMode === 3 ? 1 : 2 };
};

// Size of a leading ID3v2 tag (0 if none). Its size field is "syncsafe"
// (7 bits per byte).
const id3v2Length = (buffer) => {
    if (buffer.length < 10 || buffer.toString('latin1', 0, 3) !== 'ID3') return 0;
    const size = ((buffer[6] & 0x7f) << 21) | ((buffer[7] & 0x7f) << 14) | ((buffer[8] & 0x7f) << 7) | (buffer[9] & 0x7f);
    const hasFooter = (buffer[5] & 0x10) !== 0;
    return 10 + size + (hasFooter ? 10 : 0);
};

// Returns { durationSec, frames, sampleRate, channels, averageKbps } or
// throws an Error with a user-facing message if `buffer` isn't valid MP3.
const readMp3Info = (buffer) => {
    if (!Buffer.isBuffer(buffer) || buffer.length < 4) throw new Error('The file is empty or not an MP3.');

    let offset = id3v2Length(buffer);
    // The first frame must start soon after the tag; allow a little junk.
    const searchEnd = Math.min(buffer.length, offset + 64 * 1024);
    let first = null;
    for (; offset < searchEnd; offset++) {
        const header = readFrameHeader(buffer, offset);
        // A real first frame is followed by another valid header.
        if (header && readFrameHeader(buffer, offset + header.frameLength)) {
            first = header;
            break;
        }
    }
    if (!first) throw new Error("This file isn't MP3 audio. Export it as .mp3 and try again.");

    let frames = 0;
    let samples = 0;
    let audioBytes = 0;
    while (offset < buffer.length) {
        const header = readFrameHeader(buffer, offset);
        if (!header || header.sampleRate !== first.sampleRate) {
            // An ID3v1 tag ("TAG", 128 bytes) or a few padding bytes at the
            // end are normal; anything more means the stream is broken.
            const rest = buffer.length - offset;
            if (rest <= 128 + 16) break;
            throw new Error('This MP3 file is damaged (its audio frames stop partway through).');
        }
        if (offset + header.frameLength > buffer.length) break; // truncated last frame: ignore it
        frames += 1;
        samples += header.samplesPerFrame;
        audioBytes += header.frameLength;
        offset += header.frameLength;
    }
    if (frames < MIN_FRAMES) throw new Error('This MP3 file is too short or not valid audio.');

    const durationSec = samples / first.sampleRate;
    return {
        durationSec,
        frames,
        sampleRate: first.sampleRate,
        channels: first.channels,
        averageKbps: Math.round((audioBytes * 8) / durationSec / 1000),
    };
};

module.exports = { readMp3Info };
