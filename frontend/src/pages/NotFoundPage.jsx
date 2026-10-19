import { Link, useLocation } from "react-router-dom";
import { Home, Search } from "lucide-react";
import KenlibsNav from "../components/kenlibs/KenlibsNav";
import KenlibsFooter from "../components/kenlibs/KenlibsFooter";
import useDocumentTitle from "../hooks/useDocumentTitle";

// Any URL no route matches (App.jsx's catch-all, inside the Kenlibs
// layout). Branded and theme-aware like every reader page: utils/theme.js
// counts unknown paths as reader-facing, so dark mode applies before first
// paint. "Search books" opens the storefront with its search focused.
const NotFoundPage = () => {
  useDocumentTitle("Page not found — Kenlibs");
  const { pathname } = useLocation();
  return (
    <div className="min-h-screen bg-surface-warm flex flex-col">
      <KenlibsNav />
      <main className="flex-1 bg-gradient-to-b from-forest-deep to-forest-deeper">
        <div className="max-w-2xl mx-auto px-5 sm:px-6 py-16 sm:py-24 text-center">
          <p className="font-rounded font-extrabold text-accent-on-dark text-sm tracking-widest uppercase">Error 404</p>
          <h1 className="font-headline font-extrabold text-white text-4xl sm:text-5xl tracking-tight mt-3 [font-variation-settings:'SOFT'_100]">
            Page not found
          </h1>
          <p className="text-white/85 mt-4 text-lg">
            We couldn't find <span className="break-all font-mono text-base text-white">{pathname}</span>. It may have moved, or the link
            may be mistyped.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              to="/kenlibs"
              state={{ focusSearch: true }}
              className="inline-flex items-center gap-2 min-h-[48px] px-6 rounded-full bg-accent text-white font-semibold hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-forest-deep"
            >
              <Search className="w-4 h-4" aria-hidden="true" />
              Search books
            </Link>
            <Link
              to="/kenlibs"
              className="inline-flex items-center gap-2 min-h-[48px] px-6 rounded-full bg-white/10 text-white font-semibold hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <Home className="w-4 h-4" aria-hidden="true" />
              Home
            </Link>
          </div>
        </div>
      </main>
      <KenlibsFooter />
    </div>
  );
};

export default NotFoundPage;
