// The reader's preferred reading language, remembered per device (one
// choice for all books). "" = the original language. Set from the book
// detail page or the reader; the reader only applies it when the book has
// a published translation in that language, and falls back to the
// original otherwise. Storage can be unavailable (private mode, blocked
// site data), so every access is guarded and failure just means the choice
// isn't remembered.
const STORAGE_KEY = "kenlibs_reading_language";

export const getReadingLanguage = () => {
  try {
    return localStorage.getItem(STORAGE_KEY) || "";
  } catch {
    return "";
  }
};

export const setReadingLanguage = (code) => {
  try {
    if (code) localStorage.setItem(STORAGE_KEY, code);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* not remembered; the current page still uses it */
  }
};
