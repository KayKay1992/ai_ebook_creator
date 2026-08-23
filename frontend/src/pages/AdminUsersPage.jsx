import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";
import {
  Users,
  Loader2,
  KeyRound,
  AlertTriangle,
  Copy,
  Check,
  Trash2,
  Gift,
  Wallet,
  UserX,
} from "lucide-react";
import axiosInstance from "../utils/axiosInstance";
import { API_PATHS } from "../utils/apiPaths";
import getErrorMessage from "../utils/getErrorMessage";
import DashboardLayout from "../components/layout/DashboardLayout";
import Button from "../components/ui/Button";
import { formatNaira } from "../utils/kenlibsPricing";

const formatDate = (iso) =>
  new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });

const listEntranceVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};
const cardFadeUp = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] } },
};

const StatPill = ({ label, value, className }) => (
  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${className}`}>
    {label} {value}
  </span>
);

const AdminUsersPage = () => {
  const [readers, setReaders] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actingOnId, setActingOnId] = useState(null);
  // Two-step admin-initiated reset (Step 41), same "confirm, then act"
  // discipline as the delete flow below — this invalidates whatever the
  // reader currently has, so it shouldn't be a single accidental click.
  const [resetTarget, setResetTarget] = useState(null);
  const [resetResult, setResetResult] = useState(null);
  const [copied, setCopied] = useState(false);
  // Delete/anonymize (Step 50) — same two-step confirm pattern. Which of
  // the two actually happens is decided server-side (does this account
  // have any purchase/referral history), so the confirmation dialog
  // explains the rule rather than predicting the outcome, and the
  // resulting toast reflects what actually happened.
  const [deleteTarget, setDeleteTarget] = useState(null);

  useEffect(() => {
    const fetchReaders = async () => {
      try {
        const res = await axiosInstance.get(API_PATHS.ADMIN.USERS);
        setReaders(res.data);
      } catch (error) {
        toast.error(getErrorMessage(error, "Failed to load users"));
      } finally {
        setIsLoading(false);
      }
    };
    fetchReaders();
  }, []);

  const submitReset = async () => {
    if (!resetTarget) return;
    setActingOnId(resetTarget._id);
    try {
      const res = await axiosInstance.post(API_PATHS.ADMIN.RESET_USER_PASSWORD(resetTarget._id));
      setResetResult({ reader: resetTarget, resetToken: res.data.resetToken });
      setResetTarget(null);
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to reset password"));
    } finally {
      setActingOnId(null);
    }
  };

  const submitDelete = async () => {
    if (!deleteTarget) return;
    setActingOnId(deleteTarget._id);
    try {
      const res = await axiosInstance.delete(API_PATHS.ADMIN.DELETE_USER(deleteTarget._id));
      if (res.data.action === "hard-deleted") {
        setReaders((prev) => prev.filter((r) => r._id !== deleteTarget._id));
        toast.success(`${deleteTarget.name} was permanently deleted.`);
      } else {
        setReaders((prev) =>
          prev.map((r) =>
            r._id === deleteTarget._id ? { ...r, name: "Deleted User", email: "", isDeleted: true } : r
          )
        );
        toast.success(`${deleteTarget.name} was anonymized — their purchase history was kept.`);
      }
      setDeleteTarget(null);
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to delete user"));
    } finally {
      setActingOnId(null);
    }
  };

  const resetLink = resetResult
    ? `${window.location.origin}/kenlibs/reset-password/${resetResult.resetToken}`
    : "";

  const copyResetLink = async () => {
    try {
      await navigator.clipboard.writeText(resetLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy — select and copy the link manually.");
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
            <Users className="w-6 h-6 text-accent" />
            Readers
          </h1>
          <p className="text-gray-500 mt-1">
            Every account registered through Kenlibs, and their purchase and referral activity.
          </p>
        </div>

        {readers.length === 0 ? (
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-10 text-center text-gray-400">
            No readers have signed up yet.
          </div>
        ) : (
          <motion.div className="space-y-3" initial="hidden" animate="show" variants={listEntranceVariants}>
            {readers.map((reader) => {
              const s = reader.purchaseSummary || {};
              return (
                <motion.div
                  key={reader._id}
                  layout
                  variants={cardFadeUp}
                  className={`bg-white rounded-2xl border shadow-sm p-5 ${
                    reader.isDeleted ? "border-gray-100 opacity-60" : "border-gray-100"
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3.5 min-w-0">
                      <div
                        className={`w-11 h-11 rounded-2xl flex items-center justify-center font-semibold flex-shrink-0 ${
                          reader.isDeleted ? "bg-gray-100 text-gray-400" : "bg-accent-50 text-accent"
                        }`}
                      >
                        {reader.isDeleted ? <UserX className="w-5 h-5" /> : reader.name?.charAt(0)?.toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-gray-900 truncate">{reader.name}</p>
                        <p className="text-sm text-gray-500 truncate">
                          {reader.isDeleted ? "Account deleted" : reader.email}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">Joined {formatDate(reader.createdAt)}</p>
                      </div>
                    </div>

                    {!reader.isDeleted && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => setResetTarget(reader)}
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
                          title="Reset this reader's password"
                        >
                          <KeyRound className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setDeleteTarget(reader)}
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                          title="Delete this reader"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>

                  {!reader.isDeleted && (
                    <div className="flex flex-wrap items-center gap-1.5 mt-4 pt-4 border-t border-gray-50">
                      {s.approved > 0 && (
                        <StatPill label="Approved" value={s.approved} className="bg-emerald-50 text-emerald-700" />
                      )}
                      {s.pending > 0 && (
                        <StatPill label="Pending" value={s.pending} className="bg-amber-50 text-amber-700" />
                      )}
                      {s.rejected > 0 && (
                        <StatPill label="Rejected" value={s.rejected} className="bg-red-50 text-red-600" />
                      )}
                      {s.revoked > 0 && (
                        <StatPill label="Revoked" value={s.revoked} className="bg-slate-100 text-slate-600" />
                      )}
                      {s.totalSpent > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-accent-50 text-accent-hover">
                          <Wallet className="w-3 h-3" />
                          {formatNaira(s.totalSpent)} spent
                        </span>
                      )}
                      {reader.successfulReferrals > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-accent-secondary-50 text-accent-secondary">
                          <Gift className="w-3 h-3" />
                          {reader.successfulReferrals} referred
                        </span>
                      )}
                      {reader.creditBalance > 0 && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
                          {formatNaira(reader.creditBalance)} credit
                        </span>
                      )}
                      {!s.approved && !s.pending && !s.rejected && !s.revoked && (
                        <span className="text-xs text-gray-400">No purchase activity yet</span>
                      )}
                    </div>
                  )}
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </div>

      {/* Reset confirmation modal — deliberately a two-step confirm, since
          this invalidates whatever the reader currently has. */}
      <AnimatePresence>
        {resetTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={() => setResetTarget(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="relative bg-white rounded-3xl shadow-2xl max-w-md w-full p-8"
            >
              <div className="w-12 h-12 bg-amber-50 rounded-2xl flex items-center justify-center mb-4">
                <KeyRound className="w-6 h-6 text-amber-500" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">
                Reset {resetTarget.name}'s password?
              </h3>
              <p className="text-gray-500 mb-6">
                This generates a new reset token and immediately invalidates
                their current password — they won't be able to sign in again
                until they (or you, on their behalf) set a new one with the
                resulting link.
              </p>
              <div className="flex gap-3">
                <Button variant="secondary" className="flex-1" onClick={() => setResetTarget(null)}>
                  Cancel
                </Button>
                <Button
                  variant="warning"
                  className="flex-1"
                  loading={actingOnId === resetTarget._id}
                  onClick={submitReset}
                >
                  Reset Password
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Reset result — the token/link the admin passes along manually
          (e.g. WhatsApp) since no email service exists yet. See
          authController.js's forgotPassword TODO for the same caveat. */}
      <AnimatePresence>
        {resetResult && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={() => setResetResult(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="relative bg-white rounded-3xl shadow-2xl max-w-md w-full p-8"
            >
              <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center mb-4">
                <KeyRound className="w-6 h-6 text-emerald-500" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">
                Reset link generated for {resetResult.reader.name}
              </h3>
              <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 text-amber-700 text-xs rounded-2xl px-4 py-3 mb-4">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>
                  No email service is configured yet — this link is shown here
                  instead of being emailed to {resetResult.reader.name} privately.
                  Anyone who sees it can reset this account, so pass it along
                  carefully (e.g. a direct WhatsApp message), not a public
                  channel.
                </span>
              </div>
              <div className="flex items-center gap-2 bg-gray-50 border border-gray-100 rounded-2xl px-4 py-3 mb-6">
                <p className="text-xs text-gray-600 break-all flex-1">{resetLink}</p>
                <button
                  onClick={copyResetLink}
                  className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors"
                  title="Copy link"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
              <Button className="w-full" onClick={() => setResetResult(null)}>
                Done
              </Button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete confirmation — the exact outcome (hard delete vs.
          anonymize) is decided server-side, so this explains the rule
          rather than predicting which one applies to this specific
          reader. */}
      <AnimatePresence>
        {deleteTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={() => setDeleteTarget(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="relative bg-white rounded-3xl shadow-2xl max-w-md w-full p-8"
            >
              <div className="w-12 h-12 bg-red-50 rounded-2xl flex items-center justify-center mb-4">
                <Trash2 className="w-6 h-6 text-red-500" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">Delete {deleteTarget.name}?</h3>
              <p className="text-gray-500 mb-6">
                If this reader has no purchase or referral history, their account is permanently
                deleted. If they do, it's anonymized instead — name, email, and password cleared,
                sign-in blocked immediately — while their purchase records are kept for accounting
                and dispute purposes. Either way, this can't be undone.
              </p>
              <div className="flex gap-3">
                <Button variant="secondary" className="flex-1" onClick={() => setDeleteTarget(null)}>
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  className="flex-1"
                  loading={actingOnId === deleteTarget._id}
                  onClick={submitDelete}
                >
                  Delete
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </DashboardLayout>
  );
};

export default AdminUsersPage;
