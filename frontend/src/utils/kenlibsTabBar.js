// Which pages show the phone tab bar (components/kenlibs/KenlibsTabBar.jsx)
// and which tab is active there. Pure (npm test).
//
// Shown on the storefront and the reader's own account pages; never on the
// reader (/kenlibs/read/*, /read/*), checkout, sign-in/sign-up/password
// pages, or anything admin.
const TAB_BAR_PATHS = [
  /^\/kenlibs\/?$/,
  /^\/kenlibs\/book\/[^/]+\/?$/,
  /^\/kenlibs\/bundle\/[^/]+\/?$/,
  /^\/kenlibs\/my-books\/?$/,
  /^\/kenlibs\/referrals\/?$/,
  /^\/kenlibs\/profile\/?$/,
  /^\/kenlibs\/support\/?$/,
  /^\/kenlibs\/(terms|privacy|refund-policy)\/?$/,
];

export const showsTabBar = (pathname = "") => TAB_BAR_PATHS.some((pattern) => pattern.test(pathname));

// "home" | "library" | "profile" | null
export const activeTab = (pathname = "") => {
  if (/^\/kenlibs\/my-books\/?$/.test(pathname)) return "library";
  if (/^\/kenlibs\/(profile|referrals)\/?$/.test(pathname)) return "profile";
  if (/^\/kenlibs(\/(book|bundle)\/[^/]+)?\/?$/.test(pathname)) return "home";
  return null;
};

// Height of the bar itself (px), not counting the phone's safe-area inset.
export const TAB_BAR_HEIGHT = 64;
