import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { AlertTriangle, ArrowDown, ArrowUp, ChevronsDown, ChevronsUp, FileUp, Image as ImageIcon, ImageOff, Info, Regex, Scissors, Trash2, Upload, X } from "lucide-react";
import axiosInstance from "../utils/axiosInstance";
import { API_PATHS } from "../utils/apiPaths";
import getErrorMessage from "../utils/getErrorMessage";
import DashboardLayout from "../components/layout/DashboardLayout";
import Button from "../components/ui/Button";
import {
  createReviewState,
  deleteChapter,
  firstLines,
  imageCount,
  longSingleChapter,
  mergeWithNext,
  mergeWithPrevious,
  moveChapter,
  paragraphsOf,
  renameChapter,
  reviewProblems,
  reviewSummary,
  setChapterKind,
  setKeepOneChapter,
  splitByPattern,
  splitChapter,
  toCommitPayload,
  toggleChapterImages,
  wordCount,
} from "../utils/importDraft";
import { CHAPTER_KIND_OPTIONS, chapterNumbers } from "../utils/chapterKinds";
import { RIGHTS_TYPES } from "../utils/bookRights";

// Import a book written by someone else (backend/controller/importController.js).
// 1. Upload: the file is parsed on the server and thrown away (never stored).
//    Chapters, front/back matter and pictures are detected there
//    (backend/utils/import/chapters.js).
// 2. Review: fix the details and chapters here; nothing is saved yet.
// 3. Save: creates a draft book and opens it in the editor, where the
//    rights details are completed and the book is published.

const ACCEPT = ".docx,.epub,.md,.markdown,.txt,.pdf";
const fieldClass = "w-full bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-accent";
const KIND_LABEL = { front: "Front matter", back: "Back matter", part: "Part" };

const IconButton = ({ label, onClick, disabled, children, danger, pressed }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    aria-pressed={pressed}
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
                {firstLines(p, 120) || "(picture)"}
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};

// "Split by pattern": a line that starts with some text, or a /regex/.
const PatternSplitter = ({ onSplit, onClose, idPrefix }) => {
  const [pattern, setPattern] = useState("Chapter");
  const submit = (e) => {
    e.preventDefault();
    onSplit(pattern);
  };
  return (
    <form onSubmit={submit} className="mt-3 rounded-2xl border border-gray-200 bg-gray-50 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={`${idPrefix}-pattern`} className="text-sm font-medium text-gray-800">
          Split by pattern
        </label>
        {onClose && (
          <IconButton label="Close" onClick={onClose}>
            <X className="w-4 h-4" />
          </IconButton>
        )}
      </div>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          id={`${idPrefix}-pattern`}
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          maxLength={200}
          className={`${fieldClass} sm:flex-1`}
          aria-describedby={`${idPrefix}-pattern-help`}
        />
        <Button size="sm" type="submit" disabled={!pattern.trim()}>
          <Regex className="w-4 h-4 mr-2" />
          Split
        </Button>
      </div>
      <p id={`${idPrefix}-pattern-help`} className="text-xs text-gray-500">
        A new chapter starts at every short line that begins with this text (not case-sensitive), for example <code>Chapter</code>, <code>Part</code> or{" "}
        <code>***</code>. For more control, type a pattern between slashes, for example <code>/^(chapter|lesson) \d+/</code>.
      </p>
    </form>
  );
};

const AdminImportPage = () => {
  const navigate = useNavigate();
  const fileRef = useRef(null);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [review, setReview] = useState(null);
  const [tool, setTool] = useState(null); // { id, type: "split" | "pattern" }
  const [useDetectedCover, setUseDetectedCover] = useState(false);
  const [coverFile, setCoverFile] = useState(null);
  const [rights, setRights] = useState({ type: "licensed", holderName: "", royaltyPercent: "" });

  const problems = useMemo(() => (review ? reviewProblems(review) : []), [review]);
  const summary = useMemo(() => (review ? reviewSummary(review) : null), [review]);
  const longChapter = useMemo(() => (review ? longSingleChapter(review) : null), [review]);
  const numbers = useMemo(() => (review ? chapterNumbers(review.chapters) : []), [review]);
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
      // A cover found in the file is only a suggestion.
      setUseDetectedCover(false);
      setCoverFile(null);
      setTool(null);
      setRights((r) => ({ ...r, holderName: r.holderName || res.data.author || "" }));
      toast.success(`Found ${res.data.chapters.length} section${res.data.chapters.length === 1 ? "" : "s"}.`);
    } catch (error) {
      toast.error(getErrorMessage(error, "Couldn't read that file."));
    } finally {
      setParsing(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const setField = (key) => (e) => setReview((r) => ({ ...r, [key]: e.target.value }));
  const apply = (fn) => setReview((r) => fn(r));
  const toggleTool = (id, type) => setTool((t) => (t?.id === id && t.type === type ? null : { id, type }));

  const runPatternSplit = (index, pattern) => {
    const { state, count, invalid } = splitByPattern(review, index, pattern);
    if (invalid) return toast.error("That pattern isn't valid.");
    if (!count) return toast.error("No line matches that pattern.");
    setReview(state);
    setTool(null);
    toast.success(`Made ${count} new chapter${count === 1 ? "" : "s"}.`);
  };

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

  const longIndex = longChapter ? review.chapters.indexOf(longChapter) : -1;

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
          <p className="text-sm text-gray-500 break-all">
            {parsing ? "Reading the file…" : review ? `${review.fileName} (${review.format.toUpperCase()})` : "Up to 25 MB."}
          </p>
        </section>

        {review && (
          <>
            <p role="status" className="text-base font-semibold text-gray-900" data-testid="import-summary">
              {summary.line}
            </p>

            {longChapter && (
              <div role="alert" className="rounded-2xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-900 space-y-2">
                <p className="font-semibold flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  Only one chapter, {wordCount(longChapter.content).toLocaleString("en-NG")} words long
                </p>
                <p>The chapters weren't recognised. Split it by the line each chapter starts with, or at a paragraph below.</p>
                <PatternSplitter idPrefix="long" onSplit={(pattern) => runPatternSplit(longIndex, pattern)} />
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={review.keepOneChapter} onChange={(e) => apply((r) => setKeepOneChapter(r, e.target.checked))} className="w-4 h-4" />
                  Keep it as one chapter
                </label>
              </div>
            )}

            {review.warnings.length > 0 && (
              <div role="status" className="rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
                <p className="font-semibold flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  Check these
                </p>
                <ul className="list-disc pl-6 mt-1 space-y-0.5">
                  {review.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {review.notes.length > 0 && (
              <details className="rounded-2xl bg-white border border-gray-200 px-4 py-3 text-sm text-gray-700">
                <summary className="font-semibold cursor-pointer flex items-center gap-2">
                  <Info className="w-4 h-4 flex-shrink-0 text-gray-500" />
                  What the import did ({review.notes.length})
                </summary>
                <ul className="list-disc pl-6 mt-2 space-y-0.5">
                  {review.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </details>
            )}

            <section aria-labelledby="details-heading" className="bg-white rounded-3xl border border-gray-100 shadow-sm p-4 sm:p-6 space-y-4">
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
                {(coverPreview || detectedCover) && (
                  <img
                    src={coverPreview || detectedCover}
                    alt={coverPreview ? "Cover preview" : "Cover found in the file"}
                    className={`w-24 h-36 object-cover rounded-xl border border-gray-100 ${!coverPreview && !useDetectedCover ? "opacity-50" : ""}`}
                  />
                )}
                <div className="space-y-2 text-sm min-w-0">
                  {detectedCover && !coverFile && (
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={useDetectedCover} onChange={(e) => setUseDetectedCover(e.target.checked)} className="w-4 h-4" />
                      Use the cover found in the file
                    </label>
                  )}
                  <label className="block">
                    <span className="block font-medium text-gray-700 mb-1">{coverFile ? "Cover image" : detectedCover ? "Or upload a cover image" : "Upload a cover image"}</span>
                    <input type="file" accept="image/*" onChange={(e) => setCoverFile(e.target.files?.[0] || null)} className="text-sm max-w-full" />
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

            <section aria-labelledby="chapters-heading" className="bg-white rounded-3xl border border-gray-100 shadow-sm p-3 sm:p-6">
              <h2 id="chapters-heading" className="font-bold text-gray-900 mb-1">
                Chapters and sections ({review.chapters.length})
              </h2>
              <p className="text-xs text-gray-500 mb-3">Front matter, back matter and parts keep their own title and get no chapter number.</p>
              <ol className="space-y-3">
                {review.chapters.map((chapter, i) => {
                  const images = imageCount(chapter.content);
                  const words = wordCount(chapter.content);
                  const label = numbers[i] ? `Chapter ${numbers[i]}` : KIND_LABEL[chapter.kind];
                  return (
                    <li key={chapter.id} className="rounded-2xl border border-gray-100 p-3 sm:p-4" data-testid="import-chapter">
                      <div className="flex flex-col gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`text-xs font-semibold rounded-lg px-2 py-1 ${numbers[i] ? "bg-gray-100 text-gray-700" : "bg-blue-50 text-blue-800 border border-blue-200"}`}>{label}</span>
                          <select
                            value={chapter.kind}
                            onChange={(e) => apply((r) => setChapterKind(r, i, e.target.value))}
                            aria-label={`What section ${i + 1} is`}
                            className="bg-white border border-gray-200 rounded-xl px-2 py-1.5 text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-accent"
                          >
                            {CHAPTER_KIND_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="flex flex-col md:flex-row md:items-center gap-2">
                          <input
                            value={chapter.title}
                            onChange={(e) => apply((r) => renameChapter(r, i, e.target.value))}
                            maxLength={200}
                            aria-label={`Section ${i + 1} title`}
                            className={`${fieldClass} md:flex-1 font-medium ${chapter.title.trim() ? "" : "border-red-300"}`}
                          />
                          <div className="flex flex-wrap items-center gap-0.5 flex-shrink-0">
                            <IconButton label="Move up" onClick={() => apply((r) => moveChapter(r, i, -1))} disabled={i === 0}>
                              <ArrowUp className="w-4 h-4" />
                            </IconButton>
                            <IconButton label="Move down" onClick={() => apply((r) => moveChapter(r, i, 1))} disabled={i === review.chapters.length - 1}>
                              <ArrowDown className="w-4 h-4" />
                            </IconButton>
                            <IconButton label="Merge with the previous section" onClick={() => apply((r) => mergeWithPrevious(r, i))} disabled={i === 0}>
                              <ChevronsUp className="w-4 h-4" />
                            </IconButton>
                            <IconButton label="Merge with the next section" onClick={() => apply((r) => mergeWithNext(r, i))} disabled={i === review.chapters.length - 1}>
                              <ChevronsDown className="w-4 h-4" />
                            </IconButton>
                            <IconButton label="Split at a paragraph" onClick={() => toggleTool(chapter.id, "split")} pressed={tool?.id === chapter.id && tool.type === "split"}>
                              <Scissors className="w-4 h-4" />
                            </IconButton>
                            <IconButton label="Split by pattern" onClick={() => toggleTool(chapter.id, "pattern")} pressed={tool?.id === chapter.id && tool.type === "pattern"}>
                              <Regex className="w-4 h-4" />
                            </IconButton>
                            {images > 0 && (
                              <IconButton
                                label={chapter.imagesOn ? `Leave out this section's ${images} picture${images === 1 ? "" : "s"}` : `Include this section's ${images} picture${images === 1 ? "" : "s"}`}
                                onClick={() => apply((r) => toggleChapterImages(r, i))}
                                pressed={!chapter.imagesOn}
                              >
                                {chapter.imagesOn ? <ImageIcon className="w-4 h-4" /> : <ImageOff className="w-4 h-4" />}
                              </IconButton>
                            )}
                            <IconButton label="Delete this section" danger onClick={() => apply((r) => deleteChapter(r, i))}>
                              <Trash2 className="w-4 h-4" />
                            </IconButton>
                          </div>
                        </div>
                      </div>
                      <p className="text-xs text-gray-500 mt-2">
                        <span className="font-medium text-gray-700">
                          {words.toLocaleString("en-NG")} words
                          {images > 0 && ` · ${images} picture${images === 1 ? "" : "s"}${chapter.imagesOn ? "" : " (left out)"}`}
                        </span>
                        {" · "}
                        {firstLines(chapter.content, 200) || "(empty)"}
                      </p>
                      {tool?.id === chapter.id && tool.type === "split" && (
                        <SplitPicker
                          chapter={chapter}
                          onClose={() => setTool(null)}
                          onSplit={(at) => {
                            apply((r) => splitChapter(r, i, at));
                            setTool(null);
                          }}
                        />
                      )}
                      {tool?.id === chapter.id && tool.type === "pattern" && <PatternSplitter idPrefix={chapter.id} onClose={() => setTool(null)} onSplit={(pattern) => runPatternSplit(i, pattern)} />}
                    </li>
                  );
                })}
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
