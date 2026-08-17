import { BASE_URL } from "../../utils/apiPaths";

// Text sizing per consumer — the dashboard grid card and the larger editor
// preview need different scales even though both are the same 2:3 shape.
const SIZE_STYLES = {
  sm: {
    padding: "p-3",
    title: "text-sm",
    subtitle: "text-[9px]",
    author: "text-[9px]",
    gap: "gap-0.5",
  },
  md: {
    padding: "p-4",
    title: "text-lg",
    subtitle: "text-[11px]",
    author: "text-xs",
    gap: "gap-1",
  },
  lg: {
    padding: "p-6",
    title: "text-2xl",
    subtitle: "text-sm",
    author: "text-sm",
    gap: "gap-1.5",
  },
};

const CoverPreview = ({
  title,
  subtitle,
  author,
  coverImage,
  size = "md",
  rounded = "rounded-xl",
  className = "",
}) => {
  const coverImageUrl = coverImage
    ? coverImage.startsWith("http")
      ? coverImage
      : `${BASE_URL}${coverImage}`.replace(/\\/g, "/")
    : null;

  const s = SIZE_STYLES[size] || SIZE_STYLES.md;
  const textShadow = "0 1px 3px rgba(0,0,0,0.85), 0 2px 8px rgba(0,0,0,0.5)";

  return (
    <div
      className={`relative aspect-[2/3] w-full overflow-hidden ${rounded} ${
        coverImageUrl ? "bg-gray-200" : "bg-gradient-to-br from-accent to-accent-secondary"
      } ${className}`}
    >
      {coverImageUrl && (
        <img
          src={coverImageUrl}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          onError={(e) => {
            e.target.style.display = "none";
          }}
        />
      )}

      {/* Legibility scrim: always darkens toward the bottom regardless of the
          source image's own tone, so white cover-typography stays readable
          over both light and dark/busy photos. */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/15 to-transparent" />

      {/* Cover typography */}
      <div className={`absolute inset-0 flex flex-col justify-end ${s.padding} ${s.gap}`}>
        <h3
          className={`font-serif font-bold text-white leading-tight line-clamp-3 ${s.title}`}
          style={{ textShadow }}
        >
          {title || "Untitled Book"}
        </h3>
        {subtitle && subtitle.trim() && (
          <p
            className={`font-serif italic text-white/90 leading-snug line-clamp-2 ${s.subtitle}`}
            style={{ textShadow }}
          >
            {subtitle}
          </p>
        )}
        <p
          className={`font-serif text-white/85 uppercase tracking-wider mt-0.5 ${s.author}`}
          style={{ textShadow }}
        >
          {author || "Unknown Author"}
        </p>
      </div>
    </div>
  );
};

export default CoverPreview;
