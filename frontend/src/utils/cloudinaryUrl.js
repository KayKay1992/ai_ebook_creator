// Inserts a Cloudinary delivery transformation right after "/upload/" so
// covers are served resized and in the browser's best format (WebP/AVIF via
// f_auto) instead of the original full-resolution upload. c_limit only ever
// shrinks — a small original is never upscaled. Anything that isn't a
// Cloudinary upload URL (empty, a data: URI, a legacy /uploads/ path, a
// placeholder service) is returned unchanged.
export const IMAGE_WIDTHS = {
  card: 400,
  detail: 800,
  thumb: 160,
};

const CLOUDINARY_UPLOAD = /^(https?:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.*)$/;

const cloudinaryUrl = (url, width = IMAGE_WIDTHS.card) => {
  if (typeof url !== "string") return url;
  const match = url.match(CLOUDINARY_UPLOAD);
  if (!match) return url;
  return `${match[1]}c_limit,w_${width},q_auto,f_auto/${match[2]}`;
};

export default cloudinaryUrl;
