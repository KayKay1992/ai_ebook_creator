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
} from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import axiosInstance from "../../utils/axiosInstance";
import { API_PATHS } from "../../utils/apiPaths";
import ProfileDropdown from "./ProfileDropdown";

// Same set of destinations as the desktop "Admin nav" div below, plus
// Dashboard (currently only reachable via the logo) and Profile (currently
// only reachable via ProfileDropdown) — a slide-out sidebar is expected to
// be a complete, self-sufficient nav menu on its own, not assume the
// reader also spots the logo or opens the separate profile menu.
const NAV_ITEMS = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/admin/bundles", label: "Bundles", icon: Package },
  { to: "/admin/purchases", label: "Purchases", icon: ShieldCheck, badgeKey: "pending" },
  { to: "/admin/users", label: "Users", icon: Users },
  { to: "/admin/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/admin/reviews", label: "Reviews", icon: MessageSquareText },
  { to: "/profile", label: "Profile", icon: User },
];

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
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">

            {/* Logo */}
            <Link
              to="/dashboard"
              className="flex items-center gap-3 group"
            >
              <div className="w-10 h-10 bg-gradient-to-br from-accent to-accent-secondary rounded-2xl flex items-center justify-center shadow-lg shadow-accent-500/20 group-hover:scale-105 transition-transform">
                <BookOpen className="w-5 h-5 text-white" />
              </div>
              <span className="text-xl font-bold text-gray-900 tracking-tight">
                AI Book Creator
              </span>
            </Link>

            {/* Admin nav — desktop, unchanged */}
            <div className="hidden sm:flex items-center gap-1">
              {user?.role === "admin" && (
                <Link
                  to="/admin/bundles"
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
                >
                  <Package className="w-4 h-4" />
                  Bundles
                </Link>
              )}
              {user?.role === "admin" && (
                <Link
                  to="/admin/purchases"
                  className="relative flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
                >
                  <ShieldCheck className="w-4 h-4" />
                  Purchases
                  {pendingCount > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-white text-[10px] font-semibold flex items-center justify-center">
                      {pendingCount}
                    </span>
                  )}
                </Link>
              )}
              {user?.role === "admin" && (
                <Link
                  to="/admin/users"
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
                >
                  <Users className="w-4 h-4" />
                  Users
                </Link>
              )}
              {user?.role === "admin" && (
                <Link
                  to="/admin/analytics"
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
                >
                  <BarChart3 className="w-4 h-4" />
                  Analytics
                </Link>
              )}
              {user?.role === "admin" && (
                <Link
                  to="/admin/reviews"
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
                >
                  <MessageSquareText className="w-4 h-4" />
                  Reviews
                </Link>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* Mobile hamburger — only ever meaningful for an admin, same
                  as the desktop links it replaces below sm:. */}
              {user?.role === "admin" && (
                <button
                  onClick={() => setIsSidebarOpen(true)}
                  className="sm:hidden w-10 h-10 rounded-xl flex items-center justify-center text-gray-600 hover:bg-gray-100 transition-colors"
                  aria-label="Open menu"
                >
                  <Menu className="w-5 h-5" />
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
      <div className="sm:hidden fixed inset-0 z-50" inert={!isSidebarOpen}>
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

          <nav className="flex-1 overflow-y-auto px-3 py-4 flex flex-col gap-1">
            {NAV_ITEMS.map((item) => {
              const isActive = location.pathname.startsWith(item.to);
              const Icon = item.icon;
              const badgeCount = item.badgeKey === "pending" ? pendingCount : 0;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setIsSidebarOpen(false)}
                  className={`relative flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-accent text-white"
                      : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                  }`}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  {item.label}
                  {badgeCount > 0 && (
                    <span
                      className={`ml-auto min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-semibold flex items-center justify-center ${
                        isActive ? "bg-white/25 text-white" : "bg-accent text-white"
                      }`}
                    >
                      {badgeCount}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </motion.div>
      </div>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 lg:px-8 py-10">
        {children}
      </main>
    </div>
  );
};

export default DashboardLayout;
