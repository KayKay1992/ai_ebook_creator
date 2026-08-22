import { Outlet } from "react-router-dom";
import KenlibsWhatsAppButton from "./KenlibsWhatsAppButton";

// Scopes the terracotta/navy/cream palette override (index.css's
// .kenlibs-theme rule) to every reader-facing route without touching each
// page's own JSX — see index.css's comment on that rule for the full
// reasoning. Also mounts KenlibsWhatsAppButton here (Step 43) for the same
// reason: every route this layout wraps gets the sticky support button for
// free, including KenlibsReadPage (which deliberately skips KenlibsNav/
// KenlibsFooter for a calmer reading surface, but still needs this one
// persistent affordance) — and admin routes, which never render inside this
// layout, correctly never see it.
const KenlibsThemeLayout = () => (
  <div className="kenlibs-theme">
    <Outlet />
    <KenlibsWhatsAppButton />
  </div>
);

export default KenlibsThemeLayout;
