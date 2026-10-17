import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useInView } from "framer-motion";
import { BookOpen, SearchX } from "lucide-react";
import axiosInstance from "../utils/axiosInstance";
import { API_PATHS } from "../utils/apiPaths";
import KenlibsNav from "../components/kenlibs/KenlibsNav";
import KenlibsFooter from "../components/kenlibs/KenlibsFooter";
import KenlibsBookCard from "../components/kenlibs/KenlibsBookCard";
import KenlibsBundleCard from "../components/kenlibs/KenlibsBundleCard";
import KenlibsCardSkeleton from "../components/kenlibs/KenlibsCardSkeleton";
import KenlibsSearchBar from "../components/kenlibs/KenlibsSearchBar";
import useDocumentTitle from "../hooks/useDocumentTitle";
import { useAuth } from "../context/AuthContext";
import KenlibsHeroLeaves from "../components/kenlibs/KenlibsHeroLeaves";
import useMediaQuery from "../hooks/useMediaQuery";

// Phones show this many Featured books as a two-per-row grid (the brand
// flier's home screen); wider screens keep the fanned row.
const PHONE_FEATURED_COUNT = 4;

// A book's genre badge can be set independently on the front or back cover
// (Cover Designer, Step 22) — front is the one actually shown on the
// storefront card, so prefer it, but fall back to back so a book tagged only
// on its back cover still participates in filtering.
const genreOf = (book) =>
  (book.coverDesign?.front?.genreTag || book.coverDesign?.back?.genreTag || "").trim();

// Same stagger contract as KenlibsRow's rowRevealVariants, but for a flat
// results grid rather than a scroll-triggered row — it replays via the
// container's `key` (set to the active query/genre) rather than useInView,
// since filtered results are already on screen the moment they change.
const resultsGridVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
};

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
// on touch devices, not just wheel/trackpad scroll. `physical` (Step 39,
// point 3) adds a touch more vertical breathing room for the Featured row's
// leaned/staggered covers (which lift and rotate slightly on hover — see
// KenlibsBookCard's angled prop) plus a soft "shelf ledge" line beneath the
// row, evoking the reference's fanned-books-on-a-shelf display. Every other
// row (Latest Releases, Bundles) renders with physical=false, unchanged.
const KenlibsRow = ({ title, children, physical = false }) => {
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
        className={`flex gap-5 overflow-x-auto pb-3 -mx-5 px-5 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 scroll-pl-5 sm:scroll-pl-6 lg:scroll-pl-8 snap-x snap-mandatory [scrollbar-width:thin] ${
          physical ? "pt-3" : ""
        }`}
        initial="hidden"
        animate={isInView ? "show" : "hidden"}
        variants={rowRevealVariants}
      >
        {children}
      </motion.div>
      {physical && (
        <div className="h-px bg-gradient-to-r from-transparent via-accent-secondary-200 to-transparent mt-1" />
      )}
    </section>
  );
};

const KenlibsPage = () => {
  useDocumentTitle("Kenlibs");
  const { isAuthenticated } = useAuth();
  const [books, setBooks] = useState([]);
  const [bundles, setBundles] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedGenre, setSelectedGenre] = useState(null);
  // Book ids the current reader already has access to (Step 49) — a single
  // bulk fetch rather than one access check per visible card, since the grid
  // can show dozens of books at once (see GET /api/kenlibs/my-access-map's
  // own comment for the full reasoning). Stays an empty set for a
  // logged-out visitor, who never triggers the fetch below — same "behave
  // exactly as today" contract as the ratings-mine pattern elsewhere on
  // this page.
  const [ownedBookIds, setOwnedBookIds] = useState(new Set());
  // Rating summaries per book _id (Step 44, point 5) — fetched once the
  // catalog itself has loaded, one request per unique book (this catalog is
  // small enough that this is simpler and more honest than inventing a bulk
  // endpoint for it, same reasoning as KenlibsMyBooksPage's per-book
  // progress fetch). Deliberately a separate, non-blocking effect: a slow or
  // failed ratings fetch should never delay or break the actual storefront
  // grid rendering, so cards simply render without a rating badge until (or
  // unless) this resolves.
  const [ratingsById, setRatingsById] = useState({});
  const isPhone = useMediaQuery("(max-width: 639.98px)");

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

  useEffect(() => {
    if (!isAuthenticated) return; // stays at the empty-set default above
    axiosInstance
      .get(API_PATHS.KENLIBS.MY_ACCESS_MAP)
      .then((res) => setOwnedBookIds(new Set(res.data.bookIds || [])))
      .catch(() => setOwnedBookIds(new Set()));
  }, [isAuthenticated]);

  useEffect(() => {
    if (books.length === 0) return;
    let cancelled = false;

    Promise.all(
      books.map((book) =>
        axiosInstance
          .get(API_PATHS.KENLIBS.RATINGS(book._id))
          .then((res) => [book._id, { average: res.data.average, count: res.data.count }])
          .catch(() => null)
      )
    ).then((results) => {
      if (cancelled) return;
      const map = {};
      results.forEach((entry) => {
        if (entry) map[entry[0]] = entry[1];
      });
      setRatingsById(map);
    });

    return () => {
      cancelled = true;
    };
  }, [books]);

  // No dedicated "featured" flag exists on Book yet (see KENLIBS-ARCHITECTURE.md)
  // — until one is added, "Featured" is the currently-for-sale, priced books,
  // capped to keep the row short; "Latest Releases" is every published book,
  // newest first (already the order the backend returns).
  const featured = books
    .filter((b) => b.isForSale && typeof b.price === "number" && b.price > 0)
    .slice(0, 10);

  // Derived, not hardcoded — a fixed category list would drift the moment
  // someone types a new genre into the Cover Designer, and would show mostly
  // "uncategorized" empty buckets on a catalog that hasn't tagged much yet.
  const genres = useMemo(() => {
    const set = new Set();
    books.forEach((b) => {
      const g = genreOf(b);
      if (g) set.add(g);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [books]);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const isFiltering = normalizedQuery !== "" || selectedGenre !== null;

  const filteredBooks = useMemo(() => {
    if (!isFiltering) return [];
    return books.filter((b) => {
      const matchesQuery =
        !normalizedQuery ||
        b.title?.toLowerCase().includes(normalizedQuery) ||
        b.author?.toLowerCase().includes(normalizedQuery);
      const matchesGenre = !selectedGenre || genreOf(b) === selectedGenre;
      return matchesQuery && matchesGenre;
    });
  }, [books, normalizedQuery, selectedGenre, isFiltering]);

  // Bundles have no genre tag of their own (see KenlibsBundleCard) — once a
  // genre pill is active, a bundle can't match it, so drop bundles from the
  // results entirely rather than showing an always-empty "Bundles" section.
  const filteredBundles = useMemo(() => {
    if (!isFiltering || selectedGenre) return [];
    if (!normalizedQuery) return bundles;
    return bundles.filter((bd) => bd.title?.toLowerCase().includes(normalizedQuery));
  }, [bundles, normalizedQuery, selectedGenre, isFiltering]);

  const hasResults = filteredBooks.length > 0 || filteredBundles.length > 0;

  return (
    <div className="min-h-screen bg-surface-warm">
      <KenlibsNav />

      {/* Hero (brand flier design, design-ref/): full-width deep green band,
          soft leaves on the right (inline SVG, no image), the serif headline
          with "Kenlibs" in orange, and the search pill. Plain HTML with no
          entrance animation, so the headline paints (and counts for LCP)
          straight away. On wide screens the same band, with the text in a
          left column and larger leaves on the right. */}
      <section
        aria-labelledby="kenlibs-hero-title"
        className="relative overflow-hidden bg-gradient-to-b from-forest-deep to-forest-deeper"
      >
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_85%_30%,rgba(61,107,44,0.35),transparent_60%)]"
          aria-hidden="true"
        />
        <KenlibsHeroLeaves className="pointer-events-none absolute right-0 top-0 h-full w-[46%] sm:w-[40%] lg:w-[38%] max-w-[520px] opacity-80" />
        <div className="relative max-w-7xl mx-auto px-5 sm:px-6 lg:px-8 pt-7 pb-8 sm:pt-12 sm:pb-12 lg:py-20">
          <div className="max-w-xl">
            <h1
              id="kenlibs-hero-title"
              className="font-headline font-extrabold text-white text-[2.4rem] leading-[1.08] sm:text-5xl lg:text-6xl tracking-tight max-w-[9ch] sm:max-w-none [font-variation-settings:'SOFT'_100]"
            >
              Discover Great Books on <span className="text-accent-on-dark">Kenlibs</span>
            </h1>
            <p className="font-rounded text-white/90 mt-3 text-[17px] sm:text-xl font-semibold">Read anytime, anywhere.</p>
            <div className="mt-6 sm:mt-8">
              <KenlibsSearchBar
                onSearchChange={setSearchQuery}
                genres={genres}
                selectedGenre={selectedGenre}
                onSelectGenre={setSelectedGenre}
              />
            </div>
          </div>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-5 sm:px-6 lg:px-8 pt-6 pb-10 sm:pt-10">

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
        ) : isFiltering ? (
          hasResults ? (
            // Keyed to the active query/genre so the stagger replays on
            // every filter change instead of only firing once on mount —
            // sections don't make sense once results are narrowed, so this
            // is a flat grid rather than KenlibsRow's horizontal scroller.
            <motion.div
              key={`${normalizedQuery}|${selectedGenre || ""}`}
              className="flex flex-wrap gap-x-5 gap-y-8"
              initial="hidden"
              animate="show"
              variants={resultsGridVariants}
            >
              {filteredBooks.map((book) => (
                <KenlibsBookCard
                  key={book._id}
                  book={book}
                  rating={ratingsById[book._id]}
                  owned={ownedBookIds.has(book._id)}
                />
              ))}
              {filteredBundles.map((bundle) => (
                <KenlibsBundleCard key={bundle._id} bundle={bundle} />
              ))}
            </motion.div>
          ) : (
            <motion.div
              key="no-results"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.25 }}
              className="flex flex-col items-center justify-center py-24 text-center"
            >
              <div className="w-24 h-24 bg-accent-50 rounded-3xl flex items-center justify-center mb-8">
                <SearchX className="w-12 h-12 text-accent" />
              </div>
              <h3 className="text-2xl font-semibold text-gray-900 mb-3">
                No matches found
              </h3>
              <p className="text-gray-500 max-w-md">
                {normalizedQuery
                  ? `Nothing matches "${searchQuery.trim()}"${selectedGenre ? ` in ${selectedGenre}` : ""}. Try a different title, author, or genre.`
                  : `No books tagged "${selectedGenre}" yet.`}
              </p>
            </motion.div>
          )
        ) : (
          <>
            {featured.length > 0 && isPhone && (
              <section className="mb-10" aria-labelledby="kenlibs-featured-title">
                <h2 id="kenlibs-featured-title" className="text-xl font-bold text-gray-900 mb-4 tracking-tight">
                  Featured
                </h2>
                <motion.div className="grid grid-cols-2 gap-x-4 gap-y-7" initial="hidden" animate="show" variants={rowRevealVariants}>
                  {featured.slice(0, PHONE_FEATURED_COUNT).map((book) => (
                    <KenlibsBookCard
                      key={book._id}
                      book={book}
                      fluid
                      rating={ratingsById[book._id]}
                      owned={ownedBookIds.has(book._id)}
                    />
                  ))}
                </motion.div>
              </section>
            )}

            {featured.length > 0 && !isPhone && (
              <KenlibsRow title="Featured" physical>
                {featured.map((book, i) => (
                  <KenlibsBookCard
                    key={book._id}
                    book={book}
                    angled
                    tiltIndex={i}
                    rating={ratingsById[book._id]}
                    owned={ownedBookIds.has(book._id)}
                  />
                ))}
              </KenlibsRow>
            )}

            {books.length > 0 && (
              <KenlibsRow title="Latest Releases">
                {books.map((book) => (
                  <KenlibsBookCard
                    key={book._id}
                    book={book}
                    rating={ratingsById[book._id]}
                    owned={ownedBookIds.has(book._id)}
                  />
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
      <KenlibsFooter />
    </div>
  );
};

export default KenlibsPage;
