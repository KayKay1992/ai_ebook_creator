import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { ShieldCheck, Check, X, Loader2, Undo2, ChevronDown, History } from "lucide-react";
import axiosInstance from "../utils/axiosInstance";
import { API_PATHS } from "../utils/apiPaths";
import getErrorMessage from "../utils/getErrorMessage";
import DashboardLayout from "../components/layout/DashboardLayout";
import Button from "../components/ui/Button";
import { formatNaira } from "../utils/kenlibsPricing";

const TABS = ["pending", "approved", "rejected", "revoked", "all"];

const STATUS_BADGE = {
  pending: "bg-amber-50 text-amber-700",
  approved: "bg-emerald-50 text-emerald-700",
  rejected: "bg-red-50 text-red-600",
  revoked: "bg-slate-100 text-slate-600",
};

const formatDate = (iso) =>
  new Date(iso).toLocaleDateString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

const formatDateTime = (iso) =>
  new Date(iso).toLocaleString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

// Internal admin tool for the Kenlibs purchase queue — deliberately plain,
// same discipline as AdminBundlesPage.jsx (Step 24). Extended in Step 30
// for the full lifecycle: approve-from-rejected, revoke-from-approved, and
// a reviewHistory trail per request.
const AdminPurchasesPage = () => {
  const [requests, setRequests] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [tab, setTab] = useState("pending");
  const [actingOnId, setActingOnId] = useState(null);
  const [lightboxUrl, setLightboxUrl] = useState(null);
  const [rejectTarget, setRejectTarget] = useState(null); // request being rejected
  const [rejectNote, setRejectNote] = useState("");
  const [revokeTarget, setRevokeTarget] = useState(null); // request being revoked
  const [revokeNote, setRevokeNote] = useState("");
  const [expandedHistoryId, setExpandedHistoryId] = useState(null);

  useEffect(() => {
    const fetchRequests = async () => {
      try {
        const res = await axiosInstance.get(API_PATHS.PURCHASES.ALL);
        setRequests(res.data);
      } catch (error) {
        toast.error(getErrorMessage(error, "Failed to load purchase requests"));
      } finally {
        setIsLoading(false);
      }
    };
    fetchRequests();
  }, []);

  const counts = useMemo(
    () => ({
      pending: requests.filter((r) => r.status === "pending").length,
      approved: requests.filter((r) => r.status === "approved").length,
      rejected: requests.filter((r) => r.status === "rejected").length,
      revoked: requests.filter((r) => r.status === "revoked").length,
      all: requests.length,
    }),
    [requests]
  );

  const visible = tab === "all" ? requests : requests.filter((r) => r.status === tab);

  const applyUpdate = (updated) => {
    setRequests((prev) => prev.map((r) => (r._id === updated._id ? updated : r)));
  };

  const handleApprove = async (request) => {
    setActingOnId(request._id);
    try {
      const res = await axiosInstance.put(API_PATHS.PURCHASES.APPROVE(request._id));
      applyUpdate(res.data);
      toast.success("Request approved.");
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to approve request"));
    } finally {
      setActingOnId(null);
    }
  };

  const submitReject = async () => {
    if (!rejectTarget) return;
    setActingOnId(rejectTarget._id);
    try {
      const res = await axiosInstance.put(API_PATHS.PURCHASES.REJECT(rejectTarget._id), {
        adminNote: rejectNote.trim(),
      });
      applyUpdate(res.data);
      toast.success("Request rejected.");
      setRejectTarget(null);
      setRejectNote("");
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to reject request"));
    } finally {
      setActingOnId(null);
    }
  };

  const submitRevoke = async () => {
    if (!revokeTarget) return;
    setActingOnId(revokeTarget._id);
    try {
      const res = await axiosInstance.put(API_PATHS.PURCHASES.REVOKE(revokeTarget._id), {
        adminNote: revokeNote.trim(),
      });
      applyUpdate(res.data);
      toast.success("Access revoked.");
      setRevokeTarget(null);
      setRevokeNote("");
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to revoke request"));
    } finally {
      setActingOnId(null);
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
            <ShieldCheck className="w-6 h-6 text-accent" />
            Purchase Requests
          </h1>
          <p className="text-gray-500 mt-1">
            Review payment evidence and approve, reject, or revoke Kenlibs purchase requests.
          </p>
        </div>

        {/* Status tabs */}
        <div className="flex flex-wrap gap-1 bg-gray-100 rounded-2xl p-1 w-fit">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-xl text-sm font-medium capitalize transition-colors ${
                tab === t
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-800"
              }`}
            >
              {t} <span className="text-xs text-gray-400">({counts[t]})</span>
            </button>
          ))}
        </div>

        {/* Queue */}
        {visible.length === 0 ? (
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-10 text-center text-gray-400">
            No {tab === "all" ? "" : tab} requests.
          </div>
        ) : (
          <div className="space-y-3">
            {visible.map((request) => {
              const history = request.reviewHistory || [];
              const isHistoryOpen = expandedHistoryId === request._id;

              return (
                <div
                  key={request._id}
                  className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                    {/* Item thumbnail */}
                    <div className="w-12 h-16 flex-shrink-0 rounded-lg overflow-hidden bg-gray-100">
                      {request.itemCoverImage && (
                        <img
                          src={request.itemCoverImage}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      )}
                    </div>

                    {/* Details */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-gray-900 truncate">
                          {request.itemTitle}
                        </h3>
                        <span className="text-xs text-gray-400 uppercase tracking-wide">
                          {request.itemType}
                        </span>
                        <span
                          className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${STATUS_BADGE[request.status]}`}
                        >
                          {request.status}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 mt-1">
                        {request.reader?.name || "Unknown reader"} ·{" "}
                        <span className="text-gray-400">{request.reader?.email}</span>
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        {formatNaira(request.amount)} · submitted {formatDate(request.createdAt)}
                      </p>
                      {(request.status === "rejected" || request.status === "revoked") &&
                        request.adminNote && (
                          <p className="text-xs text-red-500 mt-1">Note: {request.adminNote}</p>
                        )}
                    </div>

                    {/* Evidence thumbnail */}
                    <button
                      onClick={() => setLightboxUrl(request.evidenceImage)}
                      className="w-16 h-16 flex-shrink-0 rounded-xl overflow-hidden border border-gray-200 hover:border-accent-400 transition-colors"
                      title="View evidence"
                    >
                      <img
                        src={request.evidenceImage}
                        alt="Payment evidence"
                        className="w-full h-full object-cover"
                      />
                    </button>

                    {/* Actions */}
                    <div className="flex gap-2 flex-shrink-0">
                      {(request.status === "pending" || request.status === "rejected") && (
                        <Button
                          onClick={() => handleApprove(request)}
                          loading={actingOnId === request._id}
                          size="sm"
                          className="flex items-center gap-1.5"
                        >
                          <Check className="w-4 h-4" />
                          Approve
                        </Button>
                      )}
                      {request.status === "pending" && (
                        <Button
                          onClick={() => {
                            setRejectTarget(request);
                            setRejectNote("");
                          }}
                          variant="secondary"
                          size="sm"
                          className="flex items-center gap-1.5"
                        >
                          <X className="w-4 h-4" />
                          Reject
                        </Button>
                      )}
                      {request.status === "approved" && (
                        <Button
                          onClick={() => {
                            setRevokeTarget(request);
                            setRevokeNote("");
                          }}
                          variant="secondary"
                          size="sm"
                          className="flex items-center gap-1.5 text-red-600 hover:bg-red-50"
                        >
                          <Undo2 className="w-4 h-4" />
                          Revoke
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Review history */}
                  {history.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-50">
                      <button
                        onClick={() =>
                          setExpandedHistoryId(isHistoryOpen ? null : request._id)
                        }
                        className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-800 transition-colors"
                      >
                        <History className="w-3.5 h-3.5" />
                        {history.length} review event{history.length === 1 ? "" : "s"}
                        <ChevronDown
                          className={`w-3.5 h-3.5 transition-transform ${isHistoryOpen ? "rotate-180" : ""}`}
                        />
                      </button>

                      {isHistoryOpen && (
                        <div className="mt-3 space-y-2 pl-1">
                          {history.map((entry, i) => (
                            <div key={i} className="flex items-start gap-2.5 text-xs">
                              <span
                                className={`mt-0.5 px-2 py-0.5 rounded-full font-medium capitalize flex-shrink-0 ${STATUS_BADGE[entry.status] || "bg-gray-100 text-gray-600"}`}
                              >
                                {entry.status}
                              </span>
                              <div className="min-w-0">
                                <p className="text-gray-500">
                                  {formatDateTime(entry.reviewedAt)}
                                  {entry.reviewedBy?.name && ` · ${entry.reviewedBy.name}`}
                                </p>
                                {entry.note && (
                                  <p className="text-gray-700 mt-0.5">{entry.note}</p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Evidence lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm"
          onClick={() => setLightboxUrl(null)}
        >
          <img
            src={lightboxUrl}
            alt="Payment evidence, full size"
            className="max-w-full max-h-full rounded-2xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={() => setLightboxUrl(null)}
            className="absolute top-6 right-6 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Reject note modal */}
      {rejectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setRejectTarget(null)}
          />
          <div className="relative bg-white rounded-3xl shadow-2xl max-w-md w-full p-8">
            <h3 className="text-xl font-bold text-gray-900 mb-2">Reject this request?</h3>
            <p className="text-gray-500 mb-5">
              Optionally let {rejectTarget.reader?.name || "the reader"} know why — e.g.
              "evidence unclear, please resend". They'll be able to resubmit new evidence.
            </p>
            <textarea
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              rows={3}
              placeholder="Optional note (shown to the reader)"
              className="w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500 transition-all resize-none mb-6"
            />
            <div className="flex gap-3">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => setRejectTarget(null)}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-red-600 hover:bg-red-700"
                loading={actingOnId === rejectTarget._id}
                onClick={submitReject}
              >
                Reject Request
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Revoke confirmation modal — deliberately a two-step confirm, since
          this actively removes a reader's already-granted access. */}
      {revokeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setRevokeTarget(null)}
          />
          <div className="relative bg-white rounded-3xl shadow-2xl max-w-md w-full p-8">
            <div className="w-12 h-12 bg-red-50 rounded-2xl flex items-center justify-center mb-4">
              <Undo2 className="w-6 h-6 text-red-500" />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">
              Revoke {revokeTarget.reader?.name || "this reader"}'s access?
            </h3>
            <p className="text-gray-500 mb-5">
              They'll immediately lose read access to{" "}
              <span className="font-medium text-gray-700">{revokeTarget.itemTitle}</span>. This
              can't be undone from here — a new purchase request would be needed to restore
              access.
            </p>
            <textarea
              value={revokeNote}
              onChange={(e) => setRevokeNote(e.target.value)}
              rows={3}
              placeholder="Optional note (kept on record)"
              className="w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500 transition-all resize-none mb-6"
            />
            <div className="flex gap-3">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => setRevokeTarget(null)}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-red-600 hover:bg-red-700"
                loading={actingOnId === revokeTarget._id}
                onClick={submitRevoke}
              >
                Revoke Access
              </Button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
};

export default AdminPurchasesPage;
