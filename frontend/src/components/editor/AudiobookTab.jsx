import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  Headphones,
  Play,
  Square,
  Loader2,
  Sparkles,
  RefreshCw,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Info,
  Upload,
  Copy,
  Laptop,
  Server,
} from "lucide-react";
import axiosInstance from "../../utils/axiosInstance";
import { API_PATHS } from "../../utils/apiPaths";
import getErrorMessage from "../../utils/getErrorMessage";
import Button from "../ui/Button";
import Modal from "../ui/Modal";

// Admin side of audiobook mode. Talks only to its own endpoints
// (/api/books/:id/audio...): it never touches the editor's book state or
// autosave. Generation runs in the background on the server; this tab polls
// the status while anything is queued or generating. Every run goes through
// a dry run first, so the admin sees the character count and estimated
// length (and the daily cap) before confirming.
//
// Audio can come from three places, all ending up identical for readers:
// server generation (Gemini, or local Kokoro if the backend runs on the
// admin's PC), backend/scripts/narrate-book.js run locally (free), or an
// uploaded MP3.

const POLL_MS = 3000;
// Mirrors the backend's limit (middleware/uploadMiddleware.js), so an
// oversized file is refused before it's sent.
const UPLOAD_MAX_BYTES = 50 * 1024 * 1024;

const SOURCE_LABELS = { gemini: "Gemini", local: "Local (Kokoro)", uploaded: "Uploaded" };

const formatDuration = (totalSec = 0) => {
  const sec = Math.max(0, Math.round(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
};

const formatBytes = (bytes = 0) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const formatNumber = (n = 0) => n.toLocaleString("en-US");

const StatusBadge = ({ chapter }) => {
  const base = "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap";
  switch (chapter.status) {
    case "queued":
      return (
        <span className={`${base} bg-gray-100 text-gray-600`}>
          <Clock className="w-3 h-3" /> Queued
        </span>
      );
    case "generating":
      return (
        <span className={`${base} bg-blue-50 text-blue-700`}>
          <Loader2 className="w-3 h-3 animate-spin" /> Generating{" "}
          {chapter.chunksTotal
            ? `${chapter.chunksDone} of ${chapter.chunksTotal}`
            : `${Math.round((chapter.progress || 0) * 100)}%`}
        </span>
      );
    case "waiting":
      return (
        <span className={`${base} bg-amber-50 text-amber-700`} title="Stopped by Gemini's daily limit">
          <Clock className="w-3 h-3" /> Waiting for quota
        </span>
      );
    case "ready":
      return chapter.isStale ? (
        <span className={`${base} bg-amber-50 text-amber-700`} title="The chapter text changed after this audio was made.">
          <AlertTriangle className="w-3 h-3" /> Out of date
        </span>
      ) : (
        <span className={`${base} bg-emerald-50 text-emerald-700`}>
          <CheckCircle2 className="w-3 h-3" /> Ready
        </span>
      );
    case "failed":
      return (
        <span className={`${base} bg-red-50 text-red-700`}>
          <AlertTriangle className="w-3 h-3" /> Failed
        </span>
      );
    case "skipped":
      return <span className={`${base} bg-gray-100 text-gray-500`}>Skipped</span>;
    default:
      return chapter.hasText ? (
        <span className={`${base} bg-gray-50 text-gray-500`}>Not generated</span>
      ) : (
        <span className={`${base} bg-gray-50 text-gray-400`}>No text</span>
      );
  }
};

const CopyableCommand = ({ command }) => (
  <div className="flex items-center gap-2 mt-1.5">
    <code className="flex-1 min-w-0 overflow-x-auto whitespace-nowrap bg-gray-900 text-gray-100 rounded-lg px-3 py-2 text-xs">
      {command}
    </code>
    <button
      type="button"
      onClick={() =>
        navigator.clipboard
          ?.writeText(command)
          .then(() => toast.success("Command copied."))
          .catch(() => toast.error("Couldn't copy; select the text instead."))
      }
      className="p-2 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100"
      title="Copy command"
    >
      <Copy className="w-3.5 h-3.5" />
      <span className="sr-only">Copy command</span>
    </button>
  </div>
);

// How audio gets made: on the server (the configured provider), or free on
// the admin's own PC with the narration script. Uploading an MP3 per
// chapter (in the table below) covers anything else.
const WaysToMakeAudio = ({ bookId, provider }) => (
  <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 lg:p-8">
    <h3 className="font-semibold text-gray-900">Two ways to make audio</h3>
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <div className="rounded-2xl bg-gray-50 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-gray-800">
          <Server className="w-4 h-4 text-accent" /> On the server ({provider?.label || "Gemini"})
        </p>
        <p className="text-sm text-gray-600 mt-1.5">
          Use the Generate buttons here. Runs in the background; nothing to install.
          {provider?.chargesQuota &&
            " Gemini's free quota is small, so long books may stop at \"Waiting for quota\" and continue after the daily reset. Finished parts are kept."}
        </p>
      </div>
      <div className="rounded-2xl bg-gray-50 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-gray-800">
          <Laptop className="w-4 h-4 text-accent" /> Free, on your own PC (Kokoro)
        </p>
        <p className="text-sm text-gray-600 mt-1.5">
          No account or quota; takes about as long as the audio itself. In a terminal, from the project's{" "}
          <code className="text-xs">backend</code> folder, install it once:
        </p>
        <CopyableCommand command="npm install --prefix scripts/local-tts" />
        <p className="text-sm text-gray-600 mt-2">Then narrate this book (run it again to continue if it stops):</p>
        <CopyableCommand command={`node scripts/narrate-book.js ${bookId}`} />
        <p className="text-xs text-gray-500 mt-2">
          Add <code>--dry-run</code> to preview, <code>--chapter 3</code> for one chapter, or{" "}
          <code>--voice bm_george</code> for another voice (<code>--list-voices</code>). Results appear here
          automatically.
        </p>
      </div>
    </div>
  </div>
);

const AudiobookTab = ({ bookId, hasUnsavedChanges = false }) => {
  const [status, setStatus] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [voice, setVoice] = useState("");
  const [plan, setPlan] = useState(null); // dry-run result awaiting confirmation
  const [planTarget, setPlanTarget] = useState(null);
  const [busyTarget, setBusyTarget] = useState(null); // chapterId | "all-missing" while a request runs
  const [isConfirming, setIsConfirming] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [uploadingChapterId, setUploadingChapterId] = useState(null);
  const uploadInputRef = useRef(null);
  const uploadTargetRef = useRef(null);
  const previewAudioRef = useRef(null);
  const pollTimerRef = useRef(null);
  // Bumped after every status fetch (success or not), so polling keeps going
  // through a failed request instead of stalling on an unchanged status.
  const [pollTick, setPollTick] = useState(0);

  const applyStatus = useCallback((next) => {
    setStatus(next);
    setVoice((current) => current || next.voice);
  }, []);

  const fetchStatus = useCallback(
    () =>
      axiosInstance
        .get(API_PATHS.BOOKS.AUDIO_STATUS(bookId))
        .then((res) => {
          applyStatus(res.data);
          setLoadError("");
        })
        .catch((error) => setLoadError(getErrorMessage(error, "Couldn't load audiobook status.")))
        .finally(() => setPollTick((tick) => tick + 1)),
    [bookId, applyStatus]
  );

  useEffect(() => {
    let cancelled = false;
    axiosInstance
      .get(API_PATHS.BOOKS.AUDIO_STATUS(bookId))
      .then((res) => !cancelled && applyStatus(res.data))
      .catch((error) => !cancelled && setLoadError(getErrorMessage(error, "Couldn't load audiobook status.")));
    return () => {
      cancelled = true;
    };
  }, [bookId, applyStatus]);

  // Poll while the server is working on this book.
  useEffect(() => {
    if (!status?.isWorking) return undefined;
    pollTimerRef.current = setTimeout(fetchStatus, POLL_MS);
    return () => clearTimeout(pollTimerRef.current);
  }, [status?.isWorking, pollTick, fetchStatus]);

  const stopPreview = () => {
    const audio = previewAudioRef.current;
    if (audio) {
      audio.pause();
      URL.revokeObjectURL(audio.src);
      previewAudioRef.current = null;
    }
    setIsPreviewPlaying(false);
  };

  useEffect(() => stopPreview, []);

  const handlePreview = async () => {
    if (isPreviewPlaying) {
      stopPreview();
      return;
    }
    setIsPreviewLoading(true);
    try {
      const res = await axiosInstance.post(
        API_PATHS.BOOKS.AUDIO_PREVIEW(bookId),
        { voice },
        { responseType: "blob" }
      );
      stopPreview();
      const audio = new Audio(URL.createObjectURL(res.data));
      previewAudioRef.current = audio;
      audio.onended = stopPreview;
      setIsPreviewPlaying(true);
      await audio.play();
    } catch (error) {
      // A blob response hides the JSON error message; read it back out.
      let message = "Couldn't generate the preview.";
      if (error.response?.data instanceof Blob) {
        try {
          message = JSON.parse(await error.response.data.text()).message || message;
        } catch {
          /* keep the default message */
        }
      } else {
        message = getErrorMessage(error, message);
      }
      toast.error(message);
      stopPreview();
    } finally {
      setIsPreviewLoading(false);
    }
  };

  // Step 1: dry run → confirmation dialog with the numbers.
  const requestPlan = async (chapterId) => {
    setBusyTarget(chapterId);
    try {
      const res = await axiosInstance.post(API_PATHS.BOOKS.AUDIO_GENERATE(bookId), {
        chapterId,
        voice,
        dryRun: true,
      });
      if (res.data.chapters.length === 0 && res.data.skipped.length === 0) {
        toast("Every chapter already has audio or is in progress.");
        return;
      }
      setPlan(res.data);
      setPlanTarget(chapterId);
    } catch (error) {
      toast.error(getErrorMessage(error, "Couldn't prepare the narration run."));
    } finally {
      setBusyTarget(null);
    }
  };

  // Step 2: queue it for real.
  const confirmPlan = async () => {
    setIsConfirming(true);
    try {
      const res = await axiosInstance.post(API_PATHS.BOOKS.AUDIO_GENERATE(bookId), {
        chapterId: planTarget,
        voice,
      });
      applyStatus(res.data.status);
      const count = res.data.chapters.length;
      toast.success(
        count
          ? `Narration queued for ${count} chapter${count === 1 ? "" : "s"}. You can keep working; this page updates as it goes.`
          : "Nothing to narrate in the selected chapters."
      );
      setPlan(null);
      setPlanTarget(null);
    } catch (error) {
      toast.error(getErrorMessage(error, "Couldn't start narration."));
      fetchStatus();
    } finally {
      setIsConfirming(false);
    }
  };

  const confirmDelete = async () => {
    setIsDeleting(true);
    try {
      const res = await axiosInstance.delete(API_PATHS.BOOKS.AUDIO_DELETE(bookId, deleteTarget.chapterId));
      applyStatus(res.data);
      toast.success(deleteTarget.status === "queued" ? "Cancelled." : "Audio deleted.");
      setDeleteTarget(null);
    } catch (error) {
      toast.error(getErrorMessage(error, "Couldn't delete the audio."));
      fetchStatus();
    } finally {
      setIsDeleting(false);
    }
  };

  const chooseUpload = (chapter) => {
    uploadTargetRef.current = chapter;
    uploadInputRef.current?.click();
  };

  const handleUploadFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // so choosing the same file again still fires
    const chapter = uploadTargetRef.current;
    if (!file || !chapter) return;
    if (!/\.mp3$/i.test(file.name)) {
      toast.error("Only MP3 files can be uploaded.");
      return;
    }
    if (file.size > UPLOAD_MAX_BYTES) {
      toast.error("Audio file must be smaller than 50MB.");
      return;
    }
    setUploadingChapterId(chapter.chapterId);
    try {
      const form = new FormData();
      form.append("audio", file);
      const res = await axiosInstance.post(API_PATHS.BOOKS.AUDIO_UPLOAD(bookId, chapter.chapterId), form, {
        headers: { "Content-Type": "multipart/form-data" },
        // Up to 50MB, so allow more than the default 2 minutes.
        timeout: 10 * 60 * 1000,
      });
      applyStatus(res.data);
      toast.success(chapter.hasAudio ? `Audio replaced for "${chapter.title}".` : `Audio added to "${chapter.title}".`);
    } catch (error) {
      toast.error(getErrorMessage(error, "Couldn't upload the audio."));
      fetchStatus();
    } finally {
      setUploadingChapterId(null);
    }
  };

  if (!status) {
    return loadError ? (
      <div className="bg-white rounded-3xl border border-red-100 p-8 text-center">
        <p className="text-red-600 mb-4">{loadError}</p>
        <Button variant="secondary" onClick={fetchStatus}>
          Try again
        </Button>
      </div>
    ) : (
      <div className="flex justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  const readyChapters = status.chapters.filter((c) => c.hasAudio);
  const totalDuration = readyChapters.reduce((sum, c) => sum + c.durationSec, 0);
  const totalBytes = readyChapters.reduce((sum, c) => sum + c.bytes, 0);
  const missingCount = status.chapters.filter(
    (c) => c.hasText && !c.hasAudio && !["queued", "generating"].includes(c.status)
  ).length;
  const { usage } = status;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 lg:p-8">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
          <div>
            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <Headphones className="w-5 h-5 text-accent" />
              Audiobook
            </h2>
            <p className="text-sm text-gray-500 mt-1 max-w-xl">
              Narration per chapter: generated here, made free on your PC, or uploaded as an MP3. Readers
              who own the book can play it on the reading page; chapters without audio fall back to the
              device voice (Listen Mode).
            </p>
            <p className="text-sm text-gray-600 mt-3">
              {readyChapters.length} of {status.chapters.length} chapters narrated
              {readyChapters.length > 0 && ` · ${formatDuration(totalDuration)} · ${formatBytes(totalBytes)}`}
            </p>
          </div>

          <div className="flex flex-col gap-2 min-w-[260px]">
            <label htmlFor="audiobook-voice" className="text-sm font-medium text-gray-700">
              Voice
            </label>
            <div className="flex gap-2">
              <select
                id="audiobook-voice"
                value={voice}
                onChange={(e) => {
                  stopPreview();
                  setVoice(e.target.value);
                }}
                className="flex-1 bg-gray-50 border border-gray-200 rounded-2xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
              >
                {status.voices.map((v) => (
                  <option key={v.name} value={v.name}>
                    {v.name} ({v.description}){v.name === status.defaultVoice ? " · default" : ""}
                  </option>
                ))}
              </select>
              <Button
                variant="secondary"
                onClick={handlePreview}
                loading={isPreviewLoading}
                className="flex items-center gap-1.5 whitespace-nowrap"
                title="Hear this voice read the book's first sentence"
              >
                {isPreviewPlaying ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                {isPreviewPlaying ? "Stop" : "Preview voice"}
              </Button>
            </div>
            <p className="text-xs text-gray-400">
              Used for the chapters you generate next. {status.provider?.label || "Gemini"} · {status.model}
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pt-6 border-t border-gray-100">
          <p className="text-xs text-gray-500">
            {status.provider?.chargesQuota === false ? (
              "Local narration: free, with no daily limit."
            ) : (
              <>
                Today (UTC): {formatNumber(usage.usedToday)} of {formatNumber(usage.dailyLimit)} characters used
                {usage.queuedChars > 0 && `, ${formatNumber(usage.queuedChars)} queued`}.
              </>
            )}
          </p>
          <Button
            onClick={() => requestPlan("all-missing")}
            loading={busyTarget === "all-missing"}
            disabled={missingCount === 0 || busyTarget !== null}
            className="flex items-center gap-2"
          >
            <Sparkles className="w-4 h-4" />
            Generate all missing{missingCount ? ` (${missingCount})` : ""}
          </Button>
        </div>

        {hasUnsavedChanges && (
          <p className="mt-4 flex items-start gap-2 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            <Info className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
            You have unsaved edits. Narration uses the last saved text, so save first if you want them included.
          </p>
        )}
      </div>

      <WaysToMakeAudio bookId={bookId} provider={status.provider} />

      <input
        ref={uploadInputRef}
        type="file"
        accept=".mp3,audio/mpeg"
        className="hidden"
        onChange={handleUploadFile}
      />

      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-5 py-3">Chapter</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3 whitespace-nowrap">Length</th>
                <th className="px-5 py-3">Size</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {status.chapters.map((chapter) => {
                const inProgress = chapter.status === "queued" || chapter.status === "generating";
                // A failed or quota-stopped run with saved parts continues
                // from them instead of starting over.
                const canContinue = ["failed", "waiting"].includes(chapter.status) && chapter.chunksDone > 0;
                return (
                  <tr key={chapter.chapterId} className="align-top">
                    <td className="px-5 py-4">
                      <p className="font-medium text-gray-900">
                        {chapter.index + 1}. {chapter.title || "Untitled"}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {chapter.hasText
                          ? `${formatNumber(chapter.charCount)} characters · about ${formatDuration(chapter.estimatedDurationSec)}`
                          : "No text yet"}
                      </p>
                      {chapter.error && (
                        <p
                          className={`text-xs mt-1 ${
                            chapter.status === "failed"
                              ? "text-red-600"
                              : chapter.status === "waiting"
                                ? "text-amber-700"
                                : "text-gray-500"
                          }`}
                        >
                          {chapter.error}
                        </p>
                      )}
                      {canContinue && !/parts are saved/.test(chapter.error) && (
                        <p className="text-xs text-gray-500 mt-1">
                          {chapter.chunksDone} of {chapter.chunksTotal} parts done; generating again continues from there.
                        </p>
                      )}
                      {chapter.hasAudio && ["queued", "generating", "failed", "waiting"].includes(chapter.status) && (
                        <p className="text-xs text-gray-500 mt-1">The previous audio stays live until a new one is ready.</p>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <StatusBadge chapter={chapter} />
                    </td>
                    <td className="px-5 py-4 text-gray-600 whitespace-nowrap">
                      {chapter.hasAudio ? formatDuration(chapter.durationSec) : "—"}
                      {chapter.hasAudio && chapter.source && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          {SOURCE_LABELS[chapter.source] || chapter.source}
                          {chapter.source !== "uploaded" && chapter.voice ? ` · ${chapter.voice}` : ""}
                        </p>
                      )}
                    </td>
                    <td className="px-5 py-4 text-gray-600 whitespace-nowrap">
                      {chapter.hasAudio ? formatBytes(chapter.bytes) : "—"}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => requestPlan(chapter.chapterId)}
                          loading={busyTarget === chapter.chapterId}
                          disabled={!chapter.hasText || inProgress || busyTarget !== null}
                          className="flex items-center gap-1.5 whitespace-nowrap"
                        >
                          {chapter.hasAudio || canContinue ? (
                            <RefreshCw className="w-3.5 h-3.5" />
                          ) : (
                            <Sparkles className="w-3.5 h-3.5" />
                          )}
                          {canContinue ? "Continue" : chapter.hasAudio ? "Regenerate" : "Generate"}
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => chooseUpload(chapter)}
                          loading={uploadingChapterId === chapter.chapterId}
                          disabled={chapter.status === "generating" || uploadingChapterId !== null}
                          title={chapter.hasAudio ? "Replace with an MP3 (max 50MB)" : "Upload an MP3 (max 50MB)"}
                          className="flex items-center gap-1.5 whitespace-nowrap"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          <span className="sr-only sm:not-sr-only">Upload audio</span>
                        </Button>
                        {(chapter.hasAudio || chapter.status === "queued" || canContinue) && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setDeleteTarget(chapter)}
                            disabled={chapter.status === "generating"}
                            title={
                              chapter.status === "generating"
                                ? "Wait for generation to finish"
                                : chapter.status === "queued"
                                  ? "Cancel"
                                  : "Delete audio"
                            }
                            className="flex items-center gap-1.5 text-red-600"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span className="sr-only">{chapter.status === "queued" ? "Cancel" : "Delete"}</span>
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
          <h3 className="font-semibold text-gray-900">Audio for removed chapters</h3>
          <p className="text-sm text-gray-500 mt-1">
            These chapters were deleted from the book. Their audio isn't offered to readers but is still
            stored. Delete it to free the space.
          </p>
          <ul className="mt-4 divide-y divide-gray-100">
            {status.orphaned.map((entry) => (
              <li key={entry.chapterId} className="flex items-center justify-between py-3 text-sm">
                <span className="text-gray-600">
                  {entry.hasAudio ? `${formatDuration(entry.durationSec)} · ${formatBytes(entry.bytes)}` : entry.status}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setDeleteTarget({ ...entry, title: "a removed chapter" })}
                  disabled={entry.status === "generating"}
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
        onClose={() => !isConfirming && setPlan(null)}
        title={planTarget === "all-missing" ? "Generate all missing audio?" : "Generate chapter audio?"}
      >
        {plan && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="bg-gray-50 rounded-2xl p-4">
                <p className="text-xs text-gray-500">Characters</p>
                <p className="text-lg font-bold text-gray-900">{formatNumber(plan.totalChars)}</p>
              </div>
              <div className="bg-gray-50 rounded-2xl p-4">
                <p className="text-xs text-gray-500">Estimated audio</p>
                <p className="text-lg font-bold text-gray-900">~{formatDuration(plan.estimatedDurationSec)}</p>
              </div>
              <div className="bg-gray-50 rounded-2xl p-4">
                <p className="text-xs text-gray-500">Voice</p>
                <p className="text-lg font-bold text-gray-900">{plan.voice}</p>
              </div>
            </div>

            {plan.chapters.length > 0 && (
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">
                  {plan.chapters.length} chapter{plan.chapters.length === 1 ? "" : "s"}
                </p>
                <ul className="text-sm text-gray-600 space-y-1 max-h-48 overflow-y-auto">
                  {plan.chapters.map((c) => (
                    <li key={c.chapterId} className="flex justify-between gap-4">
                      <span className="truncate">{c.title}</span>
                      <span className="text-gray-400 whitespace-nowrap">
                        {formatNumber(c.charCount)} chars · ~{formatDuration(c.estimatedDurationSec)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {plan.skipped.length > 0 && (
              <p className="text-sm text-gray-500">
                Skipped (no text): {plan.skipped.map((c) => c.title).join(", ")}
              </p>
            )}

            <p className={`text-sm ${plan.wouldExceedLimit ? "text-red-600 font-medium" : "text-gray-500"}`}>
              {plan.wouldExceedLimit
                ? `This needs ${formatNumber(plan.totalChars)} characters, but only ${formatNumber(plan.usage.remaining)} of today's ${formatNumber(plan.usage.dailyLimit)} are left (UTC). Generate fewer chapters or try again tomorrow.`
                : `Uses ${formatNumber(plan.totalChars)} of the ${formatNumber(plan.usage.remaining)} characters left today. It runs in the background and takes roughly as long as the audio itself; keep this tab open on Render's free tier so the server stays awake.`}
            </p>

            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setPlan(null)} disabled={isConfirming}>
                Cancel
              </Button>
              <Button
                onClick={confirmPlan}
                loading={isConfirming}
                disabled={isConfirming || plan.wouldExceedLimit || plan.chapters.length + plan.skipped.length === 0}
              >
                Generate
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={Boolean(deleteTarget)}
        onClose={() => !isDeleting && setDeleteTarget(null)}
        title={deleteTarget?.status === "queued" ? "Cancel narration?" : "Delete audio?"}
      >
        {deleteTarget && (
          <div className="space-y-6">
            <p className="text-gray-600">
              {deleteTarget.status === "queued" && !deleteTarget.hasAudio
                ? `"${deleteTarget.title}" won't be narrated.`
                : `The audio for "${deleteTarget.title}" will be deleted, and readers will no longer be able to play it. You can generate it again later.`}
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setDeleteTarget(null)} disabled={isDeleting}>
                Keep it
              </Button>
              <Button variant="danger" onClick={confirmDelete} loading={isDeleting}>
                {deleteTarget.status === "queued" && !deleteTarget.hasAudio ? "Cancel narration" : "Delete audio"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default AudiobookTab;
