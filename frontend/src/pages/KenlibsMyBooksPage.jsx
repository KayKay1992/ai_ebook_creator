import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";
import {
  Clock,
  CheckCircle2,
  XCircle,
  Ban,
  BookOpen,
  BookOpenCheck,
  UploadCloud,
  Award,
} from "lucide-react";
import axiosInstance from "../utils/axiosInstance";
import { API_PATHS } from "../utils/apiPaths";
import getErrorMessage from "../utils/getErrorMessage";
import KenlibsNav from "../components/kenlibs/KenlibsNav";
import Button from "../components/ui/Button";
import { formatNaira } from "../utils/kenlibsPricing";
import useDocumentTitle from "../hooks/useDocumentTitle";

const rowEntranceVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07 } },
};
const rowFadeUp = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] } },
};

const STATUS_META = {
  pending: { label: "Pending", icon: Clock, className: "bg-amber-50 text-amber-700" },
  approved: { label: "Approved", icon: CheckCircle2, className: "bg-emerald-50 text-emerald-700" },
  rejected: { label: "Rejected", icon: XCircle, className: "bg-red-50 text-red-600" },
  revoked: { label: "Revoked", icon: Ban, className: "bg-slate-100 text-slate-600" },
};

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

  return (
    <div className="min-h-screen bg-gray-50">
      <KenlibsNav />

      <div className="max-w-3xl mx-auto px-6 lg:px-8 py-12">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">My Books</h1>
        <p className="text-gray-500 mb-8">Your purchase requests and their status.</p>

        {isLoading ? (
          <div className="space-y-3 animate-pulse">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-20 bg-white border border-gray-100 rounded-2xl" />
            ))}
          </div>
        ) : requests.length === 0 ? (
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-10 text-center">
            <div className="w-16 h-16 bg-accent-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <BookOpen className="w-8 h-8 text-accent" />
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
          <motion.div
            className="space-y-3"
            initial="hidden"
            animate="show"
            variants={rowEntranceVariants}
          >
            {requests.map((req) => {
              const meta = STATUS_META[req.status] || STATUS_META.pending;
              const StatusIcon = meta.icon;
              const isApproved = req.status === "approved";
              const isRejected = req.status === "rejected";
              const isResubmitOpen = resubmittingId === req._id;

              return (
                <motion.div
                  key={req._id}
                  layout
                  variants={rowFadeUp}
                  className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-16 flex-shrink-0 rounded-lg overflow-hidden bg-gray-100">
                      {req.itemCoverImage && (
                        <img
                          src={req.itemCoverImage}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <h3 className="font-medium text-gray-900 truncate">{req.itemTitle}</h3>
                      <p className="text-sm text-gray-500 mt-0.5">
                        {formatNaira(req.amount)} · {req.itemType === "bundle" ? "Bundle" : "Book"}
                      </p>
                      {(isRejected || req.status === "revoked") && req.adminNote && (
                        <p className="text-xs text-red-500 mt-1">{req.adminNote}</p>
                      )}
                    </div>

                    {/* Keyed by status so any change (most notably landing
                        on "approved") pops in fresh rather than silently
                        swapping label/color in place. */}
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.span
                        key={req.status}
                        initial={{ scale: 0.6, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ type: "spring", stiffness: 400, damping: 20 }}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold flex-shrink-0 ${meta.className}`}
                      >
                        <StatusIcon className="w-3.5 h-3.5" />
                        {meta.label}
                      </motion.span>
                    </AnimatePresence>
                  </div>

                  {/* A single-book purchase links straight to the reader; a
                      bundle grants access to every book it contains, so
                      each gets its own Read link. */}
                  {isApproved && req.itemType === "book" && (
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <Link
                        to={`/kenlibs/read/${req.item}`}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-accent to-accent-secondary"
                      >
                        <BookOpenCheck className="w-4 h-4" />
                        Read Book
                      </Link>
                      {completedBookIds.has(req.item) && (
                        <motion.button
                          whileTap={{ scale: 0.96 }}
                          disabled={downloadingCertificateId === req.item}
                          onClick={() => handleDownloadCertificate(req.item, req.itemTitle)}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-accent-hover bg-accent-50 hover:bg-accent-100 transition-colors disabled:opacity-60"
                        >
                          <Award className="w-4 h-4" />
                          {downloadingCertificateId === req.item ? "Preparing…" : "Certificate"}
                        </motion.button>
                      )}
                    </div>
                  )}
                  {isApproved && req.itemType === "bundle" && req.itemBooks?.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-gray-100">
                      <p className="text-xs text-gray-400 mb-2">Read a book from this bundle:</p>
                      <div className="flex flex-wrap gap-2">
                        {req.itemBooks.map((book) => (
                          <div key={book._id} className="inline-flex items-center gap-1.5">
                            <Link
                              to={`/kenlibs/read/${book._id}`}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-accent-hover bg-accent-50 hover:bg-accent-100 transition-colors"
                            >
                              <BookOpenCheck className="w-3.5 h-3.5" />
                              {book.title}
                            </Link>
                            {completedBookIds.has(book._id) && (
                              <motion.button
                                whileTap={{ scale: 0.96 }}
                                disabled={downloadingCertificateId === book._id}
                                onClick={() => handleDownloadCertificate(book._id, book.title)}
                                title="Download certificate"
                                className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-accent-hover bg-accent-50 hover:bg-accent-100 transition-colors disabled:opacity-60 flex-shrink-0"
                              >
                                <Award className="w-3.5 h-3.5" />
                              </motion.button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Rejected requests can be resubmitted with new evidence
                      without starting a whole new request. */}
                  {isRejected && (
                    <AnimatePresence mode="wait" initial={false}>
                      {!isResubmitOpen ? (
                        <motion.div
                          key="trigger"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                        >
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
                          exit={{ opacity: 0, height: 0 }}
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
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => setResubmittingId(null)}
                                >
                                  Cancel
                                </Button>
                              </motion.div>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  )}
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </div>
    </div>
  );
};

export default KenlibsMyBooksPage;
