import React, { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import {
  BookOpen,
  Package,
  ShieldCheck,
  Users,
  BarChart3,
  MessageSquareText,
  LayoutDashboard,
  User,
  Menu,
  X,
  Wallet,
  Briefcase,
  Bug,
  ChevronDown,
  Library,
  Receipt,
  Settings2,
  FileUp,
  HandCoins,
} from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import axiosInstance from "../../utils/axiosInstance";
import { API_PATHS } from "../../utils/apiPaths";
import ProfileDropdown from "./ProfileDropdown";

// Admin destinations, grouped so the header never has to fit (and wrap)
// eight separate links: Catalog / Sales / System are menus on lg+ screens
// and headings in the mobile sidebar. The sidebar also lists Dashboard and
// Profile so it works as a complete menu on its own.
const NAV_GROUPS = [
  {
    id: "catalog",
    label: "Catalog",
    icon: Library,
    items: [
      { to: "/admin/bundles", label: "Bundles", icon: Package },
      { to: "/admin/client-books", label: "Client Books", icon: Briefcase },
      { to: "/admin/import", label: "Import a book", icon: FileUp },
    ],
  },
  {
    id: "sales",
    label: "Sales",
    icon: Receipt,
    items: [
      { to: "/admin/purchases", label: "Purchases", icon: ShieldCheck, badgeKey: "pending" },
      { to: "/admin/analytics", label: "Analytics", icon: BarChart3 },
      { to: "/admin/royalties", label: "Royalties", icon: HandCoins },
      { to: "/admin/reviews", label: "Reviews", icon: MessageSquareText },
      { to: "/admin/payment-settings", label: "Payment Settings", icon: Wallet },
    ],
  },
  {
    id: "system",
    label: "System",
    icon: Settings2,
    items: [
      { to: "/admin/users", label: "Users", icon: Users },
      { to: "/admin/errors", label: "Errors", icon: Bug },
    ],
  },
];
const SIDEBAR_SECTIONS = [
  { id: "main", label: null, items: [{ to: "/dashboard", label: "Dashboard", icon: LayoutDashboard }] },
  ...NAV_GROUPS,
  { id: "account", label: "Account", items: [{ to: "/profile", label: "Profile", icon: User }] },
];

const CountBadge = ({ count, inverted = false }) =>
  count > 0 ? (
    <span
      className={`min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-semibold flex items-center justify-center ${
        inverted ? "bg-white/25 text-white" : "bg-accent text-white"
      }`}
    >
      {count}
    </span>
  ) : null;

// One header menu (Catalog / Sales / System). Opens on click; closes on an
// outside click, Escape (focus back to the button) or choosing a link.
const NavGroupMenu = ({ group, pathname, badges }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const buttonRef = useRef(null);
  const isActive = group.items.some((item) => pathname.startsWith(item.to));
  const groupBadge = group.items.reduce((sum, item) => sum + (badges[item.badgeKey] || 0), 0);
  const Icon = group.icon;

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={`nav-menu-${group.id}`}
        onClick={() => setOpen((v) => !v)}
        className={`relative flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-colors ${
          isActive ? "bg-accent-50 text-accent-hover" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
        }`}
      >
        <Icon className="w-4 h-4" />
        {group.label}
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
        {groupBadge > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-white text-[10px] font-semibold flex items-center justify-center">
            {groupBadge}
          </span>
        )}
      </button>
      {open && (
        <div
          id={`nav-menu-${group.id}`}
          className="absolute right-0 mt-2 w-60 bg-white rounded-2xl border border-gray-100 shadow-xl p-1.5 z-50"
        >
          {group.items.map((item) => {
            const ItemIcon = item.icon;
            const active = pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setOpen(false)}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-colors ${
                  active ? "bg-accent text-white" : "text-gray-700 hover:bg-gray-100"
                }`}
              >
                <ItemIcon className="w-4 h-4 flex-shrink-0" />
                {item.label}
                <span className="ml-auto">
                  <CountBadge count={badges[item.badgeKey] || 0} inverted={active} />
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
};

const DashboardLayout = ({ children }) => {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  // Mobile slide-out sidebar (Step 51) — same sm: breakpoint and toggle
  // convention as KenlibsNav's own mobile menu, for consistency, though the
  // interaction itself is a slide-out overlay rather than KenlibsNav's
  // expanding dropdown, per this step's own spec.
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const dropdownRef = useRef(null);
  const badges = { pending: pendingCount };

  // A single fetch on layout mount (not a polling loop) just to badge the
  // nav link — cheap at this app's scale, and only fires for admins since
  // DashboardLayout is only ever rendered inside AdminRoute.
  useEffect(() => {
    if (user?.role !== "admin") return;
    axiosInstance
      .get(API_PATHS.PURCHASES.ALL)
      .then((res) => {
        setPendingCount(res.data.filter((r) => r.status === "pending").length);
      })
      .catch(() => {});
  }, [user?.role]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setProfileDropdownOpen(false);
      }
    };

    if (profileDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [profileDropdownOpen]);

  // Escape closes the sidebar, same as any other overlay in this app.
  useEffect(() => {
    if (!isSidebarOpen) return;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setIsSidebarOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isSidebarOpen]);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">

            {/* Logo */}
            <Link
              to="/dashboard"
              className="flex items-center gap-2 sm:gap-3 group min-w-0"
            >
              <div className="w-10 h-10 bg-gradient-to-br from-accent to-accent-secondary rounded-2xl flex items-center justify-center shadow-lg shadow-accent-500/20 group-hover:scale-105 transition-transform">
                <BookOpen className="w-5 h-5 text-white" />
              </div>
              <span className="text-lg sm:text-xl font-bold text-gray-900 tracking-tight whitespace-nowrap max-[359px]:sr-only">
                AI Book Creator
              </span>
            </Link>

            {/* Admin nav — grouped menus from lg up; the sidebar below lg. */}
            {user?.role === "admin" && (
              <nav aria-label="Admin" className="hidden lg:flex items-center gap-1">
                {NAV_GROUPS.map((group) => (
                  <NavGroupMenu key={group.id} group={group} pathname={location.pathname} badges={badges} />
                ))}
              </nav>
            )}

            <div className="flex items-center gap-2">
              {/* Mobile hamburger — only ever meaningful for an admin, same
                  as the header menus it replaces below lg:. */}
              {user?.role === "admin" && (
                <button
                  onClick={() => setIsSidebarOpen(true)}
                  className="lg:hidden relative w-10 h-10 rounded-xl flex items-center justify-center text-gray-600 hover:bg-gray-100 transition-colors"
                  aria-label="Open menu"
                >
                  <Menu className="w-5 h-5" />
                  {pendingCount > 0 && <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full bg-accent" />}
                </button>
              )}

              {/* Profile Dropdown */}
              <div ref={dropdownRef}>
                <ProfileDropdown
                  isOpen={profileDropdownOpen}
                  onToggle={(e) => {
                    e.stopPropagation();
                    setProfileDropdownOpen(!profileDropdownOpen);
                  }}
                  avatar={user?.avatar || ""}
                  companyName={user?.name || ""}
                  email={user?.email || ""}
                  onLogout={logout}
                />
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile slide-out sidebar — deliberately NOT AnimatePresence-mounted.
          Framer Motion 13.1.0 + React 19 here never fires AnimatePresence's
          exit-complete unmount (confirmed live: the exit animation finishes
          visually — opacity 0, panel off-screen — but the fixed inset-0 z-50
          overlay stays in the DOM, silently blocking every click on the page
          underneath it, permanently, until a full reload). Same latent bug
          exists in AdminUsersPage's and AdminReviewsPage's confirm modals —
          flagged separately, not fixed here to keep this step's diff
          scoped to the sidebar itself. Sidestepped entirely here: the
          overlay is always mounted, animated purely via `animate` (no
          mount/unmount to track), and `inert` — not just visual hiding —
          removes it from hit-testing, tab order, and the accessibility
          tree whenever closed, so a stalled animation can never leave it
          silently blocking the page. */}
      <div className="lg:hidden fixed inset-0 z-50" inert={!isSidebarOpen}>
        <motion.div
          animate={{ opacity: isSidebarOpen ? 1 : 0 }}
          transition={{ duration: 0.2 }}
          className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          onClick={() => setIsSidebarOpen(false)}
        />
        <motion.div
          animate={{ x: isSidebarOpen ? 0 : "-100%" }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="absolute inset-y-0 left-0 w-72 max-w-[80vw] bg-white shadow-2xl flex flex-col"
        >
          <div className="flex items-center justify-between h-16 px-5 border-b border-gray-100 flex-shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-gradient-to-br from-accent to-accent-secondary rounded-xl flex items-center justify-center">
                <BookOpen className="w-4 h-4 text-white" />
              </div>
              <span className="font-bold text-gray-900">Admin Menu</span>
            </div>
            <button
              onClick={() => setIsSidebarOpen(false)}
              className="w-9 h-9 rounded-xl flex items-center justify-center text-gray-500 hover:bg-gray-100 transition-colors"
              aria-label="Close menu"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <nav aria-label="Admin" className="flex-1 overflow-y-auto px-3 py-4 flex flex-col gap-4">
            {SIDEBAR_SECTIONS.map((section) => (
              <div key={section.id} className="flex flex-col gap-1">
                {section.label && (
                  <p className="px-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">{section.label}</p>
                )}
                {section.items.map((item) => {
                  const isActive = location.pathname.startsWith(item.to);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      onClick={() => setIsSidebarOpen(false)}
                      aria-current={isActive ? "page" : undefined}
                      className={`relative flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
                        isActive ? "bg-accent text-white" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                      }`}
                    >
                      <Icon className="w-4 h-4 flex-shrink-0" />
                      {item.label}
                      <span className="ml-auto">
                        <CountBadge count={badges[item.badgeKey] || 0} inverted={isActive} />
                      </span>
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
        </motion.div>
      </div>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
        {children}
      </main>
    </div>
  );
};

export default DashboardLayout;
