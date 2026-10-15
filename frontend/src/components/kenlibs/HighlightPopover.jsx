import { useEffect } from "react";
import { Trash2, X } from "lucide-react";
import { COLOR_STYLES, POPOVER_WIDTH } from "../../utils/annotationUi";
import NoteField from "./NoteField";

// Opened by tapping an existing highlight in the text (or after "add a
// note" from the selection toolbar): change its color, edit its note
// (saved automatically), or delete it. Escape closes.
const HighlightPopover = ({ highlight, position, onChangeColor, onChangeNote, onDelete, onClose, focusNote = false }) => {
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-label="Highlight"
      className="fixed z-50 rounded-2xl bg-white border border-gray-200 shadow-xl p-3 space-y-2"
      style={{ top: position.top, left: position.left, width: POPOVER_WIDTH }}
    >
      <div className="flex items-center gap-1">
        {Object.entries(COLOR_STYLES).map(([color, swatch]) => (
          <button
            key={color}
            type="button"
            onClick={() => onChangeColor(color)}
            aria-label={`Change to ${color}`}
            aria-pressed={highlight.color === color}
            className={`w-9 h-9 rounded-xl flex items-center justify-center hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 ${
              highlight.color === color ? "bg-gray-100" : ""
            }`}
          >
            <span className={`w-5 h-5 rounded-full ${swatch} ring-1 ${highlight.color === color ? "ring-gray-700" : "ring-black/10"}`} />
          </button>
        ))}
        <button
          type="button"
          onClick={onDelete}
          className="ml-auto w-9 h-9 rounded-xl flex items-center justify-center text-red-600 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
          aria-label="Delete highlight"
          title="Delete highlight"
        >
          <Trash2 className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="w-9 h-9 rounded-xl flex items-center justify-center text-gray-500 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <p className="text-xs text-gray-500 line-clamp-2 italic">“{highlight.anchor.quote}”</p>
      <NoteField id={`note-${highlight._id}`} value={highlight.note || ""} onChange={onChangeNote} autoFocus={focusNote} />
    </div>
  );
};

export default HighlightPopover;
