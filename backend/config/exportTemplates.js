// Selectable export design templates, applied by exportController.js when
// generating PDF/DOCX/EPUB. Not database-driven — this is a small, fixed set
// of starter presets, referenced from Book.templateId.
//
// Each template carries three separate sub-configs — docx / pdf / epub —
// rather than one shared set of "fonts", because each output format has a
// fundamentally different font model:
//   - docx: arbitrary font *names* (e.g. "Georgia"). Word/LibreOffice
//     substitute a fallback on the reading device if that font isn't
//     installed there, so any common font name is safe to reference.
//   - pdf: pdfkit only ships the 14 standard PostScript base fonts with no
//     embedded TTFs in this project, so fonts here are restricted to the
//     Times-*/Helvetica-*/Courier-* families — anything else would silently
//     fall back to Helvetica.
//   - epub: CSS font-family stacks (the reading app/device renders these,
//     same as a browser). EPUB is reflowable text, so there's no page-margin
//     concept — see the "EPUB mapping notes" at the bottom of this file.
//
// Units: docx margins/line-spacing are in twips (1/1440 inch, 1/20 pt — docx
// convention); pdf margins are in points; sizes are in points for both.

const EXPORT_TEMPLATES = {
  classic: {
    id: "classic",
    name: "Classic",
    description:
      "Traditional serif body text with generous margins — a timeless, literary look.",
    docx: {
      bodyFont: "Georgia",
      headingFont: "Georgia",
      margins: { top: 1440, bottom: 1440, left: 1440, right: 1440 }, // 1in
      bodySize: 12,
      chapterTitleSize: 24,
      h1: 16,
      h2: 14,
      h3: 13,
      lineSpacing: 360, // 1.5x
      paragraphAlign: "justified",
      chapterHeadingAlign: "left",
      decorativeRule: true,
      chapterHeadingUppercase: false,
    },
    pdf: {
      bodyFont: "Times-Roman",
      bodyFontBold: "Times-Bold",
      bodyFontItalic: "Times-Italic",
      headingFont: "Times-Bold",
      margins: { top: 72, bottom: 72, left: 72, right: 72 }, // 1in
      bodySize: 11,
      chapterTitleSize: 20,
      h1: 18,
      h2: 16,
      h3: 14,
      lineGap: 4,
      paragraphAlign: "justify",
      chapterHeadingAlign: "left",
      decorativeRule: true,
      chapterHeadingUppercase: false,
    },
    epub: {
      bodyFontFamily: "Georgia, 'Times New Roman', serif",
      headingFontFamily: "Georgia, 'Times New Roman', serif",
      lineHeight: 1.6,
      chapterHeadingAlign: "left",
      decorativeRule: true,
      chapterHeadingUppercase: false,
    },
  },

  modern: {
    id: "modern",
    name: "Modern",
    description:
      "Clean sans-serif body with tighter spacing and minimal chapter headers.",
    docx: {
      bodyFont: "Calibri",
      headingFont: "Calibri",
      margins: { top: 1080, bottom: 1080, left: 1080, right: 1080 }, // 0.75in
      bodySize: 11,
      chapterTitleSize: 18,
      h1: 15,
      h2: 13,
      h3: 12,
      lineSpacing: 276, // ~1.15x
      paragraphAlign: "justified",
      chapterHeadingAlign: "left",
      decorativeRule: false,
      chapterHeadingUppercase: false,
    },
    pdf: {
      bodyFont: "Helvetica",
      bodyFontBold: "Helvetica-Bold",
      bodyFontItalic: "Helvetica-Oblique",
      headingFont: "Helvetica-Bold",
      margins: { top: 54, bottom: 54, left: 54, right: 54 }, // 0.75in
      bodySize: 10.5,
      chapterTitleSize: 16,
      h1: 14,
      h2: 12.5,
      h3: 11.5,
      lineGap: 2,
      paragraphAlign: "justify",
      chapterHeadingAlign: "left",
      decorativeRule: false,
      chapterHeadingUppercase: false,
    },
    epub: {
      bodyFontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
      headingFontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
      lineHeight: 1.35,
      chapterHeadingAlign: "left",
      decorativeRule: false,
      chapterHeadingUppercase: false,
    },
  },

  manuscript: {
    id: "manuscript",
    name: "Manuscript",
    description:
      "Double-spaced Courier body in standard manuscript submission format.",
    docx: {
      bodyFont: "Courier New",
      headingFont: "Courier New",
      margins: { top: 1800, bottom: 1800, left: 1800, right: 1800 }, // 1.25in
      bodySize: 12,
      chapterTitleSize: 12,
      h1: 12,
      h2: 12,
      h3: 12,
      lineSpacing: 480, // double
      paragraphAlign: "left",
      chapterHeadingAlign: "center",
      decorativeRule: false,
      chapterHeadingUppercase: true,
    },
    pdf: {
      bodyFont: "Courier",
      bodyFontBold: "Courier-Bold",
      bodyFontItalic: "Courier-Oblique",
      headingFont: "Courier-Bold",
      margins: { top: 90, bottom: 90, left: 90, right: 90 }, // 1.25in
      bodySize: 12,
      chapterTitleSize: 12,
      h1: 12,
      h2: 12,
      h3: 12,
      lineGap: 16, // approximates double-spacing at 12pt Courier
      paragraphAlign: "left",
      chapterHeadingAlign: "center",
      decorativeRule: false,
      chapterHeadingUppercase: true,
    },
    epub: {
      bodyFontFamily: "'Courier New', Courier, monospace",
      headingFontFamily: "'Courier New', Courier, monospace",
      lineHeight: 2,
      chapterHeadingAlign: "center",
      decorativeRule: false,
      chapterHeadingUppercase: true,
    },
  },
};

const DEFAULT_TEMPLATE_ID = "classic";

const getExportTemplate = (templateId) =>
  EXPORT_TEMPLATES[templateId] || EXPORT_TEMPLATES[DEFAULT_TEMPLATE_ID];

module.exports = { EXPORT_TEMPLATES, DEFAULT_TEMPLATE_ID, getExportTemplate };

// --- EPUB mapping notes (see exportAsEPUB) ---
// - margins: dropped entirely. EPUB is reflowable — the reading app/device
//   controls page size and margins, not the document. There is no field to
//   map this onto.
// - bodySize / chapterTitleSize / h1-h3 (absolute point sizes): dropped.
//   EPUB body text size is a reader preference (font-size controls in every
//   reader app), so baking in fixed point sizes would fight the user's own
//   settings. Heading *hierarchy* (h1 > h2 > h3) is preserved via relative
//   em-based CSS instead of the template's absolute pt values.
// - lineGap (pdf's fixed-point gap) becomes lineHeight (a unitless CSS
//   multiplier) — the nearest reflow-safe equivalent.
// - decorativeRule / chapterHeadingAlign / chapterHeadingUppercase: map
//   directly to CSS (border-top, text-align, text-transform).
