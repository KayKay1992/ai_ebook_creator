import { useState } from "react";
import { motion } from "framer-motion";
import { FlipHorizontal2 } from "lucide-react";
import CoverPreview from "../cards/CoverPreview";

// Front/back flip on hover — same perspective + preserve-3d technique as
// before (Step 25), but the rotation itself is now a Framer Motion spring
// instead of a linear CSS transition, so it settles with a touch of real
// physics rather than a mechanical ease-out. Self-contained: the hover
// trigger lives on this component's own root, so callers don't need any
// `group`/`group-hover` wiring — matches the storefront's own "hover a
// cover" copy (the cover itself is the trigger zone, not the whole card).
const flipVariants = {
  rest: { rotateY: 0 },
  hover: { rotateY: 180 },
};

const FlipCover = ({
  title,
  subtitle,
  author,
  coverImage,
  coverDesign,
  size = "sm",
  rounded = "rounded-2xl",
  className = "",
}) => {
  // Touch devices have no hover, so `whileHover` above never fires there —
  // this button is the touch equivalent, self-contained so it works whether
  // or not a caller (e.g. KenlibsBookCard) has this whole component nested
  // inside a Link: preventDefault/stopPropagation keep the tap from also
  // triggering that Link's navigation. Hidden at md+ since desktop already
  // has hover for this.
  const [flipped, setFlipped] = useState(false);

  return (
    <motion.div
      className={`relative [perspective:1500px] ${className}`}
      initial="rest"
      animate={flipped ? "hover" : "rest"}
      whileHover="hover"
    >
      <motion.div
        className="relative w-full [transform-style:preserve-3d]"
        variants={flipVariants}
        transition={{ type: "spring", stiffness: 280, damping: 28 }}
      >
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
      </motion.div>

      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setFlipped((f) => !f);
        }}
        aria-label={flipped ? "Show front cover" : "Show back cover"}
        className="md:hidden absolute bottom-2 right-2 z-10 w-8 h-8 rounded-full bg-black/50 backdrop-blur-sm text-white flex items-center justify-center shadow-md active:scale-90 transition-transform"
      >
        <FlipHorizontal2 className="w-4 h-4" />
      </button>
    </motion.div>
  );
};

export default FlipCover;
