import { useState } from "react";
import { motion } from "framer-motion";
import { MessageSquare, Pencil, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import axiosInstance from "../../utils/axiosInstance";
import { API_PATHS } from "../../utils/apiPaths";
import getErrorMessage from "../../utils/getErrorMessage";
import StarRating from "./StarRating";
import Button from "../ui/Button";

const formatDate = (iso) =>
  new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });

// Full ratings/reviews section for KenlibsBookDetailPage (Step 44) — the
// parent page owns fetching `aggregate` (GET /ratings/:bookId) and
// `myRating` (GET /ratings/:bookId/mine, only when authenticated) and hands
// them down here as props, same reasoning as it already owning `book`
// itself; this component just renders them and calls `onRatingChange` (a
// full refetch, not local patching) after a successful submit so the
// aggregate/reviews list and "your rating" state can never drift out of
// sync with the server.
//
// `myRating` being null (not yet fetched, or the reader isn't
// authenticated) is treated the same as "no access" — no rating control
// renders at all, per the product rule that a non-purchaser sees no rating
// UI, not a disabled one.
const BookReviewsSection = ({ bookId, aggregate, myRating, onRatingChange, isLoadingMore, onLoadMore }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [draftStars, setDraftStars] = useState(0);
  const [draftReview, setDraftReview] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const hasAccess = Boolean(myRating?.hasAccess);
  const existingRating = myRating?.rating || null;

  const openEditor = () => {
    setDraftStars(existingRating?.stars || 0);
    setDraftReview(existingRating?.review || "");
    setIsEditing(true);
  };

  const submitRating = async () => {
    if (draftStars < 1) {
      toast.error("Pick a star rating first.");
      return;
    }
    setIsSubmitting(true);
    try {
      await axiosInstance.post(API_PATHS.KENLIBS.RATINGS(bookId), {
        stars: draftStars,
        review: draftReview.trim(),
      });
      toast.success(existingRating ? "Your rating was updated!" : "Thanks for rating this book!");
      setIsEditing(false);
      onRatingChange();
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to submit your rating"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const reviews = aggregate?.reviews || [];

  return (
    <div className="mt-14 pt-10 border-t border-gray-100">
      <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2 mb-6">
        <MessageSquare className="w-5 h-5 text-accent" />
        Ratings &amp; Reviews
      </h2>

      {/* Rate this book — absent entirely for a reader without approved
          access, per the product rule (not a disabled/explained control). */}
      {hasAccess && (
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 mb-8 max-w-xl">
          {/* No AnimatePresence/exit here (Step 52 audit) — same
              simplification as the auth pages' success/form swaps: the
              old branch disappears instantly rather than fading out first,
              which trades a small nicety for zero risk of a stuck-exit
              overlay blocking this card. */}
          {!isEditing ? (
            <motion.div key="summary" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              {existingRating ? (
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm text-gray-500 mb-1.5">You rated this book</p>
                    <StarRating value={existingRating.stars} size="md" />
                  </div>
                  <button
                    onClick={openEditor}
                    className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium text-accent-hover bg-accent-50 hover:bg-accent-100 transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Edit
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-gray-900 mb-1.5">Rate this book</p>
                    <p className="text-xs text-gray-500">Share what you thought with other readers.</p>
                  </div>
                  <Button size="sm" onClick={openEditor} className="flex-shrink-0">
                    Rate it
                  </Button>
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="form"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <p className="text-sm font-semibold text-gray-900 mb-3">
                {existingRating ? "Edit your rating" : "Rate this book"}
              </p>
              <StarRating value={draftStars} size="lg" interactive onChange={setDraftStars} />
              <textarea
                value={draftReview}
                onChange={(e) => setDraftReview(e.target.value)}
                placeholder="Optional — write a review other readers can see…"
                rows={4}
                maxLength={2000}
                className="w-full mt-4 bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500 transition-all resize-none"
              />
              <div className="flex gap-2 mt-3">
                <Button size="sm" loading={isSubmitting} onClick={submitRating}>
                  {existingRating ? "Update Rating" : "Submit Rating"}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setIsEditing(false)}>
                  Cancel
                </Button>
              </div>
            </motion.div>
          )}
        </div>
      )}

      {/* Written reviews */}
      {reviews.length === 0 ? (
        <p className="text-gray-400 text-sm">
          No written reviews yet{hasAccess ? " — be the first to leave one." : "."}
        </p>
      ) : (
        <div className="space-y-5 max-w-2xl">
          {reviews.map((r) => (
            <div key={r._id} className="border-b border-gray-100 pb-5 last:border-0">
              <div className="flex items-center justify-between gap-3 mb-1.5">
                <div className="flex items-center gap-3">
                  <StarRating value={r.stars} size="xs" />
                  <p className="text-sm font-semibold text-gray-900">{r.readerName}</p>
                </div>
                <p className="text-xs text-gray-400 flex-shrink-0">{formatDate(r.createdAt)}</p>
              </div>
              <p className="text-sm text-gray-600 leading-relaxed">{r.review}</p>
            </div>
          ))}
        </div>
      )}

      {aggregate?.hasMore && (
        <button
          onClick={onLoadMore}
          disabled={isLoadingMore}
          className="mt-6 flex items-center gap-2 text-sm font-medium text-accent hover:text-accent-hover transition-colors disabled:opacity-60"
        >
          {isLoadingMore && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {isLoadingMore ? "Loading…" : "Show more reviews"}
        </button>
      )}
    </div>
  );
};

export default BookReviewsSection;
