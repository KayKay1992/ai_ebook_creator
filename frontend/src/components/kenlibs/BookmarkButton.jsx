import { useEffect, useRef, useState } from "react";
import { Bookmark, BookmarkCheck } from "lucide-react";
import { LABEL_MAX_LENGTH } from "../../utils/annotationUi";

// Bookmark control at the top of each chapter in the reader. Saves a
// bookmark for the chapter's start, or for the paragraph currently at the
// top of the screen ("this spot"), with an optional label. Bookmarks are
// separate from the saved reading position and never change it.
const BookmarkButton = ({ count = 0, disabled = false, getSpotParagraph, onSave }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (e) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    const onPointerDown = (e) => {
      if (!wrapperRef.current?.contains(e.target)) setIsOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [isOpen]);

  const save = async (paragraphIndex) => {
    setIsSaving(true);
    const ok = await onSave({ paragraphIndex, label: label.trim() });
    setIsSaving(false);
    if (ok) {
      setLabel("");
      setIsOpen(false);
    }
  };

  const Icon = count ? BookmarkCheck : Bookmark;
  return (
    <div ref={wrapperRef} className="relative flex justify-end mb-4">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        disabled={disabled}
        aria-expanded={isOpen}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm text-gray-600 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 disabled:opacity-40"
        title={disabled ? "Bookmarks are unavailable right now" : "Bookmark this chapter or this spot"}
      >
        <Icon className={`w-4 h-4 ${count ? "text-accent" : ""}`} />
        Bookmark{count ? ` (${count})` : ""}
      </button>
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 z-40 w-72 rounded-2xl bg-white border border-gray-200 shadow-xl p-3 space-y-2">
          <label htmlFor="bookmark-label" className="text-xs font-medium text-gray-600">
            Label (optional)
          </label>
          <input
            id="bookmark-label"
            value={label}
            onChange={(e) => setLabel(e.target.value.slice(0, LABEL_MAX_LENGTH))}
            maxLength={LABEL_MAX_LENGTH}
            autoFocus
            placeholder="e.g. Budget tips"
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => save(null)}
              disabled={isSaving}
              className="flex-1 px-3 py-2 rounded-xl text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200"
            >
              Chapter start
            </button>
            <button
              type="button"
              onClick={() => save(getSpotParagraph())}
              disabled={isSaving}
              className="flex-1 px-3 py-2 rounded-xl text-sm font-semibold text-white bg-accent hover:bg-accent-hover"
            >
              This spot
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default BookmarkButton;
