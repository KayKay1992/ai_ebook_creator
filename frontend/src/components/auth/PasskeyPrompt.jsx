import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Fingerprint, Loader2, X } from "lucide-react";
import toast from "react-hot-toast";
import axiosInstance from "../../utils/axiosInstance";
import { API_PATHS } from "../../utils/apiPaths";
import { addPasskey, passkeyErrorMessage } from "../../utils/passkeyClient";
import {
  guessDeviceName,
  hasPlatformAuthenticator,
  isPasskeyPromptDone,
  markPasskeyPromptDone,
  takePasskeyPromptFlag,
} from "../../utils/passkeySupport";

// One-time, dismissible "Sign in faster with your fingerprint next time",
// after a password sign-in (PasskeyPromptHost in App.jsx), only when this
// device has a fingerprint/face/screen-lock authenticator, the account has
// no passkey yet, and it hasn't been shown to this account on this browser
// before. Lazy-loaded, so it costs nothing otherwise.
const PasskeyPrompt = ({ user, profilePath }) => {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    takePasskeyPromptFlag();
    (async () => {
      if (!user?._id || isPasskeyPromptDone(user._id)) return;
      if (!(await hasPlatformAuthenticator())) return;
      try {
        const res = await axiosInstance.get(API_PATHS.PASSKEYS.LIST);
        if (cancelled) return;
        markPasskeyPromptDone(user._id);
        if (res.data.passkeys.length === 0) setVisible(true);
      } catch {
        /* no prompt */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?._id]);

  if (!visible) return null;

  const setUp = async () => {
    setBusy(true);
    setError("");
    const startedAt = Date.now();
    try {
      await addPasskey({ nickname: guessDeviceName() });
      toast.success("Done! Next time, sign in with your fingerprint or screen lock.");
      setVisible(false);
    } catch (err) {
      setError(passkeyErrorMessage(err, { action: "register", elapsedMs: Date.now() - startedAt }));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-x-0 top-20 z-50 flex justify-center px-4 pointer-events-none">
      <div
        role="dialog"
        aria-labelledby="passkey-prompt-title"
        className="pointer-events-auto w-full max-w-md bg-white rounded-3xl border border-gray-100 shadow-2xl p-5"
      >
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-2xl bg-accent-50 flex items-center justify-center flex-shrink-0">
            <Fingerprint className="w-5 h-5 text-accent" />
          </div>
          <div className="flex-1 min-w-0">
            <p id="passkey-prompt-title" className="font-semibold text-gray-900">
              Sign in faster with your fingerprint next time
            </p>
            <p className="text-sm text-gray-500 mt-1">
              Add a passkey and use your fingerprint, face or screen lock instead of typing your password. Your password keeps working.
            </p>
          </div>
          <button type="button" onClick={() => setVisible(false)} className="w-8 h-8 -mt-1 -mr-1 rounded-xl flex items-center justify-center text-gray-400 hover:bg-gray-100" aria-label="Dismiss">
            <X className="w-4 h-4" />
          </button>
        </div>
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-700 bg-red-50 border border-red-100 rounded-2xl px-4 py-2.5">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2 mt-4">
          <Link to={profilePath} onClick={() => setVisible(false)} className="px-3 py-2 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100">
            Manage in profile
          </Link>
          <button type="button" onClick={() => setVisible(false)} className="px-3 py-2 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100">
            Not now
          </button>
          <button
            type="button"
            onClick={setUp}
            disabled={busy}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-accent text-white hover:bg-accent-hover disabled:opacity-60"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            {busy ? "Follow the prompt…" : "Set up"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PasskeyPrompt;
