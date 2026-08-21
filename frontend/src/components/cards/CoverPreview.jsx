// Text sizing per consumer — the dashboard grid card and the larger editor
// preview need different scales even though both are the same 2:3 shape.
const SIZE_STYLES = {
  sm: {
    padding: "p-3",
    title: "text-sm",
    subtitle: "text-[9px]",
    author: "text-[9px]",
    gap: "gap-0.5",
    genreTag: "text-[7px] px-1.5 py-0.5",
    backText: "text-[8px] leading-snug",
    backGap: "gap-1.5",
    avatar: "w-5 h-5",
  },
  md: {
    padding: "p-4",
    title: "text-lg",
    subtitle: "text-[11px]",
    author: "text-xs",
    gap: "gap-1",
    genreTag: "text-[9px] px-2 py-0.5",
    backText: "text-[10px] leading-relaxed",
    backGap: "gap-2",
    avatar: "w-7 h-7",
  },
  lg: {
    padding: "p-6",
    title: "text-2xl",
    subtitle: "text-sm",
    author: "text-sm",
    gap: "gap-1.5",
    genreTag: "text-xs px-2.5 py-1",
    backText: "text-sm leading-relaxed",
    backGap: "gap-3",
    avatar: "w-10 h-10",
  },
};

// Back cover always renders on a dark solid ground — matches the printing
// convention (light body copy on a dark or muted panel) regardless of the
// front cover's own background choice.
const BACK_BG = "bg-gray-900";

const CoverPreview = ({
  title,
  subtitle,
  author,
  coverImage,
  coverDesign,
  side = "front",
  size = "md",
  rounded = "rounded-xl",
  className = "",
}) => {
  const s = SIZE_STYLES[size] || SIZE_STYLES.md;
  // Crisp near-shadow to keep glyph edges sharp, plus a softer, more spread
  // ambient shadow beneath for depth — reads as set typography rather than
  // text with a single heavy blur sitting on top of the background.
  const textShadow = "0 1px 2px rgba(0,0,0,0.65), 0 6px 16px rgba(0,0,0,0.35)";

  // coverDesign is optional — books created before the Cover Designer
  // existed simply don't have it, so every field here falls back to
  // Step 15's original look (white text, left-aligned, image background).
  const front = coverDesign?.front || {};
  const back = coverDesign?.back || {};

  // Pre-rendered 3D mockup (Step 40) — a finished front/back render made
  // externally and uploaded as-is, an either/or alternative to the
  // generated flat design below. When active it supersedes the flat design
  // for whichever side is being rendered, exactly like
  // coverDesign.front.backgroundImage already supersedes the legacy
  // top-level coverImage above. Falls through to the flat design per side
  // if that side's image hasn't been uploaded yet (e.g. only the front was
  // uploaded so far) — never a broken/blank cover.
  const render3D = coverDesign?.render3D;
  const is3DActive = Boolean(render3D?.isActive);

  const backgroundStyle = front.backgroundStyle || "image";
  const titleColor = front.titleColor || "#ffffff";
  const titleAlign = front.titleAlign || "left";
  const showSubtitle = front.showSubtitle !== false;

  // coverDesign.front.backgroundImage supersedes the legacy top-level
  // coverImage once a book has used the designer; coverImage remains the
  // fallback for books that haven't.
  const coverImageUrl = front.backgroundImage || coverImage || null;
  const useImage = backgroundStyle === "image" && !!coverImageUrl;
  const useSolid = backgroundStyle === "solid";
  const useGradient = !useImage && !useSolid;

  // Empty gradientFrom/To (the schema default) means "use the theme
  // accent" — CSS custom properties, not a hardcoded hex, so this default
  // preset stays in sync if the theme tokens ever change, and books that
  // picked gradient style before this field existed still render exactly
  // as they did before (this was previously a hardcoded Tailwind class
  // with no way to choose a different gradient at all).
  const gradientFrom = front.gradientFrom || "var(--color-accent)";
  const gradientTo = front.gradientTo || "var(--color-accent-secondary)";

  const ALIGN_ITEMS = { left: "items-start", center: "items-center", right: "items-end" };
  const ALIGN_TEXT = { left: "text-left", center: "text-center", right: "text-right" };

  if (side === "back") {
    if (is3DActive && render3D.backImage) {
      return (
        <div className={`relative aspect-[2/3] w-full overflow-hidden ${rounded} bg-gray-200 ${className}`}>
          <img
            src={render3D.backImage}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            onError={(e) => {
              e.target.style.display = "none";
            }}
          />
        </div>
      );
    }

    const reviewQuotes = (back.reviewQuotes || []).slice(0, 3);
    return (
      <div
        className={`relative aspect-[2/3] w-full overflow-hidden ${rounded} ${BACK_BG} ${className} flex flex-col ${s.padding} ${s.backGap} text-white`}
      >
        {back.genreTag && back.genreTag.trim() && (
          <span
            className={`self-start rounded-full bg-white/10 text-white/80 font-medium uppercase tracking-wider ${s.genreTag}`}
          >
            {back.genreTag}
          </span>
        )}

        <p className={`font-serif italic text-white/90 ${s.backText} line-clamp-6`}>
          {back.blurb?.trim() || "No blurb yet — add one in the Cover Designer."}
        </p>

        {reviewQuotes.length > 0 && (
          <div className={`flex flex-col ${s.backGap} border-t border-white/10 pt-2 mt-1`}>
            {reviewQuotes.map((q, i) => (
              <div key={i}>
                <p className={`italic text-white/80 ${s.backText} line-clamp-2`}>"{q.quote}"</p>
                {q.attribution && (
                  <p className={`text-white/50 ${s.backText} mt-0.5`}>— {q.attribution}</p>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="mt-auto flex items-center gap-2 border-t border-white/10 pt-3">
          {back.authorPhoto ? (
            <img
              src={back.authorPhoto}
              alt=""
              className={`${s.avatar} rounded-full object-cover flex-shrink-0`}
            />
          ) : (
            <div
              className={`${s.avatar} rounded-full bg-white/10 flex-shrink-0`}
            />
          )}
          <div className="min-w-0">
            <p className={`font-semibold ${s.backText}`}>{author || "Unknown Author"}</p>
            {back.authorBio && (
              <p className={`text-white/60 ${s.backText} line-clamp-2`}>{back.authorBio}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (is3DActive && render3D.frontImage) {
    return (
      <div className={`relative aspect-[2/3] w-full overflow-hidden ${rounded} bg-gray-200 ${className}`}>
        <img
          src={render3D.frontImage}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          onError={(e) => {
            e.target.style.display = "none";
          }}
        />
      </div>
    );
  }

  return (
    <div
      className={`relative aspect-[2/3] w-full overflow-hidden ${rounded} ${
        useImage ? "bg-gray-200" : useSolid ? "bg-gray-900" : ""
      } ${className}`}
      style={
        useGradient
          ? { background: `linear-gradient(to bottom right, ${gradientFrom}, ${gradientTo})` }
          : undefined
      }
    >
      {useImage && (
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
          source image's own tone, so cover typography stays readable over
          both light and dark/busy photos. */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

      {front.genreTag && front.genreTag.trim() && (
        <span
          className={`absolute top-3 left-3 rounded-full bg-white/15 backdrop-blur-sm text-white font-medium uppercase tracking-wider ${s.genreTag}`}
          style={{ textShadow }}
        >
          {front.genreTag}
        </span>
      )}

      {/* Cover typography */}
      <div
        className={`absolute inset-0 flex flex-col justify-end ${ALIGN_ITEMS[titleAlign]} ${s.padding} ${s.gap}`}
      >
        <h3
          className={`font-serif font-bold leading-tight tracking-[0.01em] line-clamp-3 ${ALIGN_TEXT[titleAlign]} ${s.title}`}
          style={{ textShadow, color: titleColor }}
        >
          {title || "Untitled Book"}
        </h3>
        {showSubtitle && subtitle && subtitle.trim() && (
          <p
            className={`font-serif italic leading-snug tracking-[0.01em] line-clamp-2 ${ALIGN_TEXT[titleAlign]} ${s.subtitle}`}
            style={{ textShadow, color: titleColor, opacity: 0.9 }}
          >
            {subtitle}
          </p>
        )}

        {/* Thin rule above the author name — a small, deliberate divider so
            the byline reads as considered cover typography rather than
            another line of text stacked underneath the title. */}
        <div className="h-px w-8 my-1 opacity-40" style={{ backgroundColor: titleColor }} />

        <p
          className={`font-serif uppercase tracking-[0.15em] ${ALIGN_TEXT[titleAlign]} ${s.author}`}
          style={{ textShadow, color: titleColor, opacity: 0.85 }}
        >
          {author || "Unknown Author"}
        </p>
      </div>
    </div>
  );
};

export default CoverPreview;
