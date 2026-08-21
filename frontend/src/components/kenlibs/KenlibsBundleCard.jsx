import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Package } from "lucide-react";
import { formatNaira } from "../../utils/kenlibsPricing";

const miniCoverUrl = (book) =>
  book?.coverDesign?.front?.backgroundImage || book?.coverImage || null;

// Same entrance contract as KenlibsBookCard — see that file's comment.
const cardEntranceVariants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } },
};

// Bundles don't have a back cover (Step 22's coverDesign.back is a per-book
// concept), so no hover-flip here — just a static cover, falling back to a
// generated 2x2 grid of the included books' covers when no coverImage was
// set on the bundle itself (per KENLIBS-ARCHITECTURE.md section 3).
const KenlibsBundleCard = ({ bundle }) => {
  const previewBooks = (bundle.books || []).slice(0, 4);

  return (
    <Link
      to={`/kenlibs/bundle/${bundle._id}`}
      className="group block w-40 sm:w-48 flex-shrink-0 snap-start"
    >
      <motion.div variants={cardEntranceVariants}>
        <div className="relative aspect-[2/3] w-full overflow-hidden rounded-2xl bg-gray-100 shadow-sm group-hover:shadow-xl transition-shadow duration-300">
          {bundle.coverImage ? (
            <img
              src={bundle.coverImage}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : previewBooks.length > 0 ? (
            <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 gap-0.5 bg-gray-300">
              {previewBooks.map((b) => (
                <div key={b._id} className="relative overflow-hidden bg-gray-800">
                  {miniCoverUrl(b) && (
                    <img
                      src={miniCoverUrl(b)}
                      alt=""
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-accent to-accent-secondary">
              <Package className="w-8 h-8 text-white/80" />
            </div>
          )}

          <span className="absolute top-3 right-3 z-10 px-2.5 py-1 rounded-full text-xs font-bold shadow-sm bg-accent text-white">
            {formatNaira(bundle.price)}
          </span>
        </div>

        <div className="mt-3">
          <h3 className="font-serif font-semibold text-gray-900 text-sm leading-snug line-clamp-2">
            {bundle.title}
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {(bundle.books || []).length} book
            {(bundle.books || []).length === 1 ? "" : "s"}
          </p>
        </div>
      </motion.div>
    </Link>
  );
};

export default KenlibsBundleCard;
