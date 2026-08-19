import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { ShieldCheck, Check, X, Loader2 } from "lucide-react";
import axiosInstance from "../utils/axiosInstance";
import { API_PATHS } from "../utils/apiPaths";
import getErrorMessage from "../utils/getErrorMessage";
import DashboardLayout from "../components/layout/DashboardLayout";
import Button from "../components/ui/Button";
import { formatNaira } from "../utils/kenlibsPricing";

const TABS = ["pending", "approved", "rejected", "all"];

const STATUS_BADGE = {
  pending: "bg-amber-50 text-amber-700",
  approved: "bg-emerald-50 text-emerald-700",
  rejected: "bg-red-50 text-red-600",
};

const formatDate = (iso) =>
  new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });

// Internal admin tool for the Kenlibs purchase queue — deliberately plain,
// same discipline as AdminBundlesPage.jsx (Step 24).
const AdminPurchasesPage = () => {
  const [requests, setRequests] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [tab, setTab] = useState("pending");
  const [actingOnId, setActingOnId] = useState(null);
  const [lightboxUrl, setLightboxUrl] = useState(null);
  const [rejectTarget, setRejectTarget] = useState(null); // request being rejected
  const [rejectNote, setRejectNote] = useState("");

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
            Review payment evidence and approve or reject Kenlibs purchase requests.
          </p>
        </div>

        {/* Status tabs */}
        <div className="flex gap-1 bg-gray-100 rounded-2xl p-1 w-fit">
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
            {visible.map((request) => (
              <div
                key={request._id}
                className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex flex-col sm:flex-row sm:items-center gap-4"
              >
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
                    <h3 className="font-semibold text-gray-900 truncate">{request.itemTitle}</h3>
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
                  {request.status === "rejected" && request.adminNote && (
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
                {request.status === "pending" && (
                  <div className="flex gap-2 flex-shrink-0">
                    <Button
                      onClick={() => handleApprove(request)}
                      loading={actingOnId === request._id}
                      size="sm"
                      className="flex items-center gap-1.5"
                    >
                      <Check className="w-4 h-4" />
                      Approve
                    </Button>
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
                  </div>
                )}
              </div>
            ))}
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
              "evidence unclear, please resend".
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
    </DashboardLayout>
  );
};

export default AdminPurchasesPage;
