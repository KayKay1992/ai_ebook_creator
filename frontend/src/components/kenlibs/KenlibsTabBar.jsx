import { Link } from "react-router-dom";
import { BookOpen, Home, User } from "lucide-react";
import { activeTab, TAB_BAR_HEIGHT } from "../../utils/kenlibsTabBar";

// Phone-only bottom tab bar (below the sm breakpoint) on storefront pages
// (see utils/kenlibsTabBar.js for exactly which). Mounted by
// KenlibsThemeLayout, which also reserves the same height (plus the
// safe-area inset) at the bottom of the page so nothing ends up hidden
// behind it, and lifts the WhatsApp button above it. Library is My Books;
// Profile is the reader profile (ReaderRoute sends signed-out visitors to
// log in first).
const TABS = [
  { key: "home", to: "/kenlibs", label: "Home", Icon: Home },
  { key: "library", to: "/kenlibs/my-books", label: "Library", Icon: BookOpen },
  { key: "profile", to: "/kenlibs/profile", label: "Profile", Icon: User },
];

const KenlibsTabBar = ({ pathname }) => {
  const current = activeTab(pathname);
  return (
    <nav
      aria-label="Kenlibs"
      className="sm:hidden fixed inset-x-0 bottom-0 z-40 bg-surface-warm/95 backdrop-blur border-t border-gray-200"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="flex" style={{ height: TAB_BAR_HEIGHT }}>
        {TABS.map(({ key, to, label, Icon }) => {
          const isActive = current === key;
          return (
            <li key={key} className="flex-1">
              <Link
                to={to}
                aria-current={isActive ? "page" : undefined}
                className={`h-full flex flex-col items-center justify-center gap-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent rounded-xl ${
                  isActive ? "text-accent-hover" : "text-gray-500 hover:text-gray-800"
                }`}
              >
                <Icon className={`w-[22px] h-[22px] ${isActive ? "text-accent" : ""}`} strokeWidth={isActive ? 2.2 : 1.8} aria-hidden="true" />
                <span className="font-rounded text-xs font-bold leading-none">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};

export default KenlibsTabBar;
