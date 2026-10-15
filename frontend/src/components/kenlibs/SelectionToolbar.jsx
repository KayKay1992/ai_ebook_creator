import { useEffect, useRef } from "react";
import { Copy, NotebookPen, Sparkles, X } from "lucide-react";
import { COLOR_STYLES, TOOLBAR_WIDTH } from "../../utils/annotationUi";

// Floating toolbar for a text selection in the reader: highlight in one of
// four colors, highlight + add a note, copy, or explain (the word/phrase
// explanation popup, which no longer opens by itself on every selection).
// Buttons keep the selection alive on mouse down so the action still sees
// it; Escape closes the toolbar.

const keepSelection = (e) => e.preventDefault();

const SelectionToolbar = ({ position, canHighlight, canExplain, onHighlight, onNote, onCopy, onExplain, onClose }) => {
  const toolbarRef = useRef(null);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const button = "w-9 h-9 rounded-xl flex items-center justify-center text-gray-700 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <div
      ref={toolbarRef}
      role="toolbar"
      aria-label="Selected text"
      className="fixed z-50 flex items-center gap-1 rounded-2xl bg-white border border-gray-200 shadow-xl px-2 py-1.5"
      style={{ top: position.top, left: position.left, width: TOOLBAR_WIDTH }}
      onMouseDown={keepSelection}
    >
      {Object.entries(COLOR_STYLES).map(([color, swatch]) => (
        <button
          key={color}
          type="button"
          onClick={() => onHighlight(color)}
          disabled={!canHighlight}
          className={button}
          title={canHighlight ? `Highlight ${color}` : "Highlights are unavailable right now"}
          aria-label={`Highlight ${color}`}
        >
          <span className={`w-5 h-5 rounded-full ${swatch} ring-1 ring-black/10`} />
        </button>
      ))}
      <span className="w-px h-6 bg-gray-200 mx-0.5" aria-hidden="true" />
      <button type="button" onClick={onNote} disabled={!canHighlight} className={button} title="Highlight and add a note" aria-label="Add a note">
        <NotebookPen className="w-4 h-4" />
      </button>
      <button type="button" onClick={onCopy} className={button} title="Copy" aria-label="Copy">
        <Copy className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={onExplain}
        disabled={!canExplain}
        className={button}
        title={canExplain ? "Explain this" : "Select a word or short phrase to explain it"}
        aria-label="Explain"
      >
        <Sparkles className="w-4 h-4" />
      </button>
      <button type="button" onClick={onClose} className={`${button} ml-auto`} title="Close" aria-label="Close">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

export default SelectionToolbar;
