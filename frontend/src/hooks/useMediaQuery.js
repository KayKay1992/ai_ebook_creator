import { useSyncExternalStore } from "react";

// True while the CSS media query matches; updates on resize/rotation.
// Correct on the very first render (no flash of the wrong layout).
const useMediaQuery = (query) =>
  useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false
  );

export default useMediaQuery;
