import { Outlet } from "react-router-dom";
import KenlibsWhatsAppButton from "./KenlibsWhatsAppButton";

// No longer a theming wrapper (Step 47) — the terracotta/navy/cream
// palette this used to scope via index.css's now-deleted .kenlibs-theme
// rule is the app-wide default, so admin and Kenlibs render identically
// without this. What's left is purely Step 43's reasoning: mounting
// KenlibsWhatsAppButton once here gives every reader-facing route the
// sticky support button for free, including KenlibsReadPage (which
// deliberately skips KenlibsNav/KenlibsFooter for a calmer reading
// surface, but still needs this one persistent affordance) — and admin
// routes, which never render inside this layout, correctly never see it.
const KenlibsThemeLayout = () => (
  <>
    <Outlet />
    <KenlibsWhatsAppButton />
  </>
);

export default KenlibsThemeLayout;
