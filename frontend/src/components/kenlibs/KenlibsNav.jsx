import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { BookOpen, LifeBuoy, Menu, X } from "lucide-react";
import { useAuth } from "../../context/AuthContext";

// Deliberately separate from the admin Navbar/DashboardLayout — Kenlibs is
// the reader-facing surface (see KENLIBS-ARCHITECTURE.md section 1): a
// visitor here should never see admin chrome or admin nav links.
const KenlibsNav = () => {
  const { isAuthenticated, user, logout } = useAuth();
  const location = useLocation();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const isMyBooksActive = location.pathname.startsWith("/kenlibs/my-books");
  const isReferralsActive = location.pathname.startsWith("/kenlibs/referrals");

  return (
    <header className="sticky top-0 z-40 bg-accent-secondary border-b-2 border-accent">
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link to="/kenlibs" className="flex items-center gap-2.5 group">
            <div className="w-9 h-9 bg-accent rounded-xl flex items-center justify-center text-white shadow-lg shadow-black/20 transition-transform group-hover:scale-105">
              <BookOpen className="w-5 h-5" />
            </div>
            <span className="text-xl font-semibold text-white tracking-tight">
              Kenlibs
            </span>
          </Link>

          {/* Desktop links */}
          <div className="hidden sm:flex items-center gap-2">
            <Link
              to="/kenlibs/support"
              title="Support"
              className="w-9 h-9 rounded-xl flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            >
              <LifeBuoy className="w-4 h-4" />
            </Link>
            {isAuthenticated ? (
              <>
                <Link
                  to="/kenlibs/my-books"
                  className="relative px-4 py-2 text-sm font-medium text-white/80 hover:text-white transition-colors"
                >
                  My Books
                  {isMyBooksActive && (
                    <motion.span
                      layoutId="kenlibs-nav-active"
                      className="absolute left-4 right-4 -bottom-[1px] h-0.5 bg-accent rounded-full"
                      transition={{ type: "spring", stiffness: 500, damping: 35 }}
                    />
                  )}
                </Link>
                <Link
                  to="/kenlibs/referrals"
                  className="relative px-4 py-2 text-sm font-medium text-white/80 hover:text-white transition-colors"
                >
                  Referrals
                  {isReferralsActive && (
                    <motion.span
                      layoutId="kenlibs-nav-active"
                      className="absolute left-4 right-4 -bottom-[1px] h-0.5 bg-accent rounded-full"
                      transition={{ type: "spring", stiffness: 500, damping: 35 }}
                    />
                  )}
                </Link>
                <button
                  onClick={logout}
                  className="px-4 py-2 text-sm font-medium text-white/60 hover:text-white transition-colors"
                >
                  {user?.name?.split(" ")[0] || "Account"} · Log out
                </button>
              </>
            ) : (
              <Link
                to="/kenlibs/login"
                className="px-5 py-2 rounded-xl text-sm font-semibold text-white bg-accent hover:bg-accent-hover transition-colors"
              >
                Login
              </Link>
            )}
          </div>

          {/* Mobile toggle */}
          <button
            onClick={() => setIsMobileOpen((open) => !open)}
            className="sm:hidden w-10 h-10 rounded-xl flex items-center justify-center text-white/80 hover:bg-white/10 transition-colors"
            aria-label="Toggle menu"
          >
            {/* No AnimatePresence/exit here (Step 52 audit) — dropping the
                exit half of the crossfade removes any risk of a stuck
                unmount without giving up much: the new icon still fades
                and rotates in on every toggle, it just doesn't also fade
                the old one out first. */}
            <motion.span
              key={isMobileOpen ? "close" : "open"}
              initial={{ opacity: 0, rotate: -45 }}
              animate={{ opacity: 1, rotate: 0 }}
              transition={{ duration: 0.15 }}
            >
              {isMobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </motion.span>
          </button>
        </div>
      </div>

      {/* Mobile menu — always mounted, animated via `animate` only + `inert`
          when closed, not AnimatePresence-conditional mounting (Step 52
          audit: see DashboardLayout.jsx's original fix for the full story
          on why AnimatePresence's exit-complete unmount isn't reliable
          here). This one is in-flow rather than a fixed overlay, so a
          stuck exit wouldn't block clicks elsewhere on the page the way a
          fixed overlay would — fixed anyway, for the same reason as every
          other instance in this audit: correctness, not just risk level. */}
      <motion.div
        animate={{ height: isMobileOpen ? "auto" : 0, opacity: isMobileOpen ? 1 : 0 }}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        className="sm:hidden overflow-hidden border-t border-white/10"
        inert={!isMobileOpen}
      >
        <div className="px-6 py-4 flex flex-col gap-1">
          <Link
            to="/kenlibs/support"
            onClick={() => setIsMobileOpen(false)}
            className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium text-white/80 hover:bg-white/10 transition-colors"
          >
            <LifeBuoy className="w-4 h-4" />
            Support
          </Link>
          {isAuthenticated ? (
            <>
              <Link
                to="/kenlibs/my-books"
                onClick={() => setIsMobileOpen(false)}
                className={`px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
                  isMyBooksActive
                    ? "bg-accent text-white"
                    : "text-white/80 hover:bg-white/10"
                }`}
              >
                My Books
              </Link>
              <Link
                to="/kenlibs/referrals"
                onClick={() => setIsMobileOpen(false)}
                className={`px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
                  isReferralsActive
                    ? "bg-accent text-white"
                    : "text-white/80 hover:bg-white/10"
                }`}
              >
                Referrals
              </Link>
              <button
                onClick={() => {
                  setIsMobileOpen(false);
                  logout();
                }}
                className="text-left px-4 py-3 rounded-xl text-sm font-medium text-white/60 hover:bg-white/10 transition-colors"
              >
                {user?.name?.split(" ")[0] || "Account"} · Log out
              </button>
            </>
          ) : (
            <Link
              to="/kenlibs/login"
              onClick={() => setIsMobileOpen(false)}
              className="px-4 py-3 rounded-xl text-sm font-semibold text-white bg-accent hover:bg-accent-hover transition-colors"
            >
              Login
            </Link>
          )}
        </div>
      </motion.div>
    </header>
  );
};

export default KenlibsNav;
