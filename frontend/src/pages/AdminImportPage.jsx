import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { AlertTriangle, ArrowDown, ArrowUp, FileUp, Merge, Scissors, Trash2, Upload, X } from "lucide-react";
import axiosInstance from "../utils/axiosInstance";
import { API_PATHS } from "../utils/apiPaths";
import getErrorMessage from "../utils/getErrorMessage";
import DashboardLayout from "../components/layout/DashboardLayout";
import Button from "../components/ui/Button";
import {
  createReviewState,
  deleteChapter,
  firstLines,
  mergeWithNext,
  moveChapter,
  paragraphsOf,
  renameChapter,
  reviewProblems,
  splitChapter,
  toCommitPayload,
  wordCount,
} from "../utils/importDraft";
import { RIGHTS_TYPES } from "../utils/bookRights";

// Import a book written by someone else (backend/controller/importController.js).
// 1. Upload: the file is parsed on the server and thrown away (never stored).
// 2. Review: fix the details and chapters here; nothing is saved yet.
// 3. Save: creates a draft book and opens it in the editor, where the
//    rights details are completed and the book is published.

const ACCEPT = ".docx,.epub,.md,.markdown,.txt,.pdf";
const fieldClass = "w-full bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-accent";

const IconButton = ({ label, onClick, disabled, children, danger }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    title={label}
    className={`w-9 h-9 rounded-xl flex items-center justify-center text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed ${
      danger ? "hover:bg-red-50 hover:text-red-600" : "hover:bg-gray-100"
    }`}
  >
    {children}
  </button>
);

// Pick the paragraph a chapter should be split before.
const SplitPicker = ({ chapter, onSplit, onClose }) => {
  const paragraphs = paragraphsOf(chapter.content);
  return (
    <div className="mt-3 rounded-2xl border border-gray-200 bg-gray-50 p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-sm font-medium text-gray-800">Start a new chapter at…</p>
        <IconButton label="Close" onClick={onClose}>
          <X className="w-4 h-4" />
        </IconButton>
      </div>
      {paragraphs.length < 2 ? (
        <p className="text-sm text-gray-500">This chapter has only one paragraph.</p>
      ) : (
        <ol className="max-h-72 overflow-y-auto space-y-1">
          {paragraphs.slice(1).map((p, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => onSplit(i + 1)}
                className="w-full text-left text-sm rounded-xl px-3 py-2 bg-white border border-gray-100 hover:border-accent hover:bg-orange-50"
              >
                <span className="text-gray-400 mr-2 tabular-nums">¶{i + 2}</span>
                {firstLines(p, 120) || "(image)"}
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};

const AdminImportPage = () => {
  const navigate = useNavigate();
  const fileRef = useRef(null);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [review, setReview] = useState(null);
  const [splitting, setSplitting] = useState(null); // chapter id
  const [useDetectedCover, setUseDetectedCover] = useState(true);
  const [coverFile, setCoverFile] = useState(null);
  const [rights, setRights] = useState({ type: "licensed", holderName: "", royaltyPercent: "" });

  const problems = useMemo(() => (review ? reviewProblems(review) : []), [review]);
  const detectedCover = review?.coverKey ? review.images[review.coverKey]?.dataUri : null;
  const coverPreview = useMemo(() => (coverFile ? URL.createObjectURL(coverFile) : null), [coverFile]);

  const parse = async (file) => {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    setParsing(true);
    try {
      const res = await axiosInstance.post(API_PATHS.ADMIN.IMPORT_PARSE, form, { headers: { "Content-Type": "multipart/form-data" } });
      setReview(createReviewState(res.data));
      setUseDetectedCover(Boolean(res.data.coverKey));
      setCoverFile(null);
      setRights((r) => ({ ...r, holderName: r.holderName || res.data.author || "" }));
      toast.success(`Found ${res.data.chapters.length} chapter${res.data.chapters.length === 1 ? "" : "s"}.`);
    } catch (error) {
      toast.error(getErrorMessage(error, "Couldn't read that file."));
    } finally {
      setParsing(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const setField = (key) => (e) => setReview((r) => ({ ...r, [key]: e.target.value }));
  const apply = (fn) => setReview((r) => fn(r));

  const save = async () => {
    setSaving(true);
    try {
      const payload = toCommitPayload(review, {
        useDetectedCover: useDetectedCover && !coverFile,
        rights: {
          type: rights.type,
          holderName: rights.type === "own" ? "" : rights.holderName.trim(),
          royaltyPercent: rights.royaltyPercent === "" ? 0 : Number(rights.royaltyPercent),
        },
      });
      const res = await axiosInstance.post(API_PATHS.ADMIN.IMPORT_COMMIT, payload);
      if (coverFile) {
        const form = new FormData();
        form.append("coverImage", coverFile);
        try {
          await axiosInstance.put(`${API_PATHS.BOOKS.UPDATE_COVER}/${res.data._id}`, form, { headers: { "Content-Type": "multipart/form-data" } });
        } catch (error) {
          toast.error(getErrorMessage(error, "The book was saved, but the cover upload failed. Add it in the editor."));
        }
      }
      toast.success("Saved as a draft. Finish the rights details, then publish.");
      navigate(`/editor/${res.data._id}`);
    } catch (error) {
      toast.error(getErrorMessage(error, "Couldn't save the book."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        <header>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <FileUp className="w-6 h-6 text-accent" />
            Import a book
          </h1>
          <p className="text-sm text-gray-600 mt-1 max-w-2xl">
            For books by other authors. Word (.docx), EPUB, Markdown, plain text or a PDF with selectable text. The file is only read to make a draft and
            isn't kept. Nothing is published until you confirm the rights in the editor.
          </p>
        </header>

        <section className="bg-white rounded-3xl border border-dashed border-gray-300 p-6 flex flex-col sm:flex-row sm:items-center gap-4">
          <input ref={fileRef} type="file" accept={ACCEPT} className="sr-only" id="import-file" onChange={(e) => parse(e.target.files?.[0])} />
          <Button size="sm" onClick={() => fileRef.current?.click()} loading={parsing}>
            <Upload className="w-4 h-4 mr-2" />
            {review ? "Choose another file" : "Choose a file"}
          </Button>
          <p className="text-sm text-gray-500">
            {parsing ? "Reading the file…" : review ? `${review.fileName} (${review.format.toUpperCase()})` : "Up to 25 MB."}
          </p>
        </section>

        {review && (
          <>
            {review.warnings.length > 0 && (
              <div role="status" className="rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
                <p className="font-semibold flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  Check these
                </p>
                <ul className="list-disc pl-6 mt-1 space-y-0.5">
                  {review.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            <section aria-labelledby="details-heading" className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 space-y-4">
              <h2 id="details-heading" className="font-bold text-gray-900">
                Book details
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="block text-sm font-medium text-gray-700 mb-1">Title</span>
                  <input value={review.title} onChange={setField("title")} maxLength={200} className={fieldClass} />
                </label>
                <label className="block">
                  <span className="block text-sm font-medium text-gray-700 mb-1">Author (shown to readers as "by …")</span>
                  <input value={review.author} onChange={setField("author")} maxLength={200} className={fieldClass} />
                </label>
                <label className="block sm:col-span-2">
                  <span className="block text-sm font-medium text-gray-700 mb-1">Description</span>
                  <textarea value={review.description} onChange={setField("description")} rows={3} maxLength={5000} className={fieldClass} />
                </label>
              </div>

              <div className="flex flex-wrap items-start gap-4">
                {(coverPreview || (useDetectedCover && detectedCover)) && (
                  <img src={coverPreview || detectedCover} alt="Cover preview" className="w-24 h-36 object-cover rounded-xl border border-gray-100" />
                )}
                <div className="space-y-2 text-sm">
                  {detectedCover && !coverFile && (
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={useDetectedCover} onChange={(e) => setUseDetectedCover(e.target.checked)} className="w-4 h-4" />
                      Use the cover found in the file
                    </label>
                  )}
                  <label className="block">
                    <span className="block font-medium text-gray-700 mb-1">{coverFile ? "Cover image" : "Or upload a cover image"}</span>
                    <input type="file" accept="image/*" onChange={(e) => setCoverFile(e.target.files?.[0] || null)} className="text-sm" />
                  </label>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3 pt-2 border-t border-gray-100">
                <label className="block">
                  <span className="block text-sm font-medium text-gray-700 mb-1">Rights</span>
                  <select value={rights.type} onChange={(e) => setRights((r) => ({ ...r, type: e.target.value }))} className={fieldClass}>
                    {RIGHTS_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </label>
                {rights.type !== "own" && (
                  <label className="block">
                    <span className="block text-sm font-medium text-gray-700 mb-1">Rights holder</span>
                    <input value={rights.holderName} onChange={(e) => setRights((r) => ({ ...r, holderName: e.target.value }))} maxLength={200} className={fieldClass} />
                  </label>
                )}
                <label className="block">
                  <span className="block text-sm font-medium text-gray-700 mb-1">Royalty %</span>
                  <input type="number" min="0" max="100" step="0.5" value={rights.royaltyPercent} onChange={(e) => setRights((r) => ({ ...r, royaltyPercent: e.target.value }))} className={fieldClass} placeholder="0" />
                </label>
                <p className="sm:col-span-3 text-xs text-gray-500">Licence notes, contact, expiry and territory are added in the editor's Rights &amp; royalties section.</p>
              </div>
            </section>

            <section aria-labelledby="chapters-heading" className="bg-white rounded-3xl border border-gray-100 shadow-sm p-4 sm:p-6">
              <h2 id="chapters-heading" className="font-bold text-gray-900 mb-3">
                Chapters ({review.chapters.length})
              </h2>
              <ol className="space-y-3">
                {review.chapters.map((chapter, i) => (
                  <li key={chapter.id} className="rounded-2xl border border-gray-100 p-3 sm:p-4">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                      <span className="text-xs font-semibold text-gray-400 tabular-nums w-6">{i + 1}</span>
                      <input
                        value={chapter.title}
                        onChange={(e) => apply((r) => renameChapter(r, i, e.target.value))}
                        maxLength={200}
                        aria-label={`Chapter ${i + 1} title`}
                        className={`${fieldClass} sm:flex-1 font-medium ${chapter.title.trim() ? "" : "border-red-300"}`}
                      />
                      <div className="flex items-center gap-0.5 flex-shrink-0">
                        <IconButton label="Move up" onClick={() => apply((r) => moveChapter(r, i, -1))} disabled={i === 0}>
                          <ArrowUp className="w-4 h-4" />
                        </IconButton>
                        <IconButton label="Move down" onClick={() => apply((r) => moveChapter(r, i, 1))} disabled={i === review.chapters.length - 1}>
                          <ArrowDown className="w-4 h-4" />
                        </IconButton>
                        <IconButton label="Merge with the next chapter" onClick={() => apply((r) => mergeWithNext(r, i))} disabled={i === review.chapters.length - 1}>
                          <Merge className="w-4 h-4" />
                        </IconButton>
                        <IconButton label="Split this chapter" onClick={() => setSplitting(splitting === chapter.id ? null : chapter.id)}>
                          <Scissors className="w-4 h-4" />
                        </IconButton>
                        <IconButton label="Delete this chapter" danger onClick={() => apply((r) => deleteChapter(r, i))}>
                          <Trash2 className="w-4 h-4" />
                        </IconButton>
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 mt-2 sm:pl-8">
                      {wordCount(chapter.content).toLocaleString("en-NG")} words · {firstLines(chapter.content) || "(empty)"}
                    </p>
                    {splitting === chapter.id && (
                      <SplitPicker
                        chapter={chapter}
                        onClose={() => setSplitting(null)}
                        onSplit={(at) => {
                          apply((r) => splitChapter(r, i, at));
                          setSplitting(null);
                        }}
                      />
                    )}
                  </li>
                ))}
              </ol>
            </section>

            <div className="flex flex-col sm:flex-row sm:items-center gap-3 pb-8">
              <Button onClick={save} loading={saving} disabled={saving || problems.length > 0}>
                Save as draft
              </Button>
              {problems.length > 0 ? (
                <p role="alert" className="text-sm text-red-700">
                  {problems.join(" ")}
                </p>
              ) : (
                <p className="text-sm text-gray-500">Saved as a draft; you publish it from the editor.</p>
              )}
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
};

export default AdminImportPage;
