import { Link } from "react-router-dom";
import { Mail, MessageCircle, BookOpen } from "lucide-react";

const SUPPORT_EMAIL = "kennethnwankpa92@yahoo.com";
const SUPPORT_WHATSAPP_DISPLAY = "+234 810 310 8267";
const SUPPORT_WHATSAPP_HREF = "https://wa.me/2348103108267";

// Rendered at the bottom of every reader-facing Kenlibs page that already
// renders KenlibsNav (Step 42) — a navy "bookend" to match the nav's own
// structural color (Step 39), carrying the legal links and support contact
// this step adds. Deliberately not rendered on KenlibsReadPage — that
// surface stays calm/uninterrupted per Step 31's reading-experience
// philosophy, same reasoning as why it skips KenlibsNav too.
const KenlibsFooter = () => (
  <footer className="bg-accent-secondary text-white/70">
    <div className="max-w-7xl mx-auto px-6 lg:px-8 py-10">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-8">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-accent rounded-lg flex items-center justify-center text-white flex-shrink-0">
            <BookOpen className="w-4 h-4" />
          </div>
          <span className="text-white font-semibold">Kenlibs</span>
        </div>

        <div className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
          <Link to="/kenlibs/terms" className="hover:text-white transition-colors">
            Terms of Service
          </Link>
          <Link to="/kenlibs/privacy" className="hover:text-white transition-colors">
            Privacy Policy
          </Link>
          <Link to="/kenlibs/refund-policy" className="hover:text-white transition-colors">
            Refund Policy
          </Link>
        </div>

        <div className="flex flex-col gap-2 text-sm">
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="flex items-center gap-2 hover:text-white transition-colors"
          >
            <Mail className="w-4 h-4 flex-shrink-0" />
            {SUPPORT_EMAIL}
          </a>
          <a
            href={SUPPORT_WHATSAPP_HREF}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 hover:text-white transition-colors"
          >
            <MessageCircle className="w-4 h-4 flex-shrink-0" />
            {SUPPORT_WHATSAPP_DISPLAY}
          </a>
        </div>
      </div>

      <div className="mt-8 pt-6 border-t border-white/10 text-xs text-white/50">
        © {new Date().getFullYear()} Kenlibs. All rights reserved.
      </div>
    </div>
  </footer>
);

export default KenlibsFooter;
export { SUPPORT_EMAIL, SUPPORT_WHATSAPP_DISPLAY, SUPPORT_WHATSAPP_HREF };
