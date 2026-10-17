import { useCallback, useEffect, useState } from "react";
import { Fingerprint, Loader2, Pencil, Trash2, Check, X, Plus, KeyRound } from "lucide-react";
import toast from "react-hot-toast";
import axiosInstance from "../../utils/axiosInstance";
import { API_PATHS } from "../../utils/apiPaths";
import getErrorMessage from "../../utils/getErrorMessage";
import { addPasskey, passkeyErrorCode, passkeyErrorMessage } from "../../utils/passkeyClient";
import { guessDeviceName, isPasskeySupported } from "../../utils/passkeySupport";

// "Fingerprint & passkeys" on the reader profile (/kenlibs/profile) and the
// admin profile (/profile). Lazy-loaded by both pages. Add a passkey on this
// device (asks for the password if the sign-in is over 10 minutes old),
// list, rename and remove passkeys. Removing passkeys never affects the
// password.

const formatDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" }) : "Never";

const PasskeyRow = ({ passkey, onRenamed, onRemoved }) => {
  const [mode, setMode] = useState("view"); // view | rename | remove
  const [name, setName] = useState(passkey.nickname);
  const [busy, setBusy] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await axiosInstance.put(API_PATHS.PASSKEYS.ONE(passkey._id), { nickname: name });
      onRenamed(res.data.passkey);
      setMode("view");
    } catch (error) {
      toast.error(getErrorMessage(error, "Couldn't rename the passkey."));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await axiosInstance.delete(API_PATHS.PASSKEYS.ONE(passkey._id));
      onRemoved(passkey._id);
      toast.success("Passkey removed. Your password still works.");
    } catch (error) {
      toast.error(getErrorMessage(error, "Couldn't remove the passkey."));
      setBusy(false);
    }
  };

  return (
    <li className="py-3.5">
      {mode === "rename" ? (
        <form onSubmit={save} className="flex items-center gap-2">
          <label htmlFor={`passkey-name-${passkey._id}`} className="sr-only">
            Passkey name
          </label>
          <input
            id={`passkey-name-${passkey._id}`}
            value={name}
            maxLength={60}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            className="flex-1 min-w-0 bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm"
          />
          <button type="submit" disabled={busy || !name.trim()} className="w-9 h-9 rounded-xl flex items-center justify-center text-emerald-700 hover:bg-emerald-50 disabled:opacity-50" aria-label="Save name">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          </button>
          <button type="button" onClick={() => { setName(passkey.nickname); setMode("view"); }} className="w-9 h-9 rounded-xl flex items-center justify-center text-gray-500 hover:bg-gray-100" aria-label="Cancel renaming">
            <X className="w-4 h-4" />
          </button>
        </form>
      ) : (
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-accent-50 flex items-center justify-center flex-shrink-0">
              <KeyRound className="w-4 h-4 text-accent" />
            </div>
            <div className="min-w-0">
              <p className="font-medium text-gray-900 truncate">{passkey.nickname}</p>
              <p className="text-xs text-gray-500">
                Added {formatDate(passkey.createdAt)} · Last used {formatDate(passkey.lastUsedAt)}
              </p>
            </div>
          </div>
          {mode === "remove" ? (
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <span className="text-xs text-gray-600 hidden sm:inline">Remove?</span>
              <button type="button" onClick={remove} disabled={busy} className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
                {busy ? "Removing…" : "Remove"}
              </button>
              <button type="button" onClick={() => setMode("view")} className="px-3 py-1.5 rounded-xl text-xs font-medium text-gray-600 hover:bg-gray-100">
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1 flex-shrink-0">
              <button type="button" onClick={() => setMode("rename")} className="w-9 h-9 rounded-xl flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-700" aria-label={`Rename ${passkey.nickname}`}>
                <Pencil className="w-4 h-4" />
              </button>
              <button type="button" onClick={() => setMode("remove")} className="w-9 h-9 rounded-xl flex items-center justify-center text-gray-400 hover:bg-red-50 hover:text-red-600" aria-label={`Remove ${passkey.nickname}`}>
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
};

const PasskeysSection = () => {
  const [supported] = useState(isPasskeySupported);
  const [passkeys, setPasskeys] = useState(null);
  const [max, setMax] = useState(5);
  const [nickname, setNickname] = useState(() => guessDeviceName());
  const [password, setPassword] = useState("");
  const [needsPassword, setNeedsPassword] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(
    () =>
      axiosInstance
        .get(API_PATHS.PASSKEYS.LIST)
        .then((res) => {
          setPasskeys(res.data.passkeys);
          setMax(res.data.max);
        })
        .catch((err) => {
          setPasskeys([]);
          setError(getErrorMessage(err, "Couldn't load your passkeys."));
        }),
    []
  );

  useEffect(() => {
    load();
  }, [load]);

  const add = async (e) => {
    e.preventDefault();
    setAdding(true);
    setError("");
    const startedAt = Date.now();
    try {
      const passkey = await addPasskey({ nickname: nickname.trim() || guessDeviceName(), password: needsPassword ? password : undefined });
      setPasskeys((list) => [...(list || []), passkey]);
      setNeedsPassword(false);
      setPassword("");
      toast.success("Passkey added. Next time, sign in with your fingerprint or screen lock.");
    } catch (err) {
      const code = passkeyErrorCode(err, { elapsedMs: Date.now() - startedAt });
      if (code === "password_required" || code === "wrong_password") setNeedsPassword(true);
      setError(passkeyErrorMessage(err, { action: "register", elapsedMs: Date.now() - startedAt }));
    } finally {
      setAdding(false);
    }
  };

  const atLimit = passkeys && passkeys.length >= max;

  return (
    <section aria-labelledby="passkeys-heading" className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-2xl bg-accent-50 flex items-center justify-center flex-shrink-0">
          <Fingerprint className="w-5 h-5 text-accent" />
        </div>
        <div>
          <h2 id="passkeys-heading" className="font-semibold text-gray-900">
            Fingerprint &amp; passkeys
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Sign in with your fingerprint, face or screen lock instead of typing your password. Your password always keeps working.
          </p>
        </div>
      </div>

      {passkeys === null ? (
        <div className="flex justify-center py-6">
          <Loader2 className="w-6 h-6 text-accent animate-spin" />
        </div>
      ) : (
        <>
          {passkeys.length > 0 ? (
            <ul className="divide-y divide-gray-100 border-y border-gray-100 mb-4">
              {passkeys.map((p) => (
                <PasskeyRow
                  key={p._id}
                  passkey={p}
                  onRenamed={(updated) => setPasskeys((list) => list.map((x) => (x._id === updated._id ? updated : x)))}
                  onRemoved={(id) => setPasskeys((list) => list.filter((x) => x._id !== id))}
                />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-500 mb-4">You haven't added a passkey yet.</p>
          )}

          {!supported ? (
            <p className="text-sm text-gray-600 bg-gray-50 rounded-2xl px-4 py-3">
              This browser can't create passkeys. Try Chrome, Safari or Edge on your phone or computer.
            </p>
          ) : atLimit ? (
            <p className="text-sm text-gray-600">You have the maximum of {max} passkeys. Remove one to add another.</p>
          ) : (
            <form onSubmit={add} className="space-y-3">
              <div>
                <label htmlFor="passkey-nickname" className="block text-sm font-medium text-gray-700 mb-1">
                  Name for this passkey
                </label>
                <input
                  id="passkey-nickname"
                  value={nickname}
                  maxLength={60}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="e.g. My Tecno phone"
                  className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-sm"
                />
              </div>
              {needsPassword && (
                <div>
                  <label htmlFor="passkey-password" className="block text-sm font-medium text-gray-700 mb-1">
                    Your password
                  </label>
                  <input
                    id="passkey-password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    autoFocus
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-sm"
                  />
                  <p className="text-xs text-gray-500 mt-1">For your security, confirm your password to add a passkey.</p>
                </div>
              )}
              {error && (
                <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-2xl px-4 py-3">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={adding || (needsPassword && !password)}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-accent text-white text-sm font-semibold hover:bg-accent-hover disabled:opacity-60"
              >
                {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                {adding ? "Follow the prompt on your device…" : "Add a passkey on this device"}
              </button>
            </form>
          )}
        </>
      )}
    </section>
  );
};

export default PasskeysSection;
