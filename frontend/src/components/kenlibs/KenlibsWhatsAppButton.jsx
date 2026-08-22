import { motion } from "framer-motion";
import { MessageCircle } from "lucide-react";
import { buildWhatsAppHref } from "../../utils/kenlibsSupport";

// Persistent support affordance (Step 43) — rendered once, from
// KenlibsThemeLayout, so it reaches every reader-facing page including
// KenlibsReadPage without needing per-page wiring, and stays out of admin
// pages "for free" since KenlibsThemeLayout never wraps those (same scoping
// as the Step 39 palette).
//
// Positioned at bottom-24 right-6 rather than the more common bottom-6
// right-6 specifically because KenlibsReadPage already has a notepad toggle
// FAB sitting at bottom-6 right-6 (w-14 h-14) — stacking directly on top of
// it would either hide one button or force a route-aware conditional here.
// Sitting one "slot" higher, as a smaller w-12 h-12 button, leaves a clean
// 16px gap above the notepad button on that page, and still reads as "the
// bottom-right corner" on every other page where nothing else is there.
// Uses the Step 39 terracotta accent rather than WhatsApp's own green — a
// third, unrelated brand color would clash with this app's deliberately
// narrow navy/terracotta/cream palette.
const KenlibsWhatsAppButton = () => (
  <motion.a
    href={buildWhatsAppHref("Hi, I have a question about Kenlibs.")}
    target="_blank"
    rel="noopener noreferrer"
    initial={{ opacity: 0, scale: 0.8 }}
    animate={{ opacity: 1, scale: 1 }}
    transition={{ delay: 0.3, type: "spring", stiffness: 300, damping: 22 }}
    whileHover={{ scale: 1.06 }}
    whileTap={{ scale: 0.94 }}
    className="fixed bottom-24 right-6 z-40 w-12 h-12 rounded-full bg-accent text-white shadow-lg shadow-accent-500/30 flex items-center justify-center"
    title="Chat with us on WhatsApp"
    aria-label="Chat with us on WhatsApp"
  >
    <MessageCircle className="w-5 h-5" />
  </motion.a>
);

export default KenlibsWhatsAppButton;
