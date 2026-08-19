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

const KenlibsBookCard = ({ book }) => {
  const badge = getBookBadge(book);

  return (
    <Link
      to={`/kenlibs/book/${book._id}`}
      className="group block w-40 sm:w-48 flex-shrink-0 snap-start"
    >
      <motion.div variants={cardEntranceVariants}>
        <div className="relative">
          <FlipCover
            title={book.title}
            subtitle={book.subtitle}
            author={book.author}
            coverImage={book.coverImage}
            coverDesign={book.coverDesign}
            size="sm"
            rounded="rounded-2xl"
            className="shadow-sm group-hover:shadow-xl transition-shadow duration-300"
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
