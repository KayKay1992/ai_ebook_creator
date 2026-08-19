import { useEffect, useRef, useState } from "react";
import { motion, useInView } from "framer-motion";
import { BookOpen } from "lucide-react";
import axiosInstance from "../utils/axiosInstance";
import { API_PATHS } from "../utils/apiPaths";
import KenlibsNav from "../components/kenlibs/KenlibsNav";
import KenlibsBookCard from "../components/kenlibs/KenlibsBookCard";
import KenlibsBundleCard from "../components/kenlibs/KenlibsBundleCard";
import KenlibsCardSkeleton from "../components/kenlibs/KenlibsCardSkeleton";
import useDocumentTitle from "../hooks/useDocumentTitle";

// Plays once per row as it scrolls into view (not on mount) — staggers the
// "show" state down to each card via variant propagation, so cards further
// down the page reveal progressively as you scroll rather than all firing
// together on load. `once: true` stops Framer from re-observing after the
// first reveal, which keeps this cheap even with a full catalog of cards.
const rowRevealVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};

// Horizontal-scrolling row, matching the Kotobee reference layout. Cards are
// fixed-width flex children with scroll-snap so it also behaves reasonably
// on touch devices, not just wheel/trackpad scroll.
const KenlibsRow = ({ title, children }) => {
  const ref = useRef(null);
  // useInView (a hook, not the whileInView prop) so an element that's
  // already on screen the moment it mounts — e.g. the first "Featured" row,
  // which never has to scroll into view — still reliably reports true on
  // its first check, instead of only reacting to a later scroll-driven
  // boundary crossing.
  const isInView = useInView(ref, { once: true, amount: 0.15 });

  return (
    <section className="mb-14">
      <h2 className="text-xl font-bold text-gray-900 mb-5 tracking-tight">
        {title}
      </h2>
      <motion.div
        ref={ref}
        className="flex gap-5 overflow-x-auto pb-3 -mx-6 px-6 lg:-mx-8 lg:px-8 snap-x snap-mandatory [scrollbar-width:thin]"
        initial="hidden"
        animate={isInView ? "show" : "hidden"}
        variants={rowRevealVariants}
      >
        {children}
      </motion.div>
    </section>
  );
};

const KenlibsPage = () => {
  useDocumentTitle("Kenlibs");
  const [books, setBooks] = useState([]);
  const [bundles, setBundles] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchStorefront = async () => {
      try {
        const res = await axiosInstance.get(API_PATHS.PUBLIC.KENLIBS_STOREFRONT);
        setBooks(res.data.books || []);
        setBundles(res.data.bundles || []);
      } catch {
        // A logged-out browse page shouldn't ever hard-fail — just show the
        // empty state below rather than an error toast.
        setBooks([]);
        setBundles([]);
      } finally {
        setIsLoading(false);
      }
    };
    fetchStorefront();
  }, []);

  // No dedicated "featured" flag exists on Book yet (see KENLIBS-ARCHITECTURE.md)
  // — until one is added, "Featured" is the currently-for-sale, priced books,
  // capped to keep the row short; "Latest Releases" is every published book,
  // newest first (already the order the backend returns).
  const featured = books
    .filter((b) => b.isForSale && typeof b.price === "number" && b.price > 0)
    .slice(0, 10);

  return (
    <div className="min-h-screen bg-gray-50">
      <KenlibsNav />

      <div className="max-w-7xl mx-auto px-6 lg:px-8 py-10">
        <motion.div
          className="mb-12"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        >
          <h1 className="text-3xl lg:text-4xl font-bold text-gray-900 tracking-tight">
            Kenlibs
          </h1>
          <p className="text-gray-500 mt-2">
            Browse books and bundles — hover a cover for a quick preview.
          </p>
        </motion.div>

        {isLoading ? (
          <>
            <KenlibsRow title="Featured">
              {Array.from({ length: 5 }).map((_, i) => (
                <KenlibsCardSkeleton key={i} />
              ))}
            </KenlibsRow>
            <KenlibsRow title="Latest Releases">
              {Array.from({ length: 5 }).map((_, i) => (
                <KenlibsCardSkeleton key={i} />
              ))}
            </KenlibsRow>
          </>
        ) : books.length === 0 && bundles.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-24 h-24 bg-accent-50 rounded-3xl flex items-center justify-center mb-8">
              <BookOpen className="w-12 h-12 text-accent" />
            </div>
            <h3 className="text-2xl font-semibold text-gray-900 mb-3">
              Nothing published yet
            </h3>
            <p className="text-gray-500 max-w-md">
              Check back soon — new books and bundles will show up here as
              they're published.
            </p>
          </div>
        ) : (
          <>
            {featured.length > 0 && (
              <KenlibsRow title="Featured">
                {featured.map((book) => (
                  <KenlibsBookCard key={book._id} book={book} />
                ))}
              </KenlibsRow>
            )}

            {books.length > 0 && (
              <KenlibsRow title="Latest Releases">
                {books.map((book) => (
                  <KenlibsBookCard key={book._id} book={book} />
                ))}
              </KenlibsRow>
            )}

            {bundles.length > 0 && (
              <KenlibsRow title="Bundles">
                {bundles.map((bundle) => (
                  <KenlibsBundleCard key={bundle._id} bundle={bundle} />
                ))}
              </KenlibsRow>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default KenlibsPage;
