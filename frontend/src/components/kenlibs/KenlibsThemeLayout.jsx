import { Outlet, useLocation } from "react-router-dom";
import KenlibsWhatsAppButton from "./KenlibsWhatsAppButton";
import KenlibsTabBar from "./KenlibsTabBar";
import { showsTabBar, TAB_BAR_HEIGHT } from "../../utils/kenlibsTabBar";

// No longer a theming wrapper (Step 47) — the terracotta/navy/cream
// palette this used to scope via index.css's now-deleted .kenlibs-theme
// rule is the app-wide default, so admin and Kenlibs render identically
// without this. What's left is purely Step 43's reasoning: mounting
// KenlibsWhatsAppButton once here gives every reader-facing route the
// sticky support button for free, including KenlibsReadPage (which
// deliberately skips KenlibsNav/KenlibsFooter for a calmer reading
// surface, but still needs this one persistent affordance) — and admin
// routes, which never render inside this layout, correctly never see it.
//
// The gated reader (/kenlibs/read/...) is the exception: it puts this
// button in its own floating-button dock with the notepad button (so the
// two never overlap the chapter's Previous/Next buttons), so the
// free-floating copy is skipped there.
//
// Phones (below sm) also get the bottom tab bar on storefront pages
// (utils/kenlibsTabBar.js). Following the floating-controls rule, the page
// reserves the bar's height plus the safe-area inset at its end (the
// spacer below), so the footer and the last content scroll clear of it,
// and the WhatsApp button rides above it.
const KenlibsThemeLayout = () => {
  const { pathname } = useLocation();
  const readerHasItsOwn = pathname.startsWith("/kenlibs/read/");
  const withTabBar = showsTabBar(pathname);
  return (
    <>
      <Outlet />
      {withTabBar && (
        <>
          <div
            className="sm:hidden"
            style={{ height: `calc(${TAB_BAR_HEIGHT}px + env(safe-area-inset-bottom))` }}
            aria-hidden="true"
          />
          <KenlibsTabBar pathname={pathname} />
        </>
      )}
      {!readerHasItsOwn && <KenlibsWhatsAppButton aboveTabBar={withTabBar} />}
    </>
  );
};

export default KenlibsThemeLayout;
