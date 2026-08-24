import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import {
  Clock,
  AlertTriangle,
  BookOpenCheck,
  UploadCloud,
  Award,
  MessageCircle,
  Sparkles,
  Package,
} from "lucide-react";
import axiosInstance from "../utils/axiosInstance";
import { API_PATHS } from "../utils/apiPaths";
import getErrorMessage from "../utils/getErrorMessage";
import KenlibsNav from "../components/kenlibs/KenlibsNav";
import KenlibsFooter from "../components/kenlibs/KenlibsFooter";
import CoverPreview from "../components/cards/CoverPreview";
import { buildWhatsAppHref } from "../utils/kenlibsSupport";
import Button from "../components/ui/Button";
import { formatNaira } from "../utils/kenlibsPricing";
import useDocumentTitle from "../hooks/useDocumentTitle";

const sectionFadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } },
};
const gridEntranceVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};
const itemFadeUp = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] } },
};

// A real cover, title, and one clear action — every "Ready to Read" tile is
// this shape regardless of whether it came from a direct book purchase or
// one book inside an approved bundle (fromBundle distinguishes the two only
// for a small caption, everything else about the tile is identical).
const ReadyBookCard = ({ bookId, title, author, coverImage, fromBundle, completed, onDownloadCertificate, isDownloading }) => (
  <motion.div variants={itemFadeUp} className="group">
    <Link to={`/kenlibs/read/${bookId}`} className="block relative">
      <CoverPreview
        title={title}
        author={author}
        coverImage={coverImage}
        size="md"
        rounded="rounded-2xl"
        className="shadow-sm group-hover:shadow-xl transition-shadow duration-300"
      />
      <div className="absolute inset-0 rounded-2xl bg-black/0 md:group-hover:bg-black/10 transition-colors duration-300 flex items-center justify-center">
        {/* Cosmetic only — the whole cover is already a Link, so tapping it
            navigates regardless — but the "Read Now" cue itself was
            invisible on mobile from the same hover-gating issue fixed
            elsewhere this session. */}
        <span className="opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-300 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-black/50 backdrop-blur-sm">
          <BookOpenCheck className="w-4 h-4" />
          Read Now
        </span>
      </div>
    </Link>
    <div className="mt-2.5 flex items-start justify-between gap-2">
      <div className="min-w-0">
        <h3 className="font-serif font-semibold text-gray-900 text-sm leading-snug truncate">{title}</h3>
        {fromBundle && (
          <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5 truncate">
            <Package className="w-3 h-3 flex-shrink-0" />
            {fromBundle}
          </p>
        )}
      </div>
      {completed && (
        <motion.button
          whileTap={{ scale: 0.94 }}
          disabled={isDownloading}
          onClick={onDownloadCertificate}
          title="Download certificate"
          className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-accent-hover bg-accent-50 hover:bg-accent-100 transition-colors disabled:opacity-60"
        >
          <Award className="w-4 h-4" />
        </motion.button>
      )}
    </div>
  </motion.div>
);

const KenlibsMyBooksPage = () => {
  useDocumentTitle("My Books — Kenlibs");
  const [requests, setRequests] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [resubmittingId, setResubmittingId] = useState(null); // row with the upload form open
  const [resubmitFile, setResubmitFile] = useState(null);
  const [isSubmittingResubmit, setIsSubmittingResubmit] = useState(false);
  // Book ids the reader has actually finished (completedAt set), across
  // every approved request — including books reached only via a bundle.
  // Not part of the purchases response itself (that's PurchaseRequest data,
  // this is ReaderProgress data), so it's fetched separately per book.
  const [completedBookIds, setCompletedBookIds] = useState(new Set());
  const [downloadingCertificateId, setDownloadingCertificateId] = useState(null);

  useEffect(() => {
    const fetchRequests = async () => {
      try {
        const res = await axiosInstance.get(API_PATHS.PURCHASES.MINE);
        setRequests(res.data);

        const approved = res.data.filter((r) => r.status === "approved");
        const bookIds = new Set();
        approved.forEach((r) => {
          if (r.itemType === "book") bookIds.add(r.item);
          if (r.itemType === "bundle") {
            (r.itemBooks || []).forEach((b) => bookIds.add(b._id));
          }
        });

        // This catalog is small enough that one request per book is simpler
        // and more honest than inventing a bulk endpoint for it — see
        // audit notes elsewhere in this project on client-side filtering
        // being the right call at this scale.
        const progressEntries = await Promise.all(
          Array.from(bookIds).map((id) =>
            axiosInstance
              .get(API_PATHS.KENLIBS.PROGRESS(id))
              .then((res) => [id, Boolean(res.data?.completedAt)])
              .catch(() => [id, false])
          )
        );
        setCompletedBookIds(new Set(progressEntries.filter(([, done]) => done).map(([id]) => id)));
      } catch {
        setRequests([]);
      } finally {
        setIsLoading(false);
      }
    };
    fetchRequests();
  }, []);

  const handleDownloadCertificate = async (bookId, bookTitle) => {
    setDownloadingCertificateId(bookId);
    try {
      const response = await axiosInstance.get(API_PATHS.KENLIBS.CERTIFICATE(bookId), {
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `${bookTitle || "certificate"} — Kenlibs Certificate.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to generate certificate"));
    } finally {
      setDownloadingCertificateId(null);
    }
  };

  const openResubmit = (id) => {
    setResubmittingId(id);
    setResubmitFile(null);
  };

  const submitResubmit = async (id) => {
    if (!resubmitFile) {
      toast.error("Please choose a new evidence image first.");
      return;
    }
    setIsSubmittingResubmit(true);
    try {
      const formData = new FormData();
      formData.append("evidenceImage", resubmitFile);
      const res = await axiosInstance.put(API_PATHS.PURCHASES.RESUBMIT(id), formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setRequests((prev) => prev.map((r) => (r._id === id ? res.data : r)));
      toast.success("Evidence resubmitted — back in review.");
      setResubmittingId(null);
      setResubmitFile(null);
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to resubmit evidence"));
    } finally {
      setIsSubmittingResubmit(false);
    }
  };

  // Three groups instead of one flat list (Step 49) — a reader should see
  // what needs their action before what's just waiting, and what they can
  // actually read should feel like the page's main content, not just
  // another row in a list.
  const approvedRequests = requests.filter((r) => r.status === "approved");
  const pendingRequests = requests.filter((r) => r.status === "pending");
  // Revoked isn't literally "rejected", but it's the same "something needs
  // your attention / here's why" shape (an admin note, a support link) —
  // just without the resubmit option, which the backend only ever allows
  // from 'rejected'.
  const attentionRequests = requests.filter((r) => r.status === "rejected" || r.status === "revoked");

  // Flattened to one tile per readable BOOK, not per request — a single
  // approved bundle purchase grants several books at once, each of which
  // deserves its own cover tile here exactly like a direct book purchase
  // would.
  const readyBooks = approvedRequests.flatMap((r) =>
    r.itemType === "book"
      ? [
          {
            bookId: r.item,
            title: r.itemTitle,
            author: r.itemAuthor,
            coverImage: r.itemCoverImage,
            fromBundle: null,
          },
        ]
      : (r.itemBooks || []).map((b) => ({
          bookId: b._id,
          title: b.title,
          author: b.author,
          coverImage: b.coverImage,
          fromBundle: r.itemTitle,
        }))
  );

  return (
    <div className="min-h-screen bg-surface-warm">
      <KenlibsNav />

      <div className="max-w-5xl mx-auto px-6 lg:px-8 py-12">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">My Books</h1>
        <p className="text-gray-500 mb-10">Your library, and the status of every purchase request.</p>

        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6 animate-pulse">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="aspect-[2/3] bg-white border border-gray-100 rounded-2xl" />
            ))}
          </div>
        ) : requests.length === 0 ? (
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-10 text-center">
            <div className="w-16 h-16 bg-accent-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Sparkles className="w-8 h-8 text-accent" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No requests yet</h3>
            <p className="text-gray-500 mb-6">
              Browse Kenlibs and request to buy a book or bundle to see it here.
            </p>
            <Link
              to="/kenlibs"
              className="inline-flex px-6 py-2.5 rounded-2xl text-sm font-semibold text-white bg-gradient-to-r from-accent to-accent-secondary"
            >
              Browse Kenlibs
            </Link>
          </div>
        ) : (
          <div className="space-y-14">
            {/* Needs Attention — first, since it's the one thing on this
                page that's actually actionable. */}
            {attentionRequests.length > 0 && (
              <motion.section initial="hidden" animate="show" variants={sectionFadeUp}>
                <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900 mb-4">
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                  Needs Attention
                  <span className="text-gray-400 font-normal">({attentionRequests.length})</span>
                </h2>
                <motion.div
                  className="space-y-3"
                  initial="hidden"
                  animate="show"
                  variants={gridEntranceVariants}
                >
                  {attentionRequests.map((req) => {
                    const isRejected = req.status === "rejected";
                    const isResubmitOpen = resubmittingId === req._id;
                    return (
                      <motion.div
                        key={req._id}
                        layout
                        variants={itemFadeUp}
                        className="bg-white rounded-2xl border border-amber-100 shadow-sm p-5"
                      >
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-16 flex-shrink-0 rounded-lg overflow-hidden bg-gray-100">
                            {req.itemCoverImage && (
                              <img src={req.itemCoverImage} alt="" className="w-full h-full object-cover" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <h3 className="font-medium text-gray-900 truncate">{req.itemTitle}</h3>
                            <p className="text-sm text-gray-500 mt-0.5">
                              {formatNaira(req.amount)} · {req.itemType === "bundle" ? "Bundle" : "Book"}
                            </p>
                            {req.adminNote && <p className="text-xs text-red-500 mt-1">{req.adminNote}</p>}
                          </div>
                          <span
                            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold ${
                              isRejected ? "bg-red-50 text-red-600" : "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {isRejected ? "Rejected" : "Revoked"}
                          </span>
                        </div>

                        {/* No AnimatePresence/exit here (Step 52 audit) —
                            same simplification applied throughout: the
                            trigger/form branches swap instantly instead of
                            cross-fading, trading a small nicety for zero
                            risk of a stuck-exit blocker on this row. */}
                        {isRejected && (
                          <>
                            {!isResubmitOpen ? (
                              <motion.div key="trigger" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                                <motion.button
                                  whileTap={{ scale: 0.97 }}
                                  onClick={() => openResubmit(req._id)}
                                  className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-accent to-accent-secondary"
                                >
                                  <UploadCloud className="w-4 h-4" />
                                  Resubmit Evidence
                                </motion.button>
                              </motion.div>
                            ) : (
                              <motion.div
                                key="form"
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: "auto" }}
                                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                                className="overflow-hidden"
                              >
                                <div className="mt-4 pt-4 border-t border-gray-100 space-y-3">
                                  <label className="flex items-center gap-3 border-2 border-dashed border-gray-200 rounded-2xl px-4 py-3 cursor-pointer hover:border-accent-300 hover:bg-accent-50/30 transition-colors">
                                    <UploadCloud className="w-5 h-5 text-gray-400 flex-shrink-0" />
                                    <span className="text-sm text-gray-600 truncate">
                                      {resubmitFile ? resubmitFile.name : "Choose a new screenshot or photo"}
                                    </span>
                                    <input
                                      type="file"
                                      accept="image/*"
                                      className="hidden"
                                      onChange={(e) => setResubmitFile(e.target.files?.[0] || null)}
                                    />
                                  </label>
                                  <div className="flex gap-2">
                                    <motion.div whileTap={{ scale: 0.97 }}>
                                      <Button
                                        size="sm"
                                        loading={isSubmittingResubmit}
                                        onClick={() => submitResubmit(req._id)}
                                        className="flex items-center gap-1.5"
                                      >
                                        Submit
                                      </Button>
                                    </motion.div>
                                    <motion.div whileTap={{ scale: 0.97 }}>
                                      <Button size="sm" variant="secondary" onClick={() => setResubmittingId(null)}>
                                        Cancel
                                      </Button>
                                    </motion.div>
                                  </div>
                                </div>
                              </motion.div>
                            )}
                          </>
                        )}

                        {/* This is the moment a reader is most likely to
                            actually need help (Step 43) — a direct wa.me
                            link with the request's own book/bundle title
                            pre-filled, not just a pointer to the footer. */}
                        <a
                          href={buildWhatsAppHref(
                            `Hi, I need help with my purchase request for "${req.itemTitle}" — it was ${req.status}${
                              req.adminNote ? ` (note: "${req.adminNote}")` : ""
                            }.`
                          )}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-accent-hover transition-colors"
                        >
                          <MessageCircle className="w-3.5 h-3.5" />
                          Need help? Contact support
                        </a>
                      </motion.div>
                    );
                  })}
                </motion.div>
              </motion.section>
            )}

            {/* Ready to Read — the page's main content: real covers in a
                proper grid, not another row in a status list. */}
            {readyBooks.length > 0 && (
              <motion.section initial="hidden" animate="show" variants={sectionFadeUp}>
                <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900 mb-4">
                  <BookOpenCheck className="w-4 h-4 text-emerald-500" />
                  Ready to Read
                  <span className="text-gray-400 font-normal">({readyBooks.length})</span>
                </h2>
                <motion.div
                  className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-8"
                  initial="hidden"
                  animate="show"
                  variants={gridEntranceVariants}
                >
                  {readyBooks.map((b) => (
                    <ReadyBookCard
                      key={b.bookId}
                      bookId={b.bookId}
                      title={b.title}
                      author={b.author}
                      coverImage={b.coverImage}
                      fromBundle={b.fromBundle}
                      completed={completedBookIds.has(b.bookId)}
                      isDownloading={downloadingCertificateId === b.bookId}
                      onDownloadCertificate={() => handleDownloadCertificate(b.bookId, b.title)}
                    />
                  ))}
                </motion.div>
              </motion.section>
            )}

            {/* Pending Review — lowest urgency, so it's the plainest
                treatment: nothing to do here but wait. */}
            {pendingRequests.length > 0 && (
              <motion.section initial="hidden" animate="show" variants={sectionFadeUp}>
                <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900 mb-4">
                  <Clock className="w-4 h-4 text-amber-500" />
                  Pending Review
                  <span className="text-gray-400 font-normal">({pendingRequests.length})</span>
                </h2>
                <motion.div
                  className="space-y-2"
                  initial="hidden"
                  animate="show"
                  variants={gridEntranceVariants}
                >
                  {pendingRequests.map((req) => (
                    <motion.div
                      key={req._id}
                      variants={itemFadeUp}
                      className="flex items-center gap-4 bg-white rounded-2xl border border-gray-100 p-4"
                    >
                      <div className="w-10 h-14 flex-shrink-0 rounded-lg overflow-hidden bg-gray-100">
                        {req.itemCoverImage && (
                          <img src={req.itemCoverImage} alt="" className="w-full h-full object-cover" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-medium text-gray-900 text-sm truncate">{req.itemTitle}</h3>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {formatNaira(req.amount)} · {req.itemType === "bundle" ? "Bundle" : "Book"}
                        </p>
                      </div>
                      <span className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700">
                        <Clock className="w-3.5 h-3.5" />
                        Pending
                      </span>
                    </motion.div>
                  ))}
                </motion.div>
              </motion.section>
            )}
          </div>
        )}
      </div>
      <KenlibsFooter />
    </div>
  );
};

export default KenlibsMyBooksPage;
