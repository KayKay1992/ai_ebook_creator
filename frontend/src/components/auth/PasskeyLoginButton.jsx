import { useState } from "react";
import { Fingerprint, Loader2 } from "lucide-react";
import { isPasskeySupported } from "../../utils/passkeySupport";

// "Sign in with fingerprint / passkey" on the reader and admin login pages.
// Hidden when the browser can't use passkeys. Uses the email field's value
// if one is typed (optional). On success calls onSignedIn(loginData), the
// same data a password login returns, so the page finishes sign-in the
// same way. The WebAuthn code loads only when the button is pressed.
const PasskeyLoginButton = ({ email = "", onSignedIn, disabled = false, className = "" }) => {
  const [supported] = useState(isPasskeySupported);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!supported) return null;

  const start = async () => {
    setBusy(true);
    setError("");
    const startedAt = Date.now();
    try {
      const { signInWithPasskey } = await import("../../utils/passkeyClient");
      const data = await signInWithPasskey({ email: email.trim() });
      await onSignedIn(data);
    } catch (err) {
      const { passkeyErrorMessage } = await import("../../utils/passkeyErrors");
      setError(passkeyErrorMessage(err, { action: "login", elapsedMs: Date.now() - startedAt }));
      setBusy(false);
    }
  };

  return (
    <div className={className}>
      <div className="flex items-center gap-3 my-5" aria-hidden="true">
        <span className="h-px flex-1 bg-gray-200" />
        <span className="text-xs text-gray-400 uppercase tracking-wide">or</span>
        <span className="h-px flex-1 bg-gray-200" />
      </div>
      <button
        type="button"
        onClick={start}
        disabled={busy || disabled}
        className="w-full flex items-center justify-center gap-2 px-3 py-3 rounded-2xl border border-gray-200 bg-white text-gray-800 text-sm sm:text-base font-medium hover:bg-gray-50 hover:border-gray-300 transition-colors disabled:opacity-60 disabled:cursor-wait"
      >
        {busy ? <Loader2 className="w-5 h-5 flex-shrink-0 animate-spin" /> : <Fingerprint className="w-5 h-5 flex-shrink-0 text-accent" />}
        <span>{busy ? "Waiting for your passkey…" : "Sign in with fingerprint / passkey"}</span>
      </button>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700 bg-red-50 border border-red-100 rounded-2xl px-4 py-3">
          {error}
        </p>
      )}
    </div>
  );
};

export default PasskeyLoginButton;
