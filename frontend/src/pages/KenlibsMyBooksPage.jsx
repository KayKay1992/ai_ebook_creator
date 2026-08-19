import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import {
  Clock,
  CheckCircle2,
  XCircle,
  Ban,
  BookOpen,
  BookOpenCheck,
  UploadCloud,
} from "lucide-react";
import axiosInstance from "../utils/axiosInstance";
import { API_PATHS } from "../utils/apiPaths";
import getErrorMessage from "../utils/getErrorMessage";
import KenlibsNav from "../components/kenlibs/KenlibsNav";
import Button from "../components/ui/Button";
import { formatNaira } from "../utils/kenlibsPricing";
import useDocumentTitle from "../hooks/useDocumentTitle";

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

  useEffect(() => {
    const fetchRequests = async () => {
      try {
        const res = await axiosInstance.get(API_PATHS.PURCHASES.MINE);
        setRequests(res.data);
      } catch {
        setRequests([]);
      } finally {
        setIsLoading(false);
      }
    };
    fetchRequests();
  }, []);

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
          <div className="space-y-3">
            {requests.map((req) => {
              const meta = STATUS_META[req.status] || STATUS_META.pending;
              const StatusIcon = meta.icon;
              const isApproved = req.status === "approved";
              const isRejected = req.status === "rejected";
              const isResubmitOpen = resubmittingId === req._id;

              return (
                <div
                  key={req._id}
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

                    <span
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold flex-shrink-0 ${meta.className}`}
                    >
                      <StatusIcon className="w-3.5 h-3.5" />
                      {meta.label}
                    </span>
                  </div>

                  {/* A single-book purchase links straight to the reader; a
                      bundle grants access to every book it contains, so
                      each gets its own Read link. */}
                  {isApproved && req.itemType === "book" && (
                    <Link
                      to={`/kenlibs/read/${req.item}`}
                      className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-accent to-accent-secondary"
                    >
                      <BookOpenCheck className="w-4 h-4" />
                      Read Book
                    </Link>
                  )}
                  {isApproved && req.itemType === "bundle" && req.itemBooks?.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-gray-100">
                      <p className="text-xs text-gray-400 mb-2">Read a book from this bundle:</p>
                      <div className="flex flex-wrap gap-2">
                        {req.itemBooks.map((book) => (
                          <Link
                            key={book._id}
                            to={`/kenlibs/read/${book._id}`}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-accent-hover bg-accent-50 hover:bg-accent-100 transition-colors"
                          >
                            <BookOpenCheck className="w-3.5 h-3.5" />
                            {book.title}
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Rejected requests can be resubmitted with new evidence
                      without starting a whole new request. */}
                  {isRejected && !isResubmitOpen && (
                    <button
                      onClick={() => openResubmit(req._id)}
                      className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-accent to-accent-secondary"
                    >
                      <UploadCloud className="w-4 h-4" />
                      Resubmit Evidence
                    </button>
                  )}
                  {isRejected && isResubmitOpen && (
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
                        <Button
                          size="sm"
                          loading={isSubmittingResubmit}
                          onClick={() => submitResubmit(req._id)}
                          className="flex items-center gap-1.5"
                        >
                          Submit
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setResubmittingId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default KenlibsMyBooksPage;
