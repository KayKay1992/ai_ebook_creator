import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import FlipCover from "./FlipCover";
import PriceBadge from "./PriceBadge";
import { getBookBadge } from "../../utils/kenlibsPricing";

// Entrance variant this card plays when its parent row (see KenlibsPage's
// KenlibsRow) crosses "hidden" -> "show" — the parent orchestrates the
// stagger via staggerChildren, this just defines what "show" looks like
// for a single card.
const cardEntranceVariants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } },
};

// Fanned-shelf tilt for the storefront's Featured row (Step 39, point 3) —
// alternating lean + rest-height per position so a row of covers reads as
// physical objects leaned against each other rather than a flat grid.
// Resets to upright + lifts on hover (via the existing `group` from the
// card's own Link, same mechanism FlipCover's shadow transition already
// uses) so the interaction still reads as "picking the book up," not just a
// static rotation. Opt-in only — every other card grid (Latest Releases,
// Bundles, search results) renders with angled=false, completely unchanged.
const TILT_PATTERN = [
  "-rotate-3 translate-y-1",
  "rotate-2 -translate-y-1",
  "-rotate-2 translate-y-2",
  "rotate-3",
  "rotate-1 -translate-y-2",
];

const KenlibsBookCard = ({ book, angled = false, tiltIndex = 0 }) => {
  const badge = getBookBadge(book);
  const tiltClass = angled ? TILT_PATTERN[tiltIndex % TILT_PATTERN.length] : "";

  return (
    <Link
      to={`/kenlibs/book/${book._id}`}
      className="group block w-40 sm:w-48 flex-shrink-0 snap-start"
    >
      <motion.div variants={cardEntranceVariants}>
        <div
          className={`relative transition-transform duration-300 ease-out ${tiltClass} ${
            angled ? "group-hover:rotate-0 group-hover:-translate-y-2" : ""
          }`}
        >
          <FlipCover
            title={book.title}
            subtitle={book.subtitle}
            author={book.author}
            coverImage={book.coverImage}
            coverDesign={book.coverDesign}
            size="sm"
            rounded="rounded-2xl"
            className={`transition-shadow duration-300 ${
              angled ? "shadow-lg group-hover:shadow-2xl" : "shadow-sm group-hover:shadow-xl"
            }`}
          />
          <PriceBadge badge={badge} />
        </div>

        <div className="mt-3">
          <h3 className="font-serif font-semibold text-gray-900 text-sm leading-snug line-clamp-2">
            {book.title || "Untitled Book"}
          </h3>
          <p className="text-xs text-gray-500 mt-0.5 truncate">
            {book.author || "Unknown Author"}
          </p>
        </div>
      </motion.div>
    </Link>
  );
};

export default KenlibsBookCard;
