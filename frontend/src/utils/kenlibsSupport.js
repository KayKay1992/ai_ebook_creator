// Shared support-contact constants/helpers — deliberately a plain module,
// not exported alongside a component (that used to live in KenlibsFooter.jsx
// but tripped the react-refresh/only-export-components lint rule once a
// second helper function was added there). Every "contact us" affordance
// across Kenlibs (KenlibsFooter, KenlibsWhatsAppButton, the support page,
// the rejected-purchase support link on KenlibsMyBooksPage, the legal pages)
// imports from here so the number/email are only ever defined once.
export const SUPPORT_EMAIL = "kennethnwankpa92@yahoo.com";
export const SUPPORT_WHATSAPP_DISPLAY = "+234 810 310 8267";
export const SUPPORT_WHATSAPP_NUMBER = "2348103108267";
export const SUPPORT_WHATSAPP_HREF = `https://wa.me/${SUPPORT_WHATSAPP_NUMBER}`;

// `message` is optional pre-filled text — undefined/empty just links
// straight to the number, same as SUPPORT_WHATSAPP_HREF above.
export const buildWhatsAppHref = (message) =>
  message ? `${SUPPORT_WHATSAPP_HREF}?text=${encodeURIComponent(message)}` : SUPPORT_WHATSAPP_HREF;
