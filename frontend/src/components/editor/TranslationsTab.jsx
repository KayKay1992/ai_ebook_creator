import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import MDEditor from "@uiw/react-md-editor";
import {
  Languages,
  Loader2,
  Sparkles,
  RefreshCw,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Pencil,
  Eye,
  EyeOff,
  BadgeCheck,
  Info,
  X,
} from "lucide-react";
import axiosInstance from "../../utils/axiosInstance";
import { API_PATHS } from "../../utils/apiPaths";
import getErrorMessage from "../../utils/getErrorMessage";
import Button from "../ui/Button";
import Modal from "../ui/Modal";
import MarkdownContent from "../shared/MarkdownContent";

// Admin side of AI translation. Talks only to /api/books/:id/translations
// (never the editor's book state). Translation runs in the background on
// the server, chapter by chapter (backend/utils/translationJobs.js); this
// tab polls while anything is queued or translating. Each chapter's
// translation is a draft the admin can edit, then marks reviewed, then
// publishes; only published chapters reach readers, and nothing is ever
// published automatically.

const POLL_MS = 3000;
const formatNumber = (n = 0) => n.toLocaleString("en-US");

const badgeBase = "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap";

const JobBadge = ({ chapter }) => {
  switch (chapter.jobStatus) {
    case "queued":
      return (
        <span className={`${badgeBase} bg-gray-100 text-gray-600`}>
          <Clock className="w-3 h-3" /> Queued
        </span>
      );
    case "translating":
      return (
        <span className={`${badgeBase} bg-blue-50 text-blue-700`}>
          <Loader2 className="w-3 h-3 animate-spin" /> Translating
          {chapter.chunksTotal ? ` ${chapter.chunksDone} of ${chapter.chunksTotal}` : ""}
        </span>
      );
    case "waiting":
      return (
        <span className={`${badgeBase} bg-amber-50 text-amber-700`} title="Stopped by Gemini's daily limit">
          <Clock className="w-3 h-3" /> Waiting for quota
        </span>
      );
    case "failed":
      return (
        <span className={`${badgeBase} bg-red-50 text-red-700`}>
          <AlertTriangle className="w-3 h-3" /> Failed
        </span>
      );
    default:
      return null;
  }
};

const ReviewBadge = ({ chapter }) => {
  if (!chapter.hasDraft) {
    return <span className={`${badgeBase} bg-gray-50 text-gray-400`}>{chapter.hasText ? "Not translated" : "No text"}</span>;
  }
  if (chapter.reviewStatus === "published") {
    return (
      <span className={`${badgeBase} bg-emerald-50 text-emerald-700`}>
        <CheckCircle2 className="w-3 h-3" /> Published
      </span>
    );
  }
  if (chapter.reviewStatus === "reviewed") {
    return (
      <span className={`${badgeBase} bg-sky-50 text-sky-700`}>
        <BadgeCheck className="w-3 h-3" /> Reviewed
      </span>
    );
  }
  return <span className={`${badgeBase} bg-violet-50 text-violet-700`}>Draft</span>;
};

// Full-screen editor for one chapter's draft: the original on the left
// (read-only), the translation on the right.
const TranslationEditor = ({ bookId, language, chapterId, onClose, onSaved }) => {
  const [data, setData] = useState(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let cancelled = false;
    axiosInstance
      .get(API_PATHS.BOOKS.TRANSLATION_CHAPTER(bookId, language.code, chapterId))
      .then((res) => {
        if (cancelled) return;
        setData(res.data);
        setTitle(res.data.draft.title || "");
        setContent(res.data.draft.content || "");
      })
      .catch((error) => !cancelled && setLoadError(getErrorMessage(error, "Couldn't load the translation.")));
    return () => {
      cancelled = true;
    };
  }, [bookId, language.code, chapterId]);

  const isDirty = data && (title !== (data.draft.title || "") || content !== (data.draft.content || ""));

  const save = async ({ andReview = false } = {}) => {
    setIsSaving(true);
    try {
      let status;
      if (isDirty || !data.hasDraft) {
        const res = await axiosInstance.put(API_PATHS.BOOKS.TRANSLATION_CHAPTER(bookId, language.code, chapterId), {
          title,
          content,
        });
        status = res.data;
      }
      if (andReview) {
        const res = await axiosInstance.post(API_PATHS.BOOKS.TRANSLATION_ACTION(bookId, language.code, chapterId, "review"));
        status = res.data;
      }
      if (status) onSaved(status);
      toast.success(andReview ? "Saved and marked reviewed. Publish it when you're ready." : "Translation draft saved.");
      onClose();
    } catch (error) {
      toast.error(getErrorMessage(error, "Couldn't save the translation."));
    } finally {
      setIsSaving(false);
    }
  };

  const requestClose = () => {
    if (isDirty && !window.confirm("Discard your unsaved changes to this translation?")) return;
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col" role="dialog" aria-modal="true">
      <div className="flex items-center justify-between gap-4 px-4 lg:px-8 py-3 border-b border-gray-100">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-accent">{language.name} translation</p>
          <p className="font-semibold text-gray-900 truncate">{data?.source.title || "Loading…"}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => save()} loading={isSaving} disabled={!data || (!isDirty && data.hasDraft)}>
            Save draft
          </Button>
          <Button
            size="sm"
            onClick={() => save({ andReview: true })}
            loading={isSaving}
            disabled={!data || (!isDirty && data.reviewStatus !== "draft") || !(title.trim() || content.trim())}
            title="Save and mark this chapter reviewed (it still isn't published)"
          >
            Save &amp; mark reviewed
          </Button>
          <button type="button" onClick={requestClose} className="p-2 rounded-xl text-gray-500 hover:bg-gray-100" title="Close">
            <X className="w-5 h-5" />
            <span className="sr-only">Close</span>
          </button>
        </div>
      </div>

      {loadError ? (
        <p className="p-8 text-red-600">{loadError}</p>
      ) : !data ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : (
        <div className="flex-1 min-h-0 grid lg:grid-cols-2">
          <div className="hidden lg:block overflow-y-auto border-r border-gray-100 p-6 bg-gray-50">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Original</p>
            <h2 className="font-serif text-2xl font-bold text-gray-900 mb-6">{data.source.title}</h2>
            <MarkdownContent content={data.source.content} className="font-serif text-gray-700 leading-relaxed" />
          </div>
          <div className="overflow-y-auto p-4 lg:p-6 space-y-4" data-color-mode="light">
            {data.isStale && (
              <p className="flex items-start gap-2 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
                The original chapter changed after this was translated. Update the translation or translate it again.
              </p>
            )}
            {data.warnings?.length > 0 && (
              <ul className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 space-y-1">
                {data.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
            <div>
              <label htmlFor="translation-title" className="text-sm font-medium text-gray-700">
                Chapter title ({language.name})
              </label>
              <input
                id="translation-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="mt-1 w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-2.5 text-gray-900 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
              />
            </div>
            <MDEditor value={content} onChange={(value) => setContent(value || "")} height={560} preview="edit" />
            {data.isPublished && (
              <p className="text-xs text-gray-500">
                Readers keep seeing the published version until you publish this one.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const TranslationsTab = ({ bookId, hasUnsavedChanges = false }) => {
  const [overview, setOverview] = useState(null);
  const [languageCode, setLanguageCode] = useState("");
  const [status, setStatus] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [busyKey, setBusyKey] = useState(null); // chapterId:action while a request runs
  const [plan, setPlan] = useState(null); // dry run awaiting confirmation
  const [replaceTarget, setReplaceTarget] = useState(null); // edited chapter to re-translate
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [editingChapterId, setEditingChapterId] = useState(null);
  const [pollTick, setPollTick] = useState(0);
  const pollTimerRef = useRef(null);

  const language = overview?.languages.find((l) => l.code === languageCode) || null;

  const loadOverview = useCallback(
    () =>
      axiosInstance
        .get(API_PATHS.BOOKS.TRANSLATIONS(bookId))
        .then((res) => {
          setOverview(res.data);
          setLanguageCode((current) => current || res.data.languages[0]?.code || "");
        })
        .catch((error) => setLoadError(getErrorMessage(error, "Couldn't load translations."))),
    [bookId]
  );

  const fetchStatus = useCallback(
    () =>
      languageCode
        ? axiosInstance
            .get(API_PATHS.BOOKS.TRANSLATION_STATUS(bookId, languageCode))
            .then((res) => {
              setStatus(res.data);
              setLoadError("");
            })
            .catch((error) => setLoadError(getErrorMessage(error, "Couldn't load translation status.")))
            .finally(() => setPollTick((tick) => tick + 1))
        : Promise.resolve(),
    [bookId, languageCode]
  );

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const selectLanguage = (code) => {
    if (code === languageCode) return;
    setStatus(null); // show the loader, not the previous language's table
    setLanguageCode(code);
  };

  // Poll while the server is working on this language.
  useEffect(() => {
    if (!status?.isWorking) return undefined;
    pollTimerRef.current = setTimeout(fetchStatus, POLL_MS);
    return () => clearTimeout(pollTimerRef.current);
  }, [status?.isWorking, pollTick, fetchStatus]);

  // Status changes also refresh the per-language counts in the picker.
  const applyStatus = (next) => {
    setStatus(next);
    loadOverview();
  };

  const run = async (key, request, successMessage) => {
    setBusyKey(key);
    try {
      const res = await request();
      applyStatus(res.data.status || res.data);
      if (successMessage) toast.success(successMessage);
      return res;
    } catch (error) {
      toast.error(getErrorMessage(error, "Something went wrong."));
      fetchStatus();
      return null;
    } finally {
      setBusyKey(null);
    }
  };

  const requestPlan = async (chapterId) => {
    setBusyKey(`${chapterId}:plan`);
    try {
      const res = await axiosInstance.post(API_PATHS.BOOKS.TRANSLATION_QUEUE(bookId, languageCode), {
        chapterId,
        dryRun: true,
      });
      if (!res.data.chapters.length) {
        toast("Nothing to translate: every chapter has a translation, is in progress, or has no text.");
        return;
      }
      setPlan({ ...res.data, chapterId });
    } catch (error) {
      toast.error(getErrorMessage(error, "Couldn't prepare the translation."));
    } finally {
      setBusyKey(null);
    }
  };

  const queue = async (chapterId, { replaceEdits = false } = {}) => {
    setBusyKey(`${chapterId}:queue`);
    try {
      const res = await axiosInstance.post(API_PATHS.BOOKS.TRANSLATION_QUEUE(bookId, languageCode), {
        chapterId,
        replaceEdits,
      });
      applyStatus(res.data.status);
      const count = res.data.chapters.length;
      toast.success(`Translation queued for ${count} chapter${count === 1 ? "" : "s"}. This page updates as it goes.`);
      setPlan(null);
      setReplaceTarget(null);
    } catch (error) {
      if (error.response?.status === 409 && error.response.data?.code === "edited") {
        setPlan(null);
        setReplaceTarget(status.chapters.find((c) => c.chapterId === chapterId) || { chapterId });
      } else {
        toast.error(getErrorMessage(error, "Couldn't start the translation."));
        fetchStatus();
      }
    } finally {
      setBusyKey(null);
    }
  };

  if (!overview || (languageCode && !status)) {
    return loadError ? (
      <div className="bg-white rounded-3xl border border-red-100 p-8 text-center">
        <p className="text-red-600 mb-4">{loadError}</p>
        <Button variant="secondary" onClick={() => (overview ? fetchStatus() : loadOverview())}>
          Try again
        </Button>
      </div>
    ) : (
      <div className="flex justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  const missingCount = status.chapters.filter(
    (c) => c.hasText && !c.hasDraft && !["queued", "translating"].includes(c.jobStatus)
  ).length;
  const reviewedCount = status.counts.reviewed;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 lg:p-8">
        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <Languages className="w-5 h-5 text-accent" />
          Translations
        </h2>
        <p className="text-sm text-gray-500 mt-1 max-w-2xl">
          AI translation per chapter. Each translation is a draft: edit it, mark it reviewed, then publish it.
          Readers who own the book see only published chapters, with an "AI-translated" label. Audio narration
          stays in the original language.
        </p>

        <div className="mt-5 flex flex-wrap gap-2" role="tablist" aria-label="Language">
          {overview.languages.map((l) => (
            <button
              key={l.code}
              type="button"
              role="tab"
              aria-selected={l.code === languageCode}
              onClick={() => selectLanguage(l.code)}
              className={`px-4 py-2 rounded-2xl text-sm font-medium border transition-colors ${
                l.code === languageCode
                  ? "bg-accent-50 border-accent-200 text-accent-hover"
                  : "bg-white border-gray-200 text-gray-600 hover:border-gray-300"
              }`}
            >
              {l.name}
              <span className="ml-2 text-xs text-gray-400">
                {l.isWorking ? "working…" : `${l.published}/${l.chapters} published`}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-6 pt-6 border-t border-gray-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <p className="text-xs text-gray-500">
            {language?.nativeName && language.nativeName !== language.name ? `${language.nativeName} · ` : ""}
            {status.counts.drafted} of {status.counts.chapters} translated · {status.counts.published} published · Model{" "}
            {status.model}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() =>
                run(
                  "all:publish",
                  () => axiosInstance.post(API_PATHS.BOOKS.TRANSLATION_PUBLISH_REVIEWED(bookId, languageCode)),
                  "Reviewed chapters published."
                )
              }
              loading={busyKey === "all:publish"}
              disabled={reviewedCount === 0 || busyKey !== null}
              className="flex items-center gap-2"
            >
              <Eye className="w-4 h-4" />
              Publish reviewed{reviewedCount ? ` (${reviewedCount})` : ""}
            </Button>
            <Button
              onClick={() => requestPlan("all-missing")}
              loading={busyKey === "all-missing:plan"}
              disabled={missingCount === 0 || busyKey !== null}
              className="flex items-center gap-2"
            >
              <Sparkles className="w-4 h-4" />
              Translate all missing{missingCount ? ` (${missingCount})` : ""}
            </Button>
          </div>
        </div>

        <p className="mt-4 flex items-start gap-2 text-xs text-gray-500">
          <Info className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
          Runs in the background, one chapter at a time, and continues where it stopped if it's interrupted.
          If Gemini's daily limit is reached, chapters show "Waiting for quota": translate again after the reset.
          Names of people, brands and places, numbers and ₦ amounts are kept as written; chapters with a
          changed number are flagged for you to check.
        </p>
        {hasUnsavedChanges && (
          <p className="mt-4 flex items-start gap-2 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            <Info className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
            You have unsaved edits. Translation uses the last saved text, so save first if you want them included.
          </p>
        )}
      </div>

      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-5 py-3">Chapter</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {status.chapters.map((chapter) => {
                const inProgress = ["queued", "translating"].includes(chapter.jobStatus);
                const canContinue = ["failed", "waiting"].includes(chapter.jobStatus) && chapter.chunksDone > 0;
                const key = (action) => `${chapter.chapterId}:${action}`;
                const disabled = inProgress || busyKey !== null;
                return (
                  <tr key={chapter.chapterId} className="align-top">
                    <td className="px-5 py-4">
                      <p className="font-medium text-gray-900">
                        {chapter.index + 1}. {chapter.title || "Untitled"}
                      </p>
                      {chapter.draftTitle && <p className="text-xs text-gray-500 mt-0.5">{chapter.draftTitle}</p>}
                      <p className="text-xs text-gray-400 mt-0.5">
                        {chapter.hasText ? `${formatNumber(chapter.sourceChars)} characters` : "No text yet"}
                      </p>
                      {chapter.error && (
                        <p className={`text-xs mt-1 ${chapter.jobStatus === "waiting" ? "text-amber-700" : "text-red-600"}`}>
                          {chapter.error}
                        </p>
                      )}
                      {chapter.warnings.length > 0 && (
                        <p className="text-xs mt-1 text-amber-700">
                          {chapter.warnings.length} thing{chapter.warnings.length === 1 ? "" : "s"} to check (open Edit).
                        </p>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-col items-start gap-1.5">
                        <JobBadge chapter={chapter} />
                        <ReviewBadge chapter={chapter} />
                        {chapter.hasUnpublishedChanges && (
                          <span className="text-xs text-gray-500">Changes not published yet</span>
                        )}
                        {(chapter.isStale || chapter.isPublishedStale) && (
                          <span
                            className={`${badgeBase} bg-amber-50 text-amber-700`}
                            title="The original chapter changed after this was translated."
                          >
                            <AlertTriangle className="w-3 h-3" /> Out of date
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex justify-end flex-wrap gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => (chapter.hasDraft ? queue(chapter.chapterId) : requestPlan(chapter.chapterId))}
                          loading={busyKey === key("plan") || busyKey === key("queue")}
                          disabled={!chapter.hasText || disabled}
                          className="flex items-center gap-1.5 whitespace-nowrap"
                        >
                          {chapter.hasDraft || canContinue ? <RefreshCw className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
                          {canContinue ? "Continue" : chapter.hasDraft ? "Translate again" : "Translate"}
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setEditingChapterId(chapter.chapterId)}
                          disabled={disabled}
                          className="flex items-center gap-1.5"
                          title={chapter.hasDraft ? "Edit the translation" : "Write the translation yourself"}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          Edit
                        </Button>
                        {chapter.reviewStatus === "draft" && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() =>
                              run(
                                key("review"),
                                () => axiosInstance.post(API_PATHS.BOOKS.TRANSLATION_ACTION(bookId, languageCode, chapter.chapterId, "review")),
                                "Marked reviewed."
                              )
                            }
                            loading={busyKey === key("review")}
                            disabled={disabled}
                            className="flex items-center gap-1.5 whitespace-nowrap"
                          >
                            <BadgeCheck className="w-3.5 h-3.5" />
                            Mark reviewed
                          </Button>
                        )}
                        {chapter.reviewStatus === "reviewed" && (
                          <Button
                            size="sm"
                            onClick={() =>
                              run(
                                key("publish"),
                                () => axiosInstance.post(API_PATHS.BOOKS.TRANSLATION_ACTION(bookId, languageCode, chapter.chapterId, "publish")),
                                "Published. Readers with access can now read this chapter in " + (language?.name || "this language") + "."
                              )
                            }
                            loading={busyKey === key("publish")}
                            disabled={disabled}
                            className="flex items-center gap-1.5"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            Publish
                          </Button>
                        )}
                        {chapter.isPublished && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() =>
                              run(
                                key("unpublish"),
                                () => axiosInstance.post(API_PATHS.BOOKS.TRANSLATION_ACTION(bookId, languageCode, chapter.chapterId, "unpublish")),
                                "Unpublished. Readers see the original for this chapter."
                              )
                            }
                            loading={busyKey === key("unpublish")}
                            disabled={disabled}
                            className="flex items-center gap-1.5"
                          >
                            <EyeOff className="w-3.5 h-3.5" />
                            Unpublish
                          </Button>
                        )}
                        {(chapter.hasDraft || chapter.jobStatus !== "none") && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setDeleteTarget(chapter)}
                            disabled={chapter.jobStatus === "translating" || busyKey !== null}
                            className="flex items-center gap-1.5 text-red-600"
                            title={chapter.jobStatus === "queued" ? "Cancel" : "Delete translation"}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span className="sr-only">{chapter.jobStatus === "queued" ? "Cancel" : "Delete"}</span>
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {status.orphaned.length > 0 && (
        <div className="bg-white rounded-3xl border border-amber-100 shadow-sm p-6">
          <h3 className="font-semibold text-gray-900">Translations of removed chapters</h3>
          <p className="text-sm text-gray-500 mt-1">
            These chapters were deleted from the book. Their translations are never shown to readers.
          </p>
          <ul className="mt-4 divide-y divide-gray-100">
            {status.orphaned.map((entry) => (
              <li key={entry.chapterId} className="flex items-center justify-between py-3 text-sm">
                <span className="text-gray-600">{entry.draftTitle || entry.chapterId}</span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setDeleteTarget({ ...entry, title: "a removed chapter" })}
                  disabled={entry.jobStatus === "translating"}
                  className="flex items-center gap-1.5 text-red-600"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Modal
        isOpen={Boolean(plan)}
        onClose={() => busyKey === null && setPlan(null)}
        title={`Translate into ${language?.name || ""}?`}
      >
        {plan && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gray-50 rounded-2xl p-4">
                <p className="text-xs text-gray-500">Chapters</p>
                <p className="text-lg font-bold text-gray-900">{plan.chapters.length}</p>
              </div>
              <div className="bg-gray-50 rounded-2xl p-4">
                <p className="text-xs text-gray-500">Gemini requests (about)</p>
                <p className="text-lg font-bold text-gray-900">{formatNumber(plan.totalRequests)}</p>
              </div>
            </div>
            <ul className="text-sm text-gray-600 space-y-1 max-h-48 overflow-y-auto">
              {plan.chapters.map((c) => (
                <li key={c.chapterId} className="flex justify-between gap-4">
                  <span className="truncate">{c.title}</span>
                  <span className="text-gray-400 whitespace-nowrap">{formatNumber(c.chars)} chars</span>
                </li>
              ))}
            </ul>
            <p className="text-sm text-gray-500">
              {formatNumber(plan.totalChars)} characters. Translations arrive as drafts; nothing is published
              until you review and publish each chapter.
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setPlan(null)} disabled={busyKey !== null}>
                Cancel
              </Button>
              <Button onClick={() => queue(plan.chapterId)} loading={busyKey === `${plan.chapterId}:queue`}>
                Translate
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal isOpen={Boolean(replaceTarget)} onClose={() => setReplaceTarget(null)} title="Replace your edits?">
        {replaceTarget && (
          <div className="space-y-6">
            <p className="text-gray-600">
              You edited the {language?.name} translation of "{replaceTarget.title}". Translating again replaces your
              edits in the draft. The published version (if any) stays live until you publish again.
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setReplaceTarget(null)}>
                Keep my edits
              </Button>
              <Button
                onClick={() => queue(replaceTarget.chapterId, { replaceEdits: true })}
                loading={busyKey === `${replaceTarget.chapterId}:queue`}
              >
                Translate again
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={Boolean(deleteTarget)}
        onClose={() => busyKey === null && setDeleteTarget(null)}
        title={deleteTarget?.jobStatus === "queued" ? "Cancel translation?" : "Delete translation?"}
      >
        {deleteTarget && (
          <div className="space-y-6">
            <p className="text-gray-600">
              The {language?.name} translation of "{deleteTarget.title}" (draft and published copy) will be deleted.
              Readers will see the original for this chapter.
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setDeleteTarget(null)} disabled={busyKey !== null}>
                Keep it
              </Button>
              <Button
                variant="danger"
                loading={busyKey === `${deleteTarget.chapterId}:delete`}
                onClick={async () => {
                  const res = await run(
                    `${deleteTarget.chapterId}:delete`,
                    () => axiosInstance.delete(API_PATHS.BOOKS.TRANSLATION_CHAPTER(bookId, languageCode, deleteTarget.chapterId)),
                    "Translation deleted."
                  );
                  if (res) setDeleteTarget(null);
                }}
              >
                Delete
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {editingChapterId && language && (
        <TranslationEditor
          bookId={bookId}
          language={language}
          chapterId={editingChapterId}
          onClose={() => setEditingChapterId(null)}
          onSaved={applyStatus}
        />
      )}
    </div>
  );
};

export default TranslationsTab;
