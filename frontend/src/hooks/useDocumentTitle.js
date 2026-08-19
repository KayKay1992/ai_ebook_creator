import { useEffect } from "react";

// Overrides the browser tab title while the calling page is mounted, then
// restores whatever it was before. Used for a more specific title on
// Kenlibs pages (e.g. "The Almagedon — Kenlibs") than index.html's static
// "Kenlibs" default, which every other page (admin included) still falls
// back to unchanged.
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
