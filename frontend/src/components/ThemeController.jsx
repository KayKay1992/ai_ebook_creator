import { useLayoutEffect } from "react";
import { useLocation } from "react-router-dom";
import useTheme from "../hooks/useTheme";
import { applyThemeToDocument, appliedTheme } from "../utils/theme";

// Mounted once (App.jsx). Keeps <html data-theme> in step with the
// preference, the OS setting and the route: dark only on reader-facing
// routes, so moving to an admin page drops back to light. index.html's
// inline script does the same once before first paint.
const ThemeController = () => {
  const { pathname } = useLocation();
  const { preference, theme } = useTheme();
  useLayoutEffect(() => {
    applyThemeToDocument(pathname, appliedTheme(pathname, preference, theme === "dark"));
  }, [pathname, preference, theme]);
  return null;
};

export default ThemeController;
