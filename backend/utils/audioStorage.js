const cloudinary = require('../config/cloudinary');
const { uploadBufferToCloudinary } = require('./cloudinaryUpload');

// Narration MP3s live in Cloudinary as *authenticated* assets: the plain
// delivery URL returns 401, so the only way to play one is a signed,
// expiring private_download_url from signedAudioUrl below. Checked against
// the live account: that URL is served directly by api.cloudinary.com (no
// redirect to a permanent URL), supports HTTP Range (206, so seeking
// works), and returns 401 once expired. Token-based expiring CDN URLs would
// need Cloudinary's paid Advanced plan. Trade-off of this approach: these
// downloads aren't CDN-cached and count double bandwidth.

const AUDIO_FOLDER = 'ebook-creator/audio';
const ASSET_OPTIONS = { resource_type: 'video', type: 'authenticated' };

const DEFAULT_URL_TTL_SECONDS = 3600;
const getUrlTtlSeconds = () => {
    const n = parseInt(process.env.AUDIO_URL_TTL_SECONDS, 10);
    // Clamped to 5 minutes .. 2 hours: long enough to finish a chapter,
    // short enough that a shared link soon stops working.
    return Number.isFinite(n) ? Math.min(Math.max(n, 300), 7200) : DEFAULT_URL_TTL_SECONDS;
};

const uploadChapterAudio = (buffer, bookId) =>
    uploadBufferToCloudinary(buffer, `${AUDIO_FOLDER}/${bookId}`, { ...ASSET_OPTIONS, format: 'mp3' });

// Resolves for "ok" and "not found" (already gone counts as deleted);
// throws on anything else so callers can keep the reference and retry.
const deleteAudioAsset = async (publicId) => {
    if (!publicId) return;
    const result = await cloudinary.uploader.destroy(publicId, { ...ASSET_OPTIONS, invalidate: true });
    if (result && result.result && !['ok', 'not found'].includes(result.result)) {
        throw new Error(`Cloudinary couldn't delete ${publicId}: ${result.result}`);
    }
};

const signedAudioUrl = (publicId, ttlSeconds = getUrlTtlSeconds()) => {
    const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
    const url = cloudinary.utils.private_download_url(publicId, 'mp3', { ...ASSET_OPTIONS, expires_at: expiresAt });
    return { url, expiresAt: new Date(expiresAt * 1000).toISOString() };
};

module.exports = {
    AUDIO_FOLDER,
    getUrlTtlSeconds,
    uploadChapterAudio,
    deleteAudioAsset,
    signedAudioUrl,
};
