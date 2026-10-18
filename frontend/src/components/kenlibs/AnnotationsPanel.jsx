import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { X, Highlighter, Bookmark, Copy, Download, Trash2, CornerDownRight, AlertTriangle, Loader2 } from "lucide-react";
import { annotationsFor, annotationsToMarkdown } from "../../utils/annotationAnchor";
import { COLOR_STYLES, LABEL_MAX_LENGTH } from "../../utils/annotationUi";
import NoteField from "./NoteField";

// "My highlights & notes" for this book, in the reader: highlights grouped
// by chapter (only those for the language each chapter is shown in), with
// jump-to, note editing, delete, and copy-all / download as Markdown; plus
// a Bookmarks tab. Everything here is the reader's own and private.
//
// chapters: [{ _id, title, index, language }] as currently displayed.
// statusOf(annotation): 'ok' | 'changed' (text no longer in the chapter).
const AnnotationsPanel = ({
  isOpen,
  onClose,
  bookTitle,
  chapters,
  annotations,
  loadStatus,
  onRetry,
  statusOf,
  paintingSupported,
  onJump,
  onUpdate,
  onDelete,
  // "highlights" | "bookmarks": the tab to open on (Library shortcuts).
  initialTab = "highlights",
}) => {
  const [tab, setTab] = useState(initialTab === "bookmarks" ? "bookmarks" : "highlights");
  const closeRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    closeRef.current?.focus();
    const onKeyDown = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Highlights belong to the language they were made in; bookmarks mark a
  // paragraph, which lines up across translations, so they always show.
  const groups = chapters
    .map((chapter) => ({
      chapter,
      items:
        tab === "highlights"
          ? annotationsFor(annotations, chapter._id, chapter.language).filter((a) => a.type === "highlight")
          : annotations.filter((a) => a.type === "bookmark" && a.chapterId === String(chapter._id)),
    }))
    .filter((group) => group.items.length);
  const visibleIds = new Set(groups.flatMap((g) => g.items.map((a) => a._id)));
  const chapterIds = new Set(chapters.map((c) => String(c._id)));
  const hidden = annotations.filter(
    (a) => (tab === "highlights" ? a.type === "highlight" : a.type === "bookmark") && !visibleIds.has(a._id)
  );
  // In a chapter that's shown in another language right now, vs. in a
  // chapter the author has since removed from the book.
  const hiddenCount = hidden.filter((a) => chapterIds.has(a.chapterId)).length;
  const removedCount = hidden.length - hiddenCount;

  const markdown = () => annotationsToMarkdown(bookTitle, chapters, annotations);
  const copyAll = () =>
    navigator.clipboard
      ?.writeText(markdown())
      .then(() => toast.success("Highlights and notes copied."))
      .catch(() => toast.error("Couldn't copy. Try Download instead."));
  const download = () => {
    const url = URL.createObjectURL(new Blob([markdown()], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${(bookTitle || "book").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").toLowerCase() || "book"}-highlights.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const tabButton = (id, label, Icon) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      onClick={() => setTab(id)}
      className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
        tab === id ? "bg-white text-accent-hover shadow-sm" : "text-gray-600 hover:text-gray-900"
      }`}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="My highlights and notes">
      <button type="button" className="absolute inset-0 bg-black/20" onClick={onClose} aria-label="Close panel" tabIndex={-1} />
      <div className="relative h-full w-full sm:w-[26rem] bg-white shadow-2xl flex flex-col">
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-gray-100">
          <h2 className="font-serif text-lg font-bold text-gray-900">My highlights &amp; notes</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-gray-500 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 pt-4">
          <div className="flex gap-1 bg-gray-100 rounded-2xl p-1" role="tablist">
            {tabButton("highlights", "Highlights", Highlighter)}
            {tabButton("bookmarks", "Bookmarks", Bookmark)}
          </div>
          {tab === "highlights" && loadStatus === "ready" && (
            <div className="flex gap-2 mt-3">
              <button type="button" onClick={copyAll} className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm text-gray-700 bg-gray-50 hover:bg-gray-100">
                <Copy className="w-4 h-4" /> Copy all
              </button>
              <button type="button" onClick={download} className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm text-gray-700 bg-gray-50 hover:bg-gray-100">
                <Download className="w-4 h-4" /> Download .md
              </button>
            </div>
          )}
          {tab === "highlights" && !paintingSupported && loadStatus === "ready" && (
            <p className="mt-3 text-xs text-gray-500">
              This browser can't colour highlights in the text, but they're all saved and listed here.
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          {loadStatus === "loading" && (
            <div className="flex justify-center py-10">
              <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
            </div>
          )}
          {loadStatus === "error" && (
            <div className="text-center py-8">
              <p className="text-sm text-gray-600">Couldn't load your highlights. Reading isn't affected.</p>
              <button type="button" onClick={onRetry} className="mt-3 text-sm font-semibold text-accent-hover hover:underline">
                Try again
              </button>
            </div>
          )}
          {loadStatus === "ready" && groups.length === 0 && (
            <p className="text-sm text-gray-500 text-center py-8">
              {tab === "highlights"
                ? "Select text in a chapter to highlight it or add a note."
                : "Use the Bookmark button at the top of a chapter to save your place."}
            </p>
          )}
          {loadStatus === "ready" &&
            groups.map(({ chapter, items }) => (
              <section key={chapter._id}>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">
                  {chapter.index + 1}. {chapter.title || "Untitled"}
                </h3>
                <ul className="space-y-3">
                  {items.map((item) => {
                    const changed = item.type === "highlight" && statusOf(item) === "changed";
                    return (
                      <li key={item._id} className="rounded-2xl border border-gray-100 p-3 space-y-2">
                        {item.type === "highlight" ? (
                          <>
                            <div className="flex items-start gap-2">
                              <span className={`mt-1 w-3 h-3 rounded-full flex-shrink-0 ${COLOR_STYLES[item.color] || COLOR_STYLES.yellow}`} aria-hidden="true" />
                              <p className="text-sm text-gray-800 font-serif line-clamp-4">{item.anchor.quote}</p>
                            </div>
                            {changed && (
                              <p className="flex items-center gap-1 text-xs text-amber-700">
                                <AlertTriangle className="w-3 h-3" /> Text changed: this passage was edited and can't be found in the chapter.
                              </p>
                            )}
                            <NoteField id={`panel-note-${item._id}`} value={item.note || ""} onChange={(note) => onUpdate(item._id, { note })} rows={2} />
                          </>
                        ) : (
                          <>
                            <p className="text-xs text-gray-500">
                              {item.anchor.paragraphIndex === null || item.anchor.paragraphIndex === 0 ? "Start of chapter" : `Paragraph ${item.anchor.paragraphIndex + 1}`}
                            </p>
                            <label htmlFor={`bookmark-label-${item._id}`} className="sr-only">
                              Bookmark label
                            </label>
                            <input
                              id={`bookmark-label-${item._id}`}
                              value={item.label || ""}
                              onChange={(e) => onUpdate(item._id, { label: e.target.value.slice(0, LABEL_MAX_LENGTH) })}
                              maxLength={LABEL_MAX_LENGTH}
                              placeholder="Label (optional)"
                              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
                            />
                          </>
                        )}
                        <div className="flex justify-end gap-2">
                          {!changed && (
                            <button type="button" onClick={() => onJump(item)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold text-accent-hover bg-accent-50 hover:bg-accent-100">
                              <CornerDownRight className="w-3.5 h-3.5" /> Go to
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onDelete(item._id)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold text-red-600 hover:bg-red-50"
                            aria-label={item.type === "highlight" ? "Delete highlight" : "Delete bookmark"}
                          >
                            <Trash2 className="w-3.5 h-3.5" /> Delete
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          {loadStatus === "ready" && hiddenCount > 0 && (
            <p className="text-xs text-gray-400 text-center">
              {hiddenCount} more in another language (switch language to see them).
            </p>
          )}
          {loadStatus === "ready" && removedCount > 0 && (
            <p className="text-xs text-gray-400 text-center">
              {removedCount} more {removedCount === 1 ? "is" : "are"} in chapters no longer in this book.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default AnnotationsPanel;
