import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { BookOpenText, ChevronDown, Loader2, RefreshCw, Sparkles, Square, AlertTriangle } from "lucide-react";
import axiosInstance from "../../utils/axiosInstance";
import { API_PATHS } from "../../utils/apiPaths";
import getErrorMessage from "../../utils/getErrorMessage";
import Button from "../ui/Button";
import Modal from "../ui/Modal";

// Mirrors backend/models/Book.js's CHAPTER_SUMMARY_MAX_LENGTH (no shared
// code between the apps; keep the two in sync by hand).
const CHAPTER_SUMMARY_MAX_LENGTH = 1200;

// Same fingerprint as backend/utils/chapterHash.js (sha256 of
// "title\n\ncontent"), to flag summaries drafted from an older version of
// the chapter. Needs a secure context (https or localhost), which the
// editor always is; without it the flag just doesn't show.
const chapterSourceHash = async (chapter) => {
  if (!window.crypto?.subtle) return null;
  const data = new TextEncoder().encode(`${chapter.title || ""}\n\n${chapter.content || ""}`);
  const digest = await window.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
};

const hasText = (chapter) => Boolean(String(chapter.content || "").trim());

// "Chapter recap" summaries, shown to readers at the top of each chapter in
// the gated reader. AI output only ever arrives as an unreviewed draft
// (onSummaryDraft pauses autosave in EditorPage until the admin clicks
// Save). "Generate for all" asks for one chapter at a time and skips
// chapters that already have a summary, so after a quota stop, running it
// again continues where it left off. A summary the admin has edited is
// never replaced without asking.
const ChapterSummariesPanel = ({ book, pendingSummaryIds = [], onSummaryDraft, onSummaryEdit }) => {
  const chapters = book.chapters || [];
  const [isOpen, setIsOpen] = useState(false);
  const [busyChapterId, setBusyChapterId] = useState(null);
  const [run, setRun] = useState(null); // { done, total } while "Generate for all" runs
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [currentHashes, setCurrentHashes] = useState({});
  const stopRef = useRef(false);

  // Current fingerprints, for the "chapter changed" flag. Recomputed when
  // chapter text changes (cheap: a few hundred KB of hashing at most).
  const sourceKey = chapters.map((c) => `${c._id}\u0000${c.title}\u0000${c.content}`).join("\u0001");
  useEffect(() => {
    let cancelled = false;
    Promise.all(chapters.map(async (c) => [c._id, c._id ? await chapterSourceHash(c) : null]))
      .then((pairs) => !cancelled && setCurrentHashes(Object.fromEntries(pairs)))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey]);

  const withSummary = chapters.filter((c) => String(c.summary || "").trim()).length;
  const missing = chapters.filter((c) => c._id && hasText(c) && !String(c.summary || "").trim());

  // One request. Returns "ok" | "quota" | "error".
  const draftOne = async (chapter) => {
    try {
      const res = await axiosInstance.post(API_PATHS.AI.CHAPTER_SUMMARY, {
        bookId: book._id,
        chapterId: chapter._id,
      });
      onSummaryDraft(chapter._id, res.data.summary, res.data.sourceHash);
      return "ok";
    } catch (error) {
      if (error.response?.status === 429) {
        toast.error(getErrorMessage(error, "Gemini's limit was reached. Try again later."), { duration: 8000 });
        return "quota";
      }
      toast.error(getErrorMessage(error, `Couldn't summarise "${chapter.title}".`));
      return "error";
    }
  };

  const generateOne = async (chapter) => {
    setBusyChapterId(chapter._id);
    const result = await draftOne(chapter);
    setBusyChapterId(null);
    if (result === "ok") toast.success("Summary drafted. Review it, then click Save.");
  };

  const requestRegenerate = (chapter) => {
    if (chapter.summaryEdited && String(chapter.summary || "").trim()) setConfirmTarget(chapter);
    else generateOne(chapter);
  };

  const generateAll = async () => {
    const targets = missing;
    if (!targets.length) return;
    setIsOpen(true);
    stopRef.current = false;
    setRun({ done: 0, total: targets.length });
    let done = 0;
    let failed = 0;
    let stoppedForQuota = false;
    for (const chapter of targets) {
      if (stopRef.current) break;
      setBusyChapterId(chapter._id);
      const result = await draftOne(chapter);
      if (result === "quota") {
        stoppedForQuota = true;
        break;
      }
      if (result === "ok") done += 1;
      else failed += 1;
      setRun({ done: done + failed, total: targets.length });
    }
    setBusyChapterId(null);
    setRun(null);
    if (done) {
      toast.success(
        `${done} summar${done === 1 ? "y" : "ies"} drafted${stoppedForQuota || stopRef.current ? " (stopped early; run it again to continue)" : ""}. Review them, then click Save.`,
        { duration: 6000 }
      );
    } else if (!stoppedForQuota && failed === 0) {
      toast("Stopped.");
    }
  };

  return (
    <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-8">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <BookOpenText className="w-5 h-5 text-gray-400" />
            Chapter summaries
          </h3>
          <p className="text-sm text-gray-500 mt-1 max-w-xl">
            A short "Chapter recap" readers see at the top of each chapter (only readers with access).{" "}
            {withSummary} of {chapters.length} chapters have one.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {run ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => (stopRef.current = true)}
              className="flex items-center gap-1.5"
            >
              <Square className="w-3.5 h-3.5" />
              Stop ({run.done} of {run.total})
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={generateAll}
              disabled={missing.length === 0 || busyChapterId !== null}
              className="flex items-center gap-1.5"
              title="Drafts a summary for every chapter that doesn't have one, one at a time"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Generate for all{missing.length ? ` (${missing.length})` : ""}
            </Button>
          )}
          <button
            type="button"
            onClick={() => setIsOpen((open) => !open)}
            className="p-2 rounded-xl text-gray-500 hover:bg-gray-100"
            aria-expanded={isOpen}
            title={isOpen ? "Hide chapters" : "Show chapters"}
          >
            <ChevronDown className={`w-5 h-5 transition-transform ${isOpen ? "rotate-180" : ""}`} />
            <span className="sr-only">{isOpen ? "Hide chapters" : "Show chapters"}</span>
          </button>
        </div>
      </div>

      {pendingSummaryIds.length > 0 && (
        <p
          role="status"
          className="mt-4 flex items-start gap-2 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2"
        >
          <Sparkles className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
          {pendingSummaryIds.length} AI-drafted summar{pendingSummaryIds.length === 1 ? "y" : "ies"} to review.
          Click Save when they look right. Autosave is paused for the whole book until you do.
        </p>
      )}

      {isOpen && (
        <ul className="mt-6 space-y-5">
          {chapters.map((chapter, index) => {
            const summary = chapter.summary || "";
            const isPending = pendingSummaryIds.includes(chapter._id);
            const isBusy = busyChapterId === chapter._id;
            const isStale =
              Boolean(summary.trim()) &&
              Boolean(chapter.summarySourceHash) &&
              Boolean(currentHashes[chapter._id]) &&
              currentHashes[chapter._id] !== chapter.summarySourceHash;
            const cannotGenerate = !chapter._id ? "Save the book first" : !hasText(chapter) ? "No chapter text yet" : "";
            return (
              <li key={chapter._id || `new-${index}`} className="border-t border-gray-100 pt-5 first:border-t-0 first:pt-0">
                <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                  <label htmlFor={`summary-${index}`} className="text-sm font-medium text-gray-800">
                    {index + 1}. {chapter.title || "Untitled"}
                  </label>
                  <Button
                    variant="secondary"
                    onClick={() => (summary.trim() ? requestRegenerate(chapter) : generateOne(chapter))}
                    disabled={Boolean(cannotGenerate) || busyChapterId !== null}
                    title={cannotGenerate || undefined}
                    className="!px-3 !py-1.5 !text-xs flex items-center gap-1.5"
                  >
                    {isBusy ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : summary.trim() ? (
                      <RefreshCw className="w-3.5 h-3.5" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
                    )}
                    {isBusy ? "Generating…" : summary.trim() ? "Regenerate" : "Generate"}
                  </Button>
                </div>
                <textarea
                  id={`summary-${index}`}
                  value={summary}
                  onChange={(e) => chapter._id && onSummaryEdit(chapter._id, e.target.value)}
                  disabled={!chapter._id}
                  maxLength={CHAPTER_SUMMARY_MAX_LENGTH}
                  rows={3}
                  placeholder={chapter._id ? "3-5 sentences on what this chapter covers. No spoilers." : "Save the book first."}
                  className="w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500 resize-y disabled:opacity-60"
                />
                <div className="flex items-start justify-between gap-4 mt-1">
                  <div className="space-y-1">
                    {isPending && <p className="text-xs font-medium text-amber-700">AI draft, not saved yet.</p>}
                    {isStale && (
                      <p className="flex items-center gap-1 text-xs text-amber-700">
                        <AlertTriangle className="w-3 h-3" /> The chapter changed since this summary was drafted.
                      </p>
                    )}
                  </div>
                  <p className="text-xs tabular-nums text-gray-400 flex-shrink-0">
                    {summary.length}/{CHAPTER_SUMMARY_MAX_LENGTH}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Modal isOpen={Boolean(confirmTarget)} onClose={() => setConfirmTarget(null)} title="Replace your edited summary?">
        {confirmTarget && (
          <div className="space-y-6">
            <p className="text-gray-600">
              You edited the summary for "{confirmTarget.title}". A new AI draft will replace it in the editor
              (nothing is saved until you click Save).
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setConfirmTarget(null)}>
                Keep mine
              </Button>
              <Button
                onClick={() => {
                  const chapter = confirmTarget;
                  setConfirmTarget(null);
                  generateOne(chapter);
                }}
              >
                Replace with AI draft
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default ChapterSummariesPanel;
