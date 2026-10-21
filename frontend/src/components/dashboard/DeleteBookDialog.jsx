import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { AlertTriangle, EyeOff, Loader2, Trash2, X } from "lucide-react";
import axiosInstance from "../../utils/axiosInstance";
import { API_PATHS } from "../../utils/apiPaths";
import getErrorMessage from "../../utils/getErrorMessage";
import {
  STEP_BUYERS,
  STEP_TYPE_TITLE,
  STEP_WARNING,
  buyersSummary,
  canDelete,
  currentStep,
  deleteFlowReducer,
  deletePayload,
  deleteSteps,
  initialDeleteState,
} from "../../utils/bookDelete";

// Deleting a book from the dashboard (admin only). Two steps for a draft,
// three for a published book or one readers own (utils/bookDelete.js); the
// server checks the same things again (backend utils/bookDeletion.js).
// Escape, the X and the backdrop always cancel; Enter never confirms in
// the first two steps; focus stays inside the dialog.

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

const btn = "inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed";
const cancelBtn = `${btn} bg-gray-100 text-gray-800 hover:bg-gray-200 focus-visible:ring-gray-400`;
const dangerBtn = `${btn} bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500`;
const safeBtn = `${btn} bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 focus-visible:ring-accent`;

const DeleteBookDialog = ({ book, onClose, onDeleted, onUnpublished }) => {
  const [impact, setImpact] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const reducer = useMemo(() => deleteFlowReducer(impact), [impact]);
  const [state, dispatch] = useReducer(reducer, initialDeleteState);
  const dialogRef = useRef(null);
  const returnFocus = useRef(typeof document !== "undefined" ? document.activeElement : null);

  useEffect(() => {
    let cancelled = false;
    axiosInstance
      .get(API_PATHS.BOOKS.DELETE_IMPACT(book._id))
      .then((res) => !cancelled && setImpact(res.data))
      .catch((err) => !cancelled && setLoadError(getErrorMessage(err, "Couldn't check what this book is used for.")));
    return () => {
      cancelled = true;
    };
  }, [book._id]);

  const step = impact ? currentStep(impact, state) : null;
  const steps = impact ? deleteSteps(impact) : [];

  // Focus: the safe choice first (Cancel), the title field on the last step.
  useEffect(() => {
    const root = dialogRef.current;
    if (!root) return;
    const target = step === STEP_TYPE_TITLE ? root.querySelector("#delete-book-title") : root.querySelector("[data-autofocus]");
    (target || root).focus();
  }, [step, impact, loadError]);

  // Give focus back to whatever opened the dialog.
  useEffect(() => {
    const opener = returnFocus.current;
    return () => opener?.focus?.();
  }, []);

  const close = () => {
    if (busy) return;
    dispatch({ type: "reset" });
    onClose();
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    // Enter never confirms the first two steps (Space or a click does).
    if (e.key === "Enter" && step !== STEP_TYPE_TITLE) {
      e.preventDefault();
      return;
    }
    if (e.key === "Tab") {
      const items = [...dialogRef.current.querySelectorAll(FOCUSABLE)];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const remove = async (e) => {
    e.preventDefault();
    if (!canDelete(impact, state) || busy) return;
    setBusy(true);
    setError("");
    try {
      await axiosInstance.delete(`${API_PATHS.BOOKS.DELETE_BOOK}/${book._id}`, { data: deletePayload(impact, state) });
      onDeleted(book._id);
    } catch (err) {
      setError(getErrorMessage(err, "Couldn't delete the book."));
      setBusy(false);
    }
  };

  const unpublish = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await axiosInstance.post(API_PATHS.BOOKS.UNPUBLISH(book._id), {});
      onUnpublished(res.data);
    } catch (err) {
      setError(getErrorMessage(err, "Couldn't unpublish the book."));
      setBusy(false);
    }
  };

  const stepNumber = impact ? state.step + 1 : 0;
  const isPublished = impact?.status === "published";
  const heading =
    step === STEP_BUYERS ? "Readers will lose this book" : step === STEP_TYPE_TITLE ? "Type the title to delete" : isPublished ? "Delete a published book?" : "Delete this book?";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 sm:p-4">
      <div className="absolute inset-0 bg-black/50" onClick={close} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-book-heading"
        aria-describedby="delete-book-body"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="relative bg-white rounded-3xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5 sm:p-7 focus:outline-none"
        data-testid="delete-book-dialog"
      >
        <button type="button" onClick={close} disabled={busy} aria-label="Cancel and close" className="absolute top-4 right-4 w-10 h-10 rounded-xl flex items-center justify-center text-gray-500 hover:bg-gray-100 hover:text-gray-800">
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-start gap-3 pr-10 mb-4">
          <div className="w-11 h-11 flex-shrink-0 bg-red-50 border border-red-200 rounded-2xl flex items-center justify-center">
            {step === STEP_BUYERS ? <AlertTriangle className="w-6 h-6 text-red-600" aria-hidden="true" /> : <Trash2 className="w-6 h-6 text-red-600" aria-hidden="true" />}
          </div>
          <div>
            {impact && (
              <p className="text-xs font-semibold uppercase tracking-wide text-red-700">
                Step {stepNumber} of {steps.length}
              </p>
            )}
            <h2 id="delete-book-heading" className="text-xl font-bold text-gray-900">
              {impact ? heading : "Delete this book?"}
            </h2>
          </div>
        </div>

        <div id="delete-book-body" className="text-sm text-gray-700 space-y-3">
          {!impact && !loadError && (
            <p className="flex items-center gap-2 text-gray-600">
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Checking what this book is used for…
            </p>
          )}
          {loadError && <p role="alert" className="text-red-700">{loadError}</p>}

          {step === STEP_WARNING && (
            <>
              <dl className="rounded-2xl border border-gray-200 bg-gray-50 p-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <dt className="text-gray-500">Title</dt>
                <dd className="font-semibold text-gray-900 break-words">{impact.title}</dd>
                <dt className="text-gray-500">Author</dt>
                <dd className="text-gray-900 break-words">{impact.author || "—"}</dd>
                <dt className="text-gray-500">Chapters</dt>
                <dd className="text-gray-900">{impact.chapterCount}</dd>
                <dt className="text-gray-500">Status</dt>
                <dd className="text-gray-900">{isPublished ? "Published (in the store)" : "Draft"}</dd>
              </dl>
              {steps.includes(STEP_BUYERS) && (
                <ul className="rounded-2xl border border-red-200 bg-red-50 p-4 space-y-1 text-red-900 list-disc pl-8">
                  <li>{buyersSummary(impact)}.</li>
                  {impact.bundles.length > 0 ? (
                    <li>
                      In {impact.bundles.length === 1 ? "a bundle" : `${impact.bundles.length} bundles`}: {impact.bundles.map((b) => b.title).join(", ")}.
                    </li>
                  ) : (
                    <li>Not in any bundle.</li>
                  )}
                  {isPublished && <li>It will disappear from the store, and its share link will stop working.</li>}
                </ul>
              )}
              <p className="font-semibold text-gray-900">This cannot be undone. The book, its chapters, translations, audiobook files and readers' highlights are deleted.</p>
            </>
          )}

          {step === STEP_BUYERS && (
            <>
              <p>
                <strong>{buyersSummary(impact)}.</strong> Deleting the book removes it from {impact.buyers.total === 1 ? "that reader's" : "their"} Library: they can no longer read it, listen to it or see their notes and highlights in it.
              </p>
              {impact.bundles.length > 0 && <p>It will also be missing from {impact.bundles.map((b) => `“${b.title}”`).join(", ")}.</p>}
              <p className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                <strong>Only want it off the storefront?</strong> Unpublish it instead: it leaves the store at once, and readers who bought it keep it in their Library.
                {!isPublished && " (This book is already unpublished.)"}
              </p>
            </>
          )}

          {step === STEP_TYPE_TITLE && (
            <form id="delete-book-form" onSubmit={remove} className="space-y-3">
              <label htmlFor="delete-book-title" className="block">
                Type <strong className="break-words">{impact.title}</strong> to confirm.
              </label>
              <input
                id="delete-book-title"
                value={state.typed}
                onChange={(e) => dispatch({ type: "type", value: e.target.value })}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                className="w-full bg-white border border-gray-300 rounded-xl px-3 py-3 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500"
                aria-describedby="delete-book-backup"
              />
              <p id="delete-book-backup" className="text-xs text-gray-600">
                There is no undo: a database backup is the only way to get it back. Tip: run <code className="px-1 py-0.5 rounded bg-gray-100">npm run backup</code> in <code className="px-1 py-0.5 rounded bg-gray-100">backend/</code> first.
              </p>
            </form>
          )}

          {error && (
            <p role="alert" className="text-red-700 font-medium">
              {error}
            </p>
          )}
        </div>

        <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3">
          <button type="button" className={cancelBtn} onClick={close} disabled={busy} data-autofocus>
            Cancel
          </button>
          {step === STEP_WARNING && (
            <button type="button" className={dangerBtn} onClick={() => dispatch({ type: "continue" })}>
              Continue
            </button>
          )}
          {step === STEP_BUYERS && (
            <>
              {isPublished && (
                <button type="button" className={safeBtn} onClick={unpublish} disabled={busy}>
                  <EyeOff className="w-4 h-4" aria-hidden="true" /> Unpublish instead
                </button>
              )}
              <button type="button" className={dangerBtn} onClick={() => dispatch({ type: "continue" })} disabled={busy}>
                Delete anyway
              </button>
            </>
          )}
          {step === STEP_TYPE_TITLE && (
            <button type="submit" form="delete-book-form" className={dangerBtn} disabled={!canDelete(impact, state) || busy} aria-label={`Delete “${impact.title}” permanently`}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Trash2 className="w-4 h-4" aria-hidden="true" />}
              Delete permanently
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default DeleteBookDialog;
