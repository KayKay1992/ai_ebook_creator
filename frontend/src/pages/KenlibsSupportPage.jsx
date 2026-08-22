import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Mail, MessageCircle, KeyRound, ReceiptText, ShieldCheck, FileText } from "lucide-react";
import KenlibsNav from "../components/kenlibs/KenlibsNav";
import KenlibsFooter from "../components/kenlibs/KenlibsFooter";
import { SUPPORT_EMAIL, SUPPORT_WHATSAPP_DISPLAY, buildWhatsAppHref } from "../utils/kenlibsSupport";
import useDocumentTitle from "../hooks/useDocumentTitle";

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] } },
};

// Common-question pointers to the pages that already answer them, rather
// than duplicating that content here — Refund Policy (Step 41) and the
// forgot-password flow (Step 40) already exist and are the actual source of
// truth for each.
const COMMON_QUESTIONS = [
  {
    icon: ReceiptText,
    question: "Payment evidence rejected?",
    description: "See what happens next and how to resubmit.",
    to: "/kenlibs/refund-policy",
    linkLabel: "Read the Refund Policy",
  },
  {
    icon: KeyRound,
    question: "Forgot your password?",
    description: "Reset it yourself in a couple of minutes.",
    to: "/kenlibs/forgot-password",
    linkLabel: "Reset your password",
  },
  {
    icon: FileText,
    question: "Wondering how purchases work?",
    description: "Access, evidence review, and what you're actually buying.",
    to: "/kenlibs/terms",
    linkLabel: "Read the Terms of Service",
  },
  {
    icon: ShieldCheck,
    question: "Curious what data we collect?",
    description: "What we store, how it's used, and who (if anyone) sees it.",
    to: "/kenlibs/privacy",
    linkLabel: "Read the Privacy Policy",
  },
];

const KenlibsSupportPage = () => {
  useDocumentTitle("Support — Kenlibs");

  return (
    <div className="min-h-screen bg-surface-warm">
      <KenlibsNav />
      <div className="max-w-3xl mx-auto px-6 lg:px-8 py-14">
        <motion.div initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.08 } } }}>
          <motion.div variants={fadeUp}>
            <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 tracking-tight">
              How can we help?
            </h1>
            <p className="text-gray-500 mt-3 max-w-lg">
              Kenlibs is a small, manually-run bookstore — if something's
              wrong with your account, a purchase, or a book, a real person
              reads every message. Reach out directly, or check the common
              questions below first.
            </p>
          </motion.div>

          {/* Contact — same details as KenlibsFooter, just given real
              presence on their own dedicated page. */}
          <motion.div
            variants={fadeUp}
            className="mt-8 bg-white rounded-3xl border border-gray-100 shadow-sm p-6 sm:p-8 flex flex-col sm:flex-row gap-4"
          >
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="flex-1 flex items-center gap-3 rounded-2xl border border-gray-100 px-5 py-4 hover:border-accent-200 hover:bg-accent-50/40 transition-colors"
            >
              <div className="w-10 h-10 rounded-xl bg-accent-50 flex items-center justify-center flex-shrink-0">
                <Mail className="w-5 h-5 text-accent" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900">Email</p>
                <p className="text-sm text-gray-500 truncate">{SUPPORT_EMAIL}</p>
              </div>
            </a>

            <a
              href={buildWhatsAppHref("Hi, I have a question about Kenlibs.")}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 flex items-center gap-3 rounded-2xl border border-gray-100 px-5 py-4 hover:border-accent-200 hover:bg-accent-50/40 transition-colors"
            >
              <div className="w-10 h-10 rounded-xl bg-accent-50 flex items-center justify-center flex-shrink-0">
                <MessageCircle className="w-5 h-5 text-accent" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900">WhatsApp</p>
                <p className="text-sm text-gray-500 truncate">{SUPPORT_WHATSAPP_DISPLAY}</p>
              </div>
            </a>
          </motion.div>

          {/* Common questions */}
          <motion.div variants={fadeUp} className="mt-10">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">
              Common questions
            </h2>
            <div className="grid sm:grid-cols-2 gap-4">
              {COMMON_QUESTIONS.map(({ icon: Icon, question, description, to, linkLabel }) => (
                <Link
                  key={to}
                  to={to}
                  className="group bg-white rounded-2xl border border-gray-100 shadow-sm p-5 hover:border-accent-200 hover:shadow-md transition-all"
                >
                  <div className="w-9 h-9 rounded-xl bg-accent-50 flex items-center justify-center mb-3">
                    <Icon className="w-4 h-4 text-accent" />
                  </div>
                  <p className="font-semibold text-gray-900">{question}</p>
                  <p className="text-sm text-gray-500 mt-1">{description}</p>
                  <p className="text-sm font-medium text-accent group-hover:text-accent-hover mt-3">
                    {linkLabel} →
                  </p>
                </Link>
              ))}
            </div>
          </motion.div>
        </motion.div>
      </div>
      <KenlibsFooter />
    </div>
  );
};

export default KenlibsSupportPage;
