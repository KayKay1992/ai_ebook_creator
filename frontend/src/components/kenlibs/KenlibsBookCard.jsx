import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Star, Check } from "lucide-react";
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

const KenlibsBookCard = ({ book, angled = false, tiltIndex = 0, rating, owned = false }) => {
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
          {/* Owned takes over the price badge's exact spot rather than
              showing alongside it — once a reader already has access, the
              price is no longer relevant information. */}
          {owned ? (
            <span className="absolute top-3 right-3 z-10 flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold shadow-sm backdrop-blur-sm bg-emerald-500 text-white">
              <Check className="w-3 h-3" />
              Owned
            </span>
          ) : (
            <PriceBadge badge={badge} />
          )}
        </div>

        <div className="mt-3">
          <h3 className="font-serif font-semibold text-gray-900 text-sm leading-snug line-clamp-2">
            {book.title || "Untitled Book"}
          </h3>
          <p className="text-xs text-gray-500 mt-0.5 truncate">
            {book.author || "Unknown Author"}
          </p>
          {/* Compact single-star + average + count (Step 44, point 5) —
              deliberately not the full 5-star StarRating used on the detail
              page, which would be too wide at this card's w-40/w-48. Only
              renders once the book has at least one rating, so an
              unrated book's card looks exactly as it did before this step. */}
          {rating?.count > 0 && (
            <div className="flex items-center gap-1 mt-1">
              <Star className="w-3 h-3 fill-accent text-accent flex-shrink-0" />
              <span className="text-xs font-medium text-gray-700">{rating.average}</span>
              <span className="text-xs text-gray-400">({rating.count})</span>
            </div>
          )}
        </div>
      </motion.div>
    </Link>
  );
};

export default KenlibsBookCard;
