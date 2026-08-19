import { motion } from "framer-motion";
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
}) => (
  <motion.div
    className={`relative [perspective:1500px] ${className}`}
    initial="rest"
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
  </motion.div>
);

export default FlipCover;
