import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Users, Loader2, KeyRound, AlertTriangle, Copy, Check } from "lucide-react";
import axiosInstance from "../utils/axiosInstance";
import { API_PATHS } from "../utils/apiPaths";
import getErrorMessage from "../utils/getErrorMessage";
import DashboardLayout from "../components/layout/DashboardLayout";
import Button from "../components/ui/Button";

const formatDate = (iso) =>
  new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });

// Internal admin tool — same plain/functional discipline as
// AdminBundlesPage.jsx and AdminPurchasesPage.jsx.
const AdminUsersPage = () => {
  const [readers, setReaders] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actingOnId, setActingOnId] = useState(null);
  // Two-step admin-initiated reset (Step 41), same "confirm, then act"
  // discipline as AdminPurchasesPage.jsx's revoke flow — this invalidates
  // whatever the reader currently has, so it shouldn't be a single
  // accidental click. resetTarget is the reader awaiting confirmation;
  // resetResult (set only after the request actually succeeds) is the
  // resulting token/link to hand the reader manually.
  const [resetTarget, setResetTarget] = useState(null);
  const [resetResult, setResetResult] = useState(null);
  const [copied, setCopied] = useState(false);

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
            Every account registered through Kenlibs, and their purchase activity.
          </p>
        </div>

        {readers.length === 0 ? (
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-10 text-center text-gray-400">
            No readers have signed up yet.
          </div>
        ) : (
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-gray-500">
                    <th className="px-6 py-3 font-medium">Name</th>
                    <th className="px-6 py-3 font-medium">Email</th>
                    <th className="px-6 py-3 font-medium">Signed up</th>
                    <th className="px-6 py-3 font-medium">Pending</th>
                    <th className="px-6 py-3 font-medium">Approved</th>
                    <th className="px-6 py-3 font-medium">Rejected</th>
                    <th className="px-6 py-3 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {readers.map((reader) => (
                    <tr key={reader._id} className="border-b border-gray-50 last:border-0">
                      <td className="px-6 py-3.5 font-medium text-gray-900">{reader.name}</td>
                      <td className="px-6 py-3.5 text-gray-600">{reader.email}</td>
                      <td className="px-6 py-3.5 text-gray-500">{formatDate(reader.createdAt)}</td>
                      <td className="px-6 py-3.5">
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700">
                          {reader.purchaseSummary.pending}
                        </span>
                      </td>
                      <td className="px-6 py-3.5">
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">
                          {reader.purchaseSummary.approved}
                        </span>
                      </td>
                      <td className="px-6 py-3.5">
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-600">
                          {reader.purchaseSummary.rejected}
                        </span>
                      </td>
                      <td className="px-6 py-3.5 text-right">
                        <button
                          onClick={() => setResetTarget(reader)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
                          title="Reset this reader's password"
                        >
                          <KeyRound className="w-3.5 h-3.5" />
                          Reset Password
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Reset confirmation modal — deliberately a two-step confirm, since
          this invalidates whatever the reader currently has. */}
      {resetTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setResetTarget(null)}
          />
          <div className="relative bg-white rounded-3xl shadow-2xl max-w-md w-full p-8">
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
                className="flex-1 bg-amber-500 hover:bg-amber-600"
                loading={actingOnId === resetTarget._id}
                onClick={submitReset}
              >
                Reset Password
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Reset result — the token/link the admin passes along manually
          (e.g. WhatsApp) since no email service exists yet. See
          authController.js's forgotPassword TODO for the same caveat. */}
      {resetResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setResetResult(null)}
          />
          <div className="relative bg-white rounded-3xl shadow-2xl max-w-md w-full p-8">
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
          </div>
        </div>
      )}
    </DashboardLayout>
  );
};

export default AdminUsersPage;
