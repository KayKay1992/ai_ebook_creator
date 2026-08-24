import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import { MessageSquareText, Star, Trash2, Loader2 } from "lucide-react";
import axiosInstance from "../utils/axiosInstance";
import { API_PATHS } from "../utils/apiPaths";
import getErrorMessage from "../utils/getErrorMessage";
import DashboardLayout from "../components/layout/DashboardLayout";
import Button from "../components/ui/Button";

const formatDate = (iso) =>
  new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });

const listEntranceVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
};
const rowFadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] } },
};

// First admin-facing view of individual reviews at all (Step 50) — every
// prior review-related surface (KenlibsPage, book detail, analytics) is
// either public or aggregate-only. Flat list across every book rather than
// nested under a per-book admin view, since there isn't currently a
// dedicated "all books" admin list to nest it under.
const AdminReviewsPage = () => {
  const [reviews, setReviews] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deletingId, setDeletingId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  useEffect(() => {
    const fetchReviews = async () => {
      try {
        const res = await axiosInstance.get(API_PATHS.ADMIN.REVIEWS);
        setReviews(res.data);
      } catch (error) {
        toast.error(getErrorMessage(error, "Failed to load reviews"));
      } finally {
        setIsLoading(false);
      }
    };
    fetchReviews();
  }, []);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeletingId(deleteTarget._id);
    try {
      await axiosInstance.delete(API_PATHS.ADMIN.DELETE_REVIEW(deleteTarget._id));
      setReviews((prev) => prev.filter((r) => r._id !== deleteTarget._id));
      toast.success("Review deleted.");
      setDeleteTarget(null);
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to delete review"));
    } finally {
      setDeletingId(null);
    }
  };

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-8 h-8 text-accent animate-spin" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <MessageSquareText className="w-6 h-6 text-accent" />
            Reviews
          </h1>
          <p className="text-gray-500 mt-1">
            Every written review across the catalog, most recent first. Remove anything that violates guidelines.
          </p>
        </div>

        {reviews.length === 0 ? (
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-10 text-center text-gray-400">
            No written reviews yet.
          </div>
        ) : (
          <motion.div className="space-y-3" initial="hidden" animate="show" variants={listEntranceVariants}>
            {reviews.map((review) => (
              <motion.div
                key={review._id}
                layout
                variants={rowFadeUp}
                className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900">{review.readerName}</span>
                      <span className="text-gray-300">·</span>
                      <span className="text-sm text-gray-500 truncate">{review.bookTitle}</span>
                    </div>
                    <div className="flex items-center gap-1 mt-1.5">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star
                          key={i}
                          className={`w-3.5 h-3.5 ${
                            i < review.stars ? "fill-accent text-accent" : "text-gray-200"
                          }`}
                        />
                      ))}
                      <span className="text-xs text-gray-400 ml-1.5">{formatDate(review.createdAt)}</span>
                    </div>
                    <p className="text-sm text-gray-700 mt-2.5 leading-relaxed">{review.review}</p>
                  </div>
                  <button
                    onClick={() => setDeleteTarget(review)}
                    title="Delete review"
                    className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>

      {/* Always mounted, animated via `animate` only + `inert` when closed —
          not AnimatePresence-conditional mounting. Confirmed live (Step 51):
          framer-motion 13.1.0 + React 19 here never fires AnimatePresence's
          exit-complete unmount — the exit animation finishes visually but
          the fixed inset-0 z-50 overlay stays in the DOM, silently blocking
          every click on the page underneath it until a full reload. This
          sidesteps that entirely: nothing ever needs to unmount. */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" inert={!deleteTarget}>
        <motion.div
          animate={{ opacity: deleteTarget ? 1 : 0 }}
          className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          onClick={() => setDeleteTarget(null)}
        />
        <motion.div
          animate={{ opacity: deleteTarget ? 1 : 0, scale: deleteTarget ? 1 : 0.96 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="relative bg-white rounded-3xl shadow-2xl max-w-md w-full p-8"
        >
          <div className="w-12 h-12 bg-red-50 rounded-2xl flex items-center justify-center mb-4">
            <Trash2 className="w-6 h-6 text-red-500" />
          </div>
          <h3 className="text-xl font-bold text-gray-900 mb-2">Delete this review?</h3>
          <p className="text-gray-500 mb-6">
            "{deleteTarget?.review}" by {deleteTarget?.readerName} on {deleteTarget?.bookTitle} will be
            permanently removed. This can't be undone.
          </p>
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              loading={!!deleteTarget && deletingId === deleteTarget._id}
              onClick={confirmDelete}
            >
              Delete
            </Button>
          </div>
        </motion.div>
      </div>
    </DashboardLayout>
  );
};

export default AdminReviewsPage;
