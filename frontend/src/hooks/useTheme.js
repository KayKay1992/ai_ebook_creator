import { useSyncExternalStore } from "react";
import { createThemeStore, readSnapshot } from "../utils/themeStore";

// The reader's theme preference ("system" | "light" | "dark") and what it
// resolves to right now ("light" | "dark"). One shared store for the whole
// app (utils/themeStore.js): every component stays in sync, "system"
// follows the OS live, and a change in another tab is picked up.
const store = typeof window === "undefined" ? null : createThemeStore();

const useTheme = () => {
  const snapshot = useSyncExternalStore(
    store ? store.subscribe : () => () => {},
    store ? store.getSnapshot : () => "system|light",
    () => "system|light"
  );
  return { ...readSnapshot(snapshot), setPreference: store ? store.setPreference : () => {} };
};

export default useTheme;
