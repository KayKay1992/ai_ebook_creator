import { Outlet } from "react-router-dom";

// Scopes the terracotta/navy/cream palette override (index.css's
// .kenlibs-theme rule) to every reader-facing route without touching each
// page's own JSX — see index.css's comment on that rule for the full
// reasoning. Purely a CSS-variable-scoping hook: no layout/display
// properties of its own, so it can't affect any child page's own
// min-h-screen/flex chains.
const KenlibsThemeLayout = () => (
  <div className="kenlibs-theme">
    <Outlet />
  </div>
);

export default KenlibsThemeLayout;
