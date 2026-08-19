import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { BookOpen, Menu, X } from "lucide-react";
import { useAuth } from "../../context/AuthContext";

// Deliberately separate from the admin Navbar/DashboardLayout — Kenlibs is
// the reader-facing surface (see KENLIBS-ARCHITECTURE.md section 1): a
// visitor here should never see admin chrome or admin nav links.
const KenlibsNav = () => {
  const { isAuthenticated, user, logout } = useAuth();
  const location = useLocation();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const isMyBooksActive = location.pathname.startsWith("/kenlibs/my-books");

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-gray-100">
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link to="/kenlibs" className="flex items-center gap-2.5 group">
            <div className="w-9 h-9 bg-gradient-to-r from-accent to-accent-secondary rounded-xl flex items-center justify-center text-white shadow-lg shadow-accent-500/30 transition-transform group-hover:scale-105">
              <BookOpen className="w-5 h-5" />
            </div>
            <span className="text-xl font-semibold text-gray-900 tracking-tight">
              Kenlibs
            </span>
          </Link>

          {/* Desktop links */}
          <div className="hidden sm:flex items-center gap-2">
            {isAuthenticated ? (
              <>
                <Link
                  to="/kenlibs/my-books"
                  className="relative px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors"
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
                <button
                  onClick={logout}
                  className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors"
                >
                  {user?.name?.split(" ")[0] || "Account"} · Log out
                </button>
              </>
            ) : (
              <Link
                to="/kenlibs/login"
                className="px-5 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors"
              >
                Login
              </Link>
            )}
          </div>

          {/* Mobile toggle */}
          <button
            onClick={() => setIsMobileOpen((open) => !open)}
            className="sm:hidden w-10 h-10 rounded-xl flex items-center justify-center text-gray-600 hover:bg-gray-100 transition-colors"
            aria-label="Toggle menu"
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={isMobileOpen ? "close" : "open"}
                initial={{ opacity: 0, rotate: -45 }}
                animate={{ opacity: 1, rotate: 0 }}
                exit={{ opacity: 0, rotate: 45 }}
                transition={{ duration: 0.15 }}
              >
                {isMobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </motion.span>
            </AnimatePresence>
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      <AnimatePresence>
        {isMobileOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="sm:hidden overflow-hidden border-t border-gray-100"
          >
            <div className="px-6 py-4 flex flex-col gap-1">
              {isAuthenticated ? (
                <>
                  <Link
                    to="/kenlibs/my-books"
                    onClick={() => setIsMobileOpen(false)}
                    className={`px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
                      isMyBooksActive
                        ? "bg-accent-50 text-accent-hover"
                        : "text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    My Books
                  </Link>
                  <button
                    onClick={() => {
                      setIsMobileOpen(false);
                      logout();
                    }}
                    className="text-left px-4 py-3 rounded-xl text-sm font-medium text-gray-500 hover:bg-gray-50 transition-colors"
                  >
                    {user?.name?.split(" ")[0] || "Account"} · Log out
                  </button>
                </>
              ) : (
                <Link
                  to="/kenlibs/login"
                  onClick={() => setIsMobileOpen(false)}
                  className="px-4 py-3 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Login
                </Link>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
};

export default KenlibsNav;
