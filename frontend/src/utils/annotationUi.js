// Shared constants for the reader's highlight UI (kept out of the component
// files so React Fast Refresh keeps working).

// Swatch classes per highlight color; the in-text colors are the matching
// ::highlight(kenlibs-hl-<color>) rules in index.css.
export const COLOR_STYLES = {
  yellow: "bg-yellow-300",
  green: "bg-green-300",
  blue: "bg-blue-300",
  pink: "bg-pink-300",
};

export const TOOLBAR_WIDTH = 288;
export const POPOVER_WIDTH = 300;

// Mirror backend/models/ReaderAnnotation.js.
export const NOTE_MAX_LENGTH = 1000;
export const LABEL_MAX_LENGTH = 120;
