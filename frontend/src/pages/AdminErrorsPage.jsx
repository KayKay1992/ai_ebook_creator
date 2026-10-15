import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Bug, CheckCircle2, ChevronDown, Loader2, RotateCcw, Trash2 } from "lucide-react";
import axiosInstance from "../utils/axiosInstance";
import { API_PATHS } from "../utils/apiPaths";
import getErrorMessage from "../utils/getErrorMessage";
import DashboardLayout from "../components/layout/DashboardLayout";
import Button from "../components/ui/Button";
import Modal from "../components/ui/Modal";

// Self-hosted error monitoring (backend/utils/errorLogger.js): backend 5xx
// errors, background job failures and browser errors, grouped by
// fingerprint. Messages and stacks are scrubbed of emails and tokens before
// they're stored, and entries delete themselves after ERROR_LOG_TTL_DAYS.

const FILTERS = [
  ["unresolved", "Unresolved"],
  ["resolved", "Resolved"],
  ["all", "All"],
];

const SOURCE_STYLES = {
  backend: "bg-red-50 text-red-700",
  frontend: "bg-sky-50 text-sky-700",
  job: "bg-violet-50 text-violet-700",
};

const formatWhen = (iso) =>
  iso
    ? new Date(iso).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "—";

const whereOf = (entry) =>
  entry.jobType
    ? `${entry.jobType}${entry.bookId ? ` · book ${entry.bookId}` : ""}${entry.chapterId ? ` · chapter ${entry.chapterId}` : ""}`
    : [entry.method, entry.route, entry.statusCode].filter(Boolean).join(" ");

const AdminErrorsPage = () => {
  const [filter, setFilter] = useState("unresolved");
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const load = useCallback(
    () =>
      axiosInstance
        .get(API_PATHS.ERRORS.LIST, { params: { status: filter } })
        .then((res) => setData(res.data))
        .catch((error) => toast.error(getErrorMessage(error, "Couldn't load errors.")))
        .finally(() => setIsLoading(false)),
    [filter]
  );

  useEffect(() => {
    load();
  }, [load]);

  const changeFilter = (next) => {
    if (next === filter) return;
    setIsLoading(true);
    setFilter(next);
  };

  const setResolved = async (entry, resolved) => {
    setBusyId(entry._id);
    try {
      await axiosInstance.put(API_PATHS.ERRORS.ONE(entry._id), { resolved });
      toast.success(resolved ? "Marked resolved." : "Marked unresolved.");
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error, "Couldn't update it."));
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async () => {
    const entry = deleteTarget;
    setBusyId(entry._id);
    try {
      await axiosInstance.delete(API_PATHS.ERRORS.ONE(entry._id));
      toast.success("Deleted.");
      setDeleteTarget(null);
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error, "Couldn't delete it."));
    } finally {
      setBusyId(null);
    }
  };

  const errors = data?.errors || [];

  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Bug className="w-6 h-6 text-accent" />
              Errors
            </h1>
            <p className="text-gray-500 mt-1">
              Server errors, failed background jobs and readers' browser errors, grouped. Most recent first.
            </p>
          </div>
          <div className="flex gap-1 bg-gray-100 rounded-2xl p-1 self-start" role="tablist" aria-label="Filter">
            {FILTERS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={filter === value}
                onClick={() => changeFilter(value)}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                  filter === value ? "bg-white text-accent-hover shadow-sm" : "text-gray-600 hover:text-gray-900"
                }`}
              >
                {label}
                {value === "unresolved" && data?.unresolvedCount ? ` (${data.unresolvedCount})` : ""}
              </button>
            ))}
          </div>
        </div>

        {data && !data.enabled && (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
            Error logging is turned off on the server (ERROR_LOG_ENABLED=false), so nothing new is being recorded.
          </p>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="w-8 h-8 text-accent animate-spin" />
          </div>
        ) : errors.length === 0 ? (
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-10 text-center text-gray-400">
            {filter === "unresolved" ? "No unresolved errors. 🎉" : "Nothing here."}
          </div>
        ) : (
          <ul className="space-y-3">
            {errors.map((entry) => {
              const isExpanded = expandedId === entry._id;
              return (
                <li key={entry._id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-5">
                  <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 mb-1.5">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${SOURCE_STYLES[entry.source] || "bg-gray-100 text-gray-600"}`}>
                          {entry.source}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-700">
                          ×{entry.count.toLocaleString("en-US")}
                        </span>
                        {entry.resolved && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700">
                            <CheckCircle2 className="w-3 h-3" /> Resolved
                          </span>
                        )}
                        {!entry.resolved && entry.reopenedAt && (
                          <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700">Came back</span>
                        )}
                      </div>
                      <p className="font-medium text-gray-900 break-words">{entry.message}</p>
                      {whereOf(entry) && <p className="text-xs text-gray-500 mt-1 break-all">{whereOf(entry)}</p>}
                      <p className="text-xs text-gray-400 mt-1">
                        First {formatWhen(entry.firstSeenAt)} · Last {formatWhen(entry.lastSeenAt)}
                        {entry.release ? ` · ${entry.release.slice(0, 12)}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2 sm:justify-end">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setResolved(entry, !entry.resolved)}
                        loading={busyId === entry._id}
                        className="flex items-center gap-1.5 whitespace-nowrap"
                      >
                        {entry.resolved ? <RotateCcw className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                        {entry.resolved ? "Reopen" : "Mark resolved"}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setDeleteTarget(entry)}
                        disabled={busyId === entry._id}
                        className="flex items-center gap-1.5 text-red-600"
                        aria-label="Delete error"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span className="sr-only sm:not-sr-only">Delete</span>
                      </Button>
                    </div>
                  </div>
                  {entry.stack && (
                    <div className="mt-3">
                      <button
                        type="button"
                        onClick={() => setExpandedId(isExpanded ? null : entry._id)}
                        aria-expanded={isExpanded}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-accent-hover hover:underline"
                      >
                        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                        {isExpanded ? "Hide stack trace" : "Show stack trace"}
                      </button>
                      {isExpanded && (
                        <pre className="mt-2 max-h-80 overflow-auto rounded-xl bg-gray-900 text-gray-100 text-xs p-3 whitespace-pre-wrap break-all">
                          {entry.stack}
                        </pre>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Modal isOpen={Boolean(deleteTarget)} onClose={() => busyId === null && setDeleteTarget(null)} title="Delete this error?">
        {deleteTarget && (
          <div className="space-y-6">
            <p className="text-gray-600">
              It's removed from the list. If it happens again it comes back as a new error (and you'll get an alert email).
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setDeleteTarget(null)} disabled={busyId !== null}>
                Keep it
              </Button>
              <Button variant="danger" onClick={confirmDelete} loading={busyId === deleteTarget._id}>
                Delete
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </DashboardLayout>
  );
};

export default AdminErrorsPage;
