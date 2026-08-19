import { Link } from "react-router-dom";
import { BookOpen } from "lucide-react";

// Deliberately separate from the admin Navbar/DashboardLayout — Kenlibs is
// the reader-facing surface (see KENLIBS-ARCHITECTURE.md section 1): a
// visitor here should never see admin chrome or admin nav links.
const KenlibsNav = () => (
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

        {/* /kenlibs/login doesn't exist yet — lands in Step 26 (reader auth).
            Left as a real link now per that step's own plan. */}
        <Link
          to="/kenlibs/login"
          className="px-5 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors"
        >
          Login
        </Link>
      </div>
    </div>
  </header>
);

export default KenlibsNav;
