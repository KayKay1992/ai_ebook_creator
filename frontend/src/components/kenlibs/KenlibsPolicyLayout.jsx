import { motion } from "framer-motion";
import KenlibsNav from "./KenlibsNav";
import KenlibsFooter from "./KenlibsFooter";
import useDocumentTitle from "../../hooks/useDocumentTitle";

// Shared chrome for the three legal pages (Step 42) — same content-page
// shape for Terms/Privacy/Refund Policy so they read as one consistent set
// rather than three independently-styled documents. Genuinely public: no
// route guard, reachable while logged out (see App.jsx).
const KenlibsPolicyLayout = ({ title, lastUpdated, children }) => {
  useDocumentTitle(`${title} — Kenlibs`);

  return (
    <div className="min-h-screen bg-surface-warm">
      <KenlibsNav />
      <div className="max-w-3xl mx-auto px-6 lg:px-8 py-14">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        >
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 tracking-tight">
            {title}
          </h1>
          <p className="text-sm text-gray-400 mt-2">Last updated: {lastUpdated}</p>

          <div className="mt-10 space-y-8 text-gray-700 leading-relaxed [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-gray-900 [&_h2]:mb-2 [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5 [&_ul]:mb-3 [&_a]:text-accent [&_a]:hover:text-accent-hover [&_a]:font-medium [&_strong]:text-gray-900 [&_strong]:font-semibold">
            {children}
          </div>
        </motion.div>
      </div>
      <KenlibsFooter />
    </div>
  );
};

export default KenlibsPolicyLayout;
