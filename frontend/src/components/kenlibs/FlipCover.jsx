import CoverPreview from "../cards/CoverPreview";

// CSS-only front/back flip, same transform technique as BookCard's 3D tilt
// (Step 15): a perspective wrapper around a preserve-3d layer that rotates
// on hover, with each face hidden when it's turned away. No React state and
// nothing re-renders on hover, so this stays cheap across a full grid.
// Requires a `group` class on an ancestor to trigger group-hover.
const FlipCover = ({
  title,
  subtitle,
  author,
  coverImage,
  coverDesign,
  size = "sm",
  rounded = "rounded-2xl",
  className = "",
}) => (
  <div className={`relative [perspective:1500px] ${className}`}>
    <div className="relative w-full transition-transform duration-500 ease-out [transform-style:preserve-3d] group-hover:[transform:rotateY(180deg)]">
      <div className="[backface-visibility:hidden]">
        <CoverPreview
          side="front"
          title={title}
          subtitle={subtitle}
          author={author}
          coverImage={coverImage}
          coverDesign={coverDesign}
          size={size}
          rounded={rounded}
        />
      </div>
      <div className="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)]">
        <CoverPreview
          side="back"
          title={title}
          subtitle={subtitle}
          author={author}
          coverImage={coverImage}
          coverDesign={coverDesign}
          size={size}
          rounded={rounded}
        />
      </div>
    </div>
  </div>
);

export default FlipCover;
