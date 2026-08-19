import { useEffect } from "react";

// Overrides the browser tab title while the calling page is mounted, then
// restores whatever it was before. index.html's static <title> is the
// shared default for the whole app (admin pages included) and deliberately
// stays untouched — only Kenlibs pages call this, so admin tab titles never
// change.
const useDocumentTitle = (title) => {
  useEffect(() => {
    if (!title) return;
    const previousTitle = document.title;
    document.title = title;
    return () => {
      document.title = previousTitle;
    };
  }, [title]);
};

export default useDocumentTitle;
