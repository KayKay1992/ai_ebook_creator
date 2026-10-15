import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, BookX, ShoppingBag, BookOpenCheck, Headphones, Languages } from "lucide-react";
import axiosInstance from "../utils/axiosInstance";
import { API_PATHS } from "../utils/apiPaths";
import KenlibsNav from "../components/kenlibs/KenlibsNav";
import KenlibsFooter from "../components/kenlibs/KenlibsFooter";
import FlipCover from "../components/kenlibs/FlipCover";
import StarRating from "../components/kenlibs/StarRating";
import BookReviewsSection from "../components/kenlibs/BookReviewsSection";
import Button from "../components/ui/Button";
import ReadingLanguageSelect from "../components/kenlibs/ReadingLanguageSelect";
import { getReadingLanguage, setReadingLanguage } from "../utils/readingLanguage";
import { trackBookView } from "../utils/bookViews";
import { useAuth } from "../context/AuthContext";
import { getBookBadge } from "../utils/kenlibsPricing";
import useDocumentTitle from "../hooks/useDocumentTitle";
import useOpenGraphTags from "../hooks/useOpenGraphTags";
import cloudinaryUrl, { IMAGE_WIDTHS } from "../utils/cloudinaryUrl";

// A brief, purely cosmetic pause before navigating to checkout — turns an
// instant jump into a deliberate press-and-go, via the Button's own
// `loading` spinner state. Doesn't delay or alter the actual auth/redirect
// logic, just when it fires.
const NAVIGATE_DELAY_MS = 350;

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] } },
};

// Splits the admin-written storefront teaser (Book.previewContent) into
// paragraphs on blank lines. Deliberately plain text, not markdown: no
// renderer (and no extra bundle weight), and React escapes it like any other
// string, so nothing the admin types is ever interpreted as HTML.
const toParagraphs = (text = "") =>
  text
    .split(/\r?\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

// The page's single purchase/read action, shared by the top-of-page slot and
// the one under the teaser so their logic can never drift apart: read it if
// the reader already has access, request to buy if it's for sale, otherwise
// "Coming Soon" (disabled).
const BookCallToAction = ({
  bookId,
  hasAccess,
  canBuy,
  isAuthenticated,
  isNavigatingToCheckout,
  onStartCheckout,
  readLabel = "Read Now",
}) => {
  const navigate = useNavigate();

  if (hasAccess) {
    return (
      <Link to={`/kenlibs/read/${bookId}`}>
        <Button size="xl" className="flex items-center gap-2">
          <BookOpenCheck className="w-4 h-4" />
          {readLabel}
        </Button>
      </Link>
    );
  }

  return (
    <Button
      size="xl"
      disabled={!canBuy}
      loading={isNavigatingToCheckout}
      title={canBuy ? undefined : "This book isn't purchasable yet."}
      onClick={() => {
        const checkoutPath = `/kenlibs/checkout/book/${bookId}`;
        // A logged-out visitor is most likely new: send them to create an
        // account (then sign in, then on to checkout via `from`). A
        // signed-in reader goes straight to checkout, nothing in between.
        if (!isAuthenticated) {
          navigate("/kenlibs/signup", { state: { from: checkoutPath } });
          return;
        }
        onStartCheckout(checkoutPath);
      }}
      className="flex items-center gap-2"
    >
      <ShoppingBag className="w-4 h-4" />
      {canBuy ? "Request to Buy" : "Coming Soon"}
    </Button>
  );
};

const KenlibsBookDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [book, setBook] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isNavigatingToCheckout, setIsNavigatingToCheckout] = useState(false);
  // Ratings (Step 44) — fetched here, not inside BookReviewsSection, same
  // reasoning as `book` itself already being page-level state: the compact
  // "near the price" summary and the full reviews section below both read
  // from this one source of truth rather than each fetching independently.
  const [aggregate, setAggregate] = useState(null);
  // Defaults to "no access" so an unauthenticated visitor (who never
  // triggers the /mine fetch below) correctly renders no rating control,
  // without needing a synchronous setState in that effect branch.
  const [myRating, setMyRating] = useState({ hasAccess: false, rating: null });
  const [isLoadingMoreReviews, setIsLoadingMoreReviews] = useState(false);
  // Whether the current reader already owns this book (Step 49) — separate
  // from myRating.hasAccess above (that one's scoped to a specific rating
  // fetch's shape) so this page doesn't depend on the ratings feature to
  // know whether to show "Read Now" instead of a purchase prompt.
  const [hasAccess, setHasAccess] = useState(false);
  // Preferred reading language for this device (utils/readingLanguage.js);
  // the reader opens the book in it when a published translation exists.
  const [readingLanguage, setReadingLanguageState] = useState(getReadingLanguage);

  useDocumentTitle(book ? `${book.title} — Kenlibs` : "Kenlibs");

  // Best-effort only — see useOpenGraphTags.js's doc comment for why this
  // does not actually fix link previews on WhatsApp/Twitter/Facebook/etc.
  useOpenGraphTags({
    title: book ? `${book.title} — Kenlibs` : undefined,
    description:
      book?.coverDesign?.back?.blurb?.trim() ||
      (book ? `by ${book.author || "Unknown Author"} — read it on Kenlibs.` : undefined),
    image: book?.coverImage || book?.coverDesign?.front?.backgroundImage,
    url: book ? `${window.location.origin}/kenlibs/book/${id}` : undefined,
  });

  // Anonymous view count for the analytics funnel (once per book per day
  // per browser; see utils/bookViews.js).
  useEffect(() => {
    trackBookView(id);
  }, [id]);

  useEffect(() => {
    const fetchBook = async () => {
      try {
        const res = await axiosInstance.get(`${API_PATHS.PUBLIC.KENLIBS_BOOK}/${id}`);
        setBook(res.data);
      } catch {
        // 404 just means unpublished/removed/invalid id — not an app error.
        setBook(null);
      } finally {
        setIsLoading(false);
      }
    };
    fetchBook();
  }, [id]);

  // Aggregate rating is genuinely public (no auth header needed) — fetched
  // unconditionally. "My rating" is only meaningful for a signed-in reader;
  // an unauthenticated visitor gets the same { hasAccess: false, rating:
  // null } shape a real API response would give a non-purchaser, so
  // BookReviewsSection doesn't need to special-case "not logged in" vs "no
  // access" — both correctly render no rating control.
  useEffect(() => {
    axiosInstance
      .get(API_PATHS.KENLIBS.RATINGS(id))
      .then((res) => setAggregate(res.data))
      .catch(() => setAggregate(null));

    if (!isAuthenticated) return; // stays at the "no access" default above
    axiosInstance
      .get(API_PATHS.KENLIBS.MY_RATING(id))
      .then((res) => setMyRating(res.data))
      .catch(() => setMyRating({ hasAccess: false, rating: null }));
  }, [id, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return; // stays at the "no access" default above
    axiosInstance
      .get(API_PATHS.KENLIBS.ACCESS(id))
      .then((res) => setHasAccess(res.data.hasAccess))
      .catch(() => setHasAccess(false));
  }, [id, isAuthenticated]);

  const refetchRatings = () => {
    axiosInstance
      .get(API_PATHS.KENLIBS.RATINGS(id))
      .then((res) => setAggregate(res.data))
      .catch(() => {});
    if (isAuthenticated) {
      axiosInstance
        .get(API_PATHS.KENLIBS.MY_RATING(id))
        .then((res) => setMyRating(res.data))
        .catch(() => {});
    }
  };

  const loadMoreReviews = async () => {
    if (!aggregate?.hasMore || isLoadingMoreReviews) return;
    setIsLoadingMoreReviews(true);
    try {
      const res = await axiosInstance.get(API_PATHS.KENLIBS.RATINGS(id), {
        params: { page: aggregate.page + 1 },
      });
      setAggregate((prev) => ({ ...res.data, reviews: [...(prev?.reviews || []), ...res.data.reviews] }));
    } catch {
      // silently degrade — "show more" staying available to retry is enough
    } finally {
      setIsLoadingMoreReviews(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-surface-warm">
        <KenlibsNav />
        <div className="max-w-5xl mx-auto px-6 lg:px-8 py-16 grid md:grid-cols-[280px_1fr] gap-12 animate-pulse">
          <div className="aspect-[2/3] w-full max-w-[280px] rounded-2xl bg-gray-100" />
          <div className="space-y-4">
            <div className="h-8 bg-gray-100 rounded-lg w-3/4" />
            <div className="h-4 bg-gray-100 rounded-lg w-1/3" />
            <div className="h-24 bg-gray-100 rounded-lg w-full mt-6" />
          </div>
        </div>
      </div>
    );
  }

  if (!book) {
    return (
      <div className="min-h-screen bg-surface-warm">
        <KenlibsNav />
        <div className="flex flex-col items-center justify-center py-32 text-center px-6">
          <div className="w-20 h-20 bg-accent-50 rounded-3xl flex items-center justify-center mb-6">
            <BookX className="w-10 h-10 text-accent-500" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-3">
            This book isn't available
          </h2>
          <p className="text-gray-500 max-w-md mb-8">
            It may have been unpublished, or the link may be incorrect.
          </p>
          <Link to="/kenlibs">
            <Button className="flex items-center gap-2">
              <ArrowLeft className="w-4 h-4" />
              Back to Kenlibs
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const badge = getBookBadge(book);
  const blurb = book.coverDesign?.back?.blurb?.trim();
  const authorBio = book.coverDesign?.back?.authorBio?.trim();
  const authorPhoto = book.coverDesign?.back?.authorPhoto;
  const canBuy = badge?.type === "price";
  const teaserParagraphs = toParagraphs(book.previewContent);

  const ctaProps = {
    bookId: id,
    hasAccess,
    canBuy,
    isAuthenticated,
    isNavigatingToCheckout,
    onStartCheckout: (checkoutPath) => {
      setIsNavigatingToCheckout(true);
      setTimeout(() => navigate(checkoutPath), NAVIGATE_DELAY_MS);
    },
  };

  return (
    <div className="min-h-screen bg-surface-warm">
      <KenlibsNav />

      <div className="max-w-5xl mx-auto px-6 lg:px-8 py-12">
        <Link
          to="/kenlibs"
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Kenlibs
        </Link>

        <motion.div
          className="grid md:grid-cols-[280px_1fr] gap-12"
          initial="hidden"
          animate="show"
          variants={{ show: { transition: { staggerChildren: 0.12 } } }}
        >
          <motion.div
            className="w-full max-w-[280px] mx-auto md:mx-0"
            variants={fadeUp}
          >
            <FlipCover
              title={book.title}
              subtitle={book.subtitle}
              author={book.author}
              coverImage={book.coverImage}
              coverDesign={book.coverDesign}
              size="lg"
              rounded="rounded-2xl"
              className="shadow-xl"
            />
          </motion.div>

          <motion.div variants={fadeUp}>
            <h1 className="text-3xl font-bold text-gray-900 tracking-tight">
              {book.title || "Untitled Book"}
            </h1>
            {book.subtitle && (
              <p className="text-lg text-gray-500 mt-1 font-serif italic">
                {book.subtitle}
              </p>
            )}
            <p className="text-gray-600 mt-3">
              by <span className="font-medium">{book.author || "Unknown Author"}</span>
            </p>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              {hasAccess ? (
                <span className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-semibold bg-emerald-50 text-emerald-700">
                  <BookOpenCheck className="w-4 h-4" />
                  In your library
                </span>
              ) : badge?.type === "price" ? (
                <span className="inline-flex px-5 py-2 rounded-full text-base font-extrabold tracking-tight bg-accent text-white shadow-md shadow-black/10">
                  {badge.label}
                </span>
              ) : (
                <span className="inline-flex px-4 py-1.5 rounded-full text-sm font-medium bg-gray-100 text-gray-500">
                  Coming Soon
                </span>
              )}
              {book.hasAudio && (
                <span
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-semibold bg-accent-50 text-accent-hover"
                  title={`${book.audioChapterCount} narrated chapter${book.audioChapterCount === 1 ? "" : "s"}`}
                >
                  <Headphones className="w-4 h-4" />
                  Includes audiobook
                </span>
              )}
            </div>

            {book.translationLanguages?.length > 0 && (
              <div className="mt-4 space-y-2">
                <p className="flex items-center gap-1.5 text-sm text-gray-600">
                  <Languages className="w-4 h-4 text-gray-400" />
                  Also in {book.translationLanguages.map((l) => l.nativeName || l.name).join(", ")}{" "}
                  <span className="text-xs text-gray-400">(AI-translated)</span>
                </p>
                {hasAccess && (
                  <div className="space-y-1">
                    <ReadingLanguageSelect
                      id="detail-reading-language"
                      languages={book.translationLanguages}
                      value={book.translationLanguages.some((l) => l.code === readingLanguage) ? readingLanguage : ""}
                      onChange={(code) => {
                        setReadingLanguage(code);
                        setReadingLanguageState(code);
                      }}
                    />
                    {book.hasAudio && (
                      <p className="text-xs text-gray-400">The audiobook is narrated in the original language.</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Aggregate rating — a real trust/conversion signal, so it sits
                right under the price rather than buried near the reviews
                section further down the page. Absent (not a "0.0 · 0
                ratings" placeholder) until at least one rating exists. */}
            {aggregate?.count > 0 && (
              <div className="mt-3 flex items-center gap-2">
                <StarRating value={aggregate.average} size="sm" />
                <span className="text-sm font-semibold text-gray-900">{aggregate.average}</span>
                <span className="text-sm text-gray-400">
                  ({aggregate.count} rating{aggregate.count === 1 ? "" : "s"})
                </span>
              </div>
            )}

            {blurb && (
              <p className="mt-6 text-gray-700 leading-relaxed font-serif italic max-w-xl">
                {blurb}
              </p>
            )}

            {authorBio && (
              <div className="mt-8 flex items-start gap-3 border-t border-gray-100 pt-6 max-w-xl">
                {authorPhoto ? (
                  <img
                    src={cloudinaryUrl(authorPhoto, IMAGE_WIDTHS.thumb)}
                    alt=""
                    width={44}
                    height={44}
                    loading="lazy"
                    decoding="async"
                    className="w-11 h-11 rounded-full object-cover flex-shrink-0"
                  />
                ) : (
                  <div className="w-11 h-11 rounded-full bg-gray-100 flex-shrink-0" />
                )}
                <div>
                  <p className="text-sm font-semibold text-gray-900">
                    {book.author || "Unknown Author"}
                  </p>
                  <p className="text-sm text-gray-500 mt-0.5">{authorBio}</p>
                </div>
              </div>
            )}

            <motion.div className="mt-10" whileTap={{ scale: 0.97 }}>
              <BookCallToAction {...ctaProps} />
            </motion.div>
          </motion.div>
        </motion.div>

        {/* Storefront teaser: admin-written sales copy (Book.previewContent),
            not an excerpt. Full width under the cover/info grid so it gets a
            comfortable reading measure, with its own call to action at the
            end so a reader who was persuaded doesn't have to scroll back up.
            Absent entirely when no teaser has been written. */}
        {teaserParagraphs.length > 0 && (
          <motion.section
            className="mt-16 border-t border-gray-100 pt-12"
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            aria-labelledby="about-this-book"
          >
            <div className="max-w-2xl">
              <h2
                id="about-this-book"
                className="text-xs font-semibold uppercase tracking-[0.18em] text-accent mb-5"
              >
                About this book
              </h2>
              <div className="space-y-5">
                {teaserParagraphs.map((paragraph, i) => (
                  <p
                    key={i}
                    className={`whitespace-pre-line ${
                      i === 0
                        ? "font-serif text-xl sm:text-2xl leading-snug text-gray-900"
                        : "text-base sm:text-[1.0625rem] leading-relaxed text-gray-700"
                    }`}
                  >
                    {paragraph}
                  </p>
                ))}
              </div>

              <motion.div className="mt-9" whileTap={{ scale: 0.97 }}>
                <BookCallToAction {...ctaProps} readLabel="Read the full book" />
              </motion.div>
            </div>
          </motion.section>
        )}

        <BookReviewsSection
          bookId={id}
          aggregate={aggregate}
          myRating={myRating}
          onRatingChange={refetchRatings}
          isLoadingMore={isLoadingMoreReviews}
          onLoadMore={loadMoreReviews}
        />
      </div>
      <KenlibsFooter />
    </div>
  );
};

export default KenlibsBookDetailPage;
