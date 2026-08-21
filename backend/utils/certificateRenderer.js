// Draws a completion certificate onto an already-created, landscape pdfkit
// PDFDocument (the caller owns creation/piping/doc.end(), same division of
// responsibility as exportController.js's exportAsPDF). Deliberately uses
// only the standard 14 PostScript base fonts (Times-*/Helvetica-*) — this
// project has no embedded TTFs anywhere else in its pdfkit output (see
// config/exportTemplates.js's comment on this), so staying on base fonts
// here keeps the certificate consistent with every other PDF this app
// produces rather than introducing a one-off font-embedding path. No custom
// script font is available for that reason — the reader's name gets a
// signature *treatment* (Times-BoldItalic, oversized, accent-colored, with a
// drawn flourish underline) instead of an actual script typeface.
//
// Palette matches the app's real design tokens (frontend/src/index.css),
// not an arbitrary PDF-only color: --color-accent is Tailwind's violet-600,
// --color-accent-secondary is purple-600 — the same two colors every
// "from-accent to-accent-secondary" gradient button in Kenlibs already uses.
const ACCENT = "#7C3AED"; // violet-600
const ACCENT_SECONDARY = "#9333EA"; // purple-600
const ACCENT_DEEP = "#6D28D9"; // violet-700 — corner ornaments, ribbon shadow
const ACCENT_TINT = "#DDD6FE"; // violet-200 — inner border, muted rules
const INK = "#1A1A1A";
const INK_MUTED = "#6B7280";
const PAPER = "#FBFAFF";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const formatCertificateDate = (date) => {
  const d = new Date(date);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
};

// A very low-opacity, oversized crop of the book's own cover, drawn first
// (so everything else sits on top of it) — gives every certificate a visual
// tie to its specific book even when the crisp corner medallion below is
// skipped for space, and reads as a deliberate paper texture rather than a
// picture, the way a banknote or diploma watermark does.
const drawWatermark = (doc, coverImageBuffer, pageWidth, pageHeight) => {
  if (!coverImageBuffer) return;
  const w = pageHeight * 0.95;
  const h = w * 1.5;
  doc.save();
  doc.opacity(0.055);
  doc.image(coverImageBuffer, pageWidth / 2 - w / 2, pageHeight / 2 - h / 2, {
    fit: [w, h],
    align: "center",
    valign: "center",
  });
  doc.restore();
};

// Classic double-line frame plus a small bracket ornament at each corner —
// the bracket is what reads as "engraved official document" rather than
// just two nested rectangles.
const drawBorder = (doc, pageWidth, pageHeight) => {
  const outerInset = 20;
  const innerInset = 29;
  doc
    .roundedRect(outerInset, outerInset, pageWidth - outerInset * 2, pageHeight - outerInset * 2, 5)
    .lineWidth(2.25)
    .strokeColor(ACCENT)
    .stroke();
  doc
    .roundedRect(innerInset, innerInset, pageWidth - innerInset * 2, pageHeight - innerInset * 2, 3)
    .lineWidth(0.75)
    .strokeColor(ACCENT_TINT)
    .stroke();

  const armLength = 22;
  const offset = 12; // how far the bracket sits outside the outer border corner
  const corners = [
    { x: 0, y: 0, dx: 1, dy: 1 },
    { x: pageWidth, y: 0, dx: -1, dy: 1 },
    { x: 0, y: pageHeight, dx: 1, dy: -1 },
    { x: pageWidth, y: pageHeight, dx: -1, dy: -1 },
  ];
  corners.forEach(({ x, y, dx, dy }) => {
    const cx = x + dx * offset;
    const cy = y + dy * offset;
    doc
      .save()
      .lineWidth(1.5)
      .strokeColor(ACCENT_DEEP)
      .moveTo(cx + dx * armLength, cy)
      .lineTo(cx, cy)
      .lineTo(cx, cy + dy * armLength)
      .stroke()
      .restore();
  });
};

// A small circular "medallion" crop of the cover, framed with a thin ring —
// the crisp, legible visual-identity counterpart to the soft watermark
// above. Clipped to a circle (rather than a plain rectangle) so it reads as
// a deliberate medallion, not just a thumbnail that happened to get placed
// in a corner.
const drawCoverMedallion = (doc, coverImageBuffer, cx, cy, r) => {
  if (!coverImageBuffer) return;
  doc.save();
  doc.circle(cx, cy, r).clip();
  doc.image(coverImageBuffer, cx - r, cy - r, { fit: [r * 2, r * 2], align: "center", valign: "center" });
  doc.restore();
  doc.circle(cx, cy, r).lineWidth(1.75).strokeColor(ACCENT).stroke();
  doc.circle(cx, cy, r + 4).lineWidth(0.75).strokeColor(ACCENT_TINT).stroke();
};

// A short horizontal rule with a small centered diamond — used to give
// "Certificate of Completion" a definite headline weight instead of just
// being the biggest line of text on the page.
const drawFlourishRule = (doc, cy, width, pageWidth) => {
  const half = width / 2;
  const cx = pageWidth / 2;
  doc
    .moveTo(cx - half, cy)
    .lineTo(cx - 6, cy)
    .moveTo(cx + 6, cy)
    .lineTo(cx + half, cy)
    .lineWidth(1)
    .strokeColor(ACCENT_SECONDARY)
    .stroke();
  doc.save().translate(cx, cy).rotate(45).rect(-3.5, -3.5, 7, 7).fillColor(ACCENT_SECONDARY).fill().restore();
};

// A gentle hand-drawn-like swash under the reader's name — sized to the
// name's actual printed width so a short name doesn't get a comically wide
// flourish and a long one doesn't get a stub.
const drawSignatureFlourish = (doc, pageWidth, y, nameWidth) => {
  const width = Math.min(Math.max(nameWidth * 0.7, 90), 320);
  const cx = pageWidth / 2;
  const x1 = cx - width / 2;
  const x2 = cx + width / 2;
  doc
    .moveTo(x1, y)
    .bezierCurveTo(x1 + width * 0.28, y + 9, x1 + width * 0.72, y - 9, x2, y)
    .lineWidth(1.25)
    .strokeColor(ACCENT_SECONDARY)
    .stroke();
};

// The "issuing authority's mark" — a gradient-filled medallion with a
// checkmark, a thin outer ring, and two ribbon tails, the way a traditional
// certificate presents a wax seal. Curved text-on-a-circle isn't something
// pdfkit does natively, so the wordmark sits as a straight caption beneath
// the seal instead of wrapping the ring.
const drawSeal = (doc, cx, cy, r) => {
  // Ribbon tails, drawn first so the medallion overlaps their top edge.
  const tailW = r * 0.34;
  const tailLen = r * 1.15;
  [-1, 1].forEach((side) => {
    const baseX = cx + side * r * 0.32;
    doc
      .moveTo(baseX, cy + r * 0.55)
      .lineTo(baseX + side * tailW, cy + r * 0.55)
      .lineTo(baseX + side * tailW * 0.55, cy + r * 0.55 + tailLen)
      .lineTo(baseX + side * tailW * 0.1, cy + r * 0.55 + tailLen * 0.7)
      .closePath()
      .fillColor(ACCENT_DEEP)
      .fill();
  });

  doc.circle(cx, cy, r + 5).lineWidth(0.75).strokeColor(ACCENT_TINT).stroke();

  const gradient = doc.radialGradient(cx, cy, 0, cx, cy, r);
  gradient.stop(0, ACCENT_SECONDARY).stop(1, ACCENT);
  doc.circle(cx, cy, r).fill(gradient);
  doc.circle(cx, cy, r).lineWidth(1).strokeColor("#FFFFFF").stroke();

  doc
    .save()
    .lineWidth(3)
    .strokeColor("#FFFFFF")
    .moveTo(cx - r * 0.42, cy + r * 0.02)
    .lineTo(cx - r * 0.1, cy + r * 0.36)
    .lineTo(cx + r * 0.46, cy - r * 0.3)
    .stroke()
    .restore();

  doc
    .font("Helvetica-Bold")
    .fontSize(9)
    .fillColor(ACCENT_DEEP)
    .text("KENLIBS", cx - 50, cy + r + 12, { align: "center", width: 100, characterSpacing: 1.5 });
  doc
    .font("Helvetica")
    .fontSize(7)
    .fillColor(INK_MUTED)
    .text("VERIFIED COMPLETION", cx - 50, cy + r + 24, { align: "center", width: 100, characterSpacing: 0.5 });
};

const renderCertificate = (
  doc,
  { bookTitle, author, readerName, completedAt, coverImageBuffer }
) => {
  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;

  doc.rect(0, 0, pageWidth, pageHeight).fillColor(PAPER).fill();
  drawWatermark(doc, coverImageBuffer, pageWidth, pageHeight);
  drawBorder(doc, pageWidth, pageHeight);
  if (coverImageBuffer) {
    drawCoverMedallion(doc, coverImageBuffer, 88, 88, 30);
  }

  // ===== Wordmark =====
  doc
    .font("Helvetica-Bold")
    .fontSize(13)
    .fillColor(ACCENT)
    .text("K E N L I B S", 0, 58, { align: "center", width: pageWidth, characterSpacing: 1 });

  // ===== Headline — the clear anchor of the page: bigger, letter-spaced,
  // flanked by a rule+diamond flourish rather than just sized up in place. =====
  doc
    .font("Times-Bold")
    .fontSize(36)
    .fillColor(INK)
    .text("Certificate of Completion", 0, 100, { align: "center", width: pageWidth, characterSpacing: 0.5 });
  drawFlourishRule(doc, doc.y + 12, 140, pageWidth);

  // ===== Body — flows top to bottom off doc.y so a long reader name or
  // book title that wraps to a second line pushes everything below it down
  // by exactly that much, rather than overlapping on fixed coordinates. =====
  let y = doc.y + 26;
  doc
    .font("Times-Italic")
    .fontSize(13)
    .fillColor(INK_MUTED)
    .text("This certifies that", 0, y, { align: "center", width: pageWidth });

  // Reader's name gets the signature treatment: the single largest,
  // boldest, most colorful element on the page, with a drawn flourish
  // underline sized to its own printed width.
  y = doc.y + 8;
  doc.font("Times-BoldItalic").fontSize(34);
  const nameWidth = doc.widthOfString(readerName);
  doc.fillColor(ACCENT).text(readerName, 70, y, { align: "center", width: pageWidth - 140 });
  drawSignatureFlourish(doc, pageWidth, doc.y + 4, nameWidth);

  y = doc.y + 20;
  doc
    .font("Times-Italic")
    .fontSize(13)
    .fillColor(INK_MUTED)
    .text("has completed reading", 0, y, { align: "center", width: pageWidth });

  y = doc.y + 8;
  doc
    .font("Times-Bold")
    .fontSize(19)
    .fillColor(INK)
    .text(bookTitle, 150, y, { align: "center", width: pageWidth - 300 });

  y = doc.y + 6;
  doc
    .font("Times-Italic")
    .fontSize(12)
    .fillColor(INK_MUTED)
    .text(`by ${author}`, 0, y, { align: "center", width: pageWidth });

  // ===== Bottom section — a signature-line for the completion date on the
  // left, mirroring the seal on the right, the way a traditional
  // certificate pairs a recipient/date line with the issuing mark. Fixed
  // position near the bottom, independent of how tall the body block above
  // ended up (worst-case wrapping still lands well clear of this, tested
  // with this project's longest actual book titles). =====
  const lineY = pageHeight - 118;
  const dateLineX1 = 130;
  const dateLineX2 = 360;
  doc.moveTo(dateLineX1, lineY).lineTo(dateLineX2, lineY).lineWidth(1).strokeColor(ACCENT_TINT).stroke();
  doc
    .font("Times-Italic")
    .fontSize(13)
    .fillColor(INK)
    .text(formatCertificateDate(completedAt), dateLineX1, lineY - 22, {
      align: "center",
      width: dateLineX2 - dateLineX1,
    });
  doc
    .font("Helvetica-Bold")
    .fontSize(8)
    .fillColor(INK_MUTED)
    .text("DATE OF COMPLETION", dateLineX1, lineY + 8, {
      align: "center",
      width: dateLineX2 - dateLineX1,
      characterSpacing: 0.75,
    });

  drawSeal(doc, pageWidth - 155, pageHeight - 118, 26);

  // ===== Footer =====
  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor(INK_MUTED)
    .text("Issued by Kenlibs", 0, pageHeight - 42, { align: "center", width: pageWidth });
};

module.exports = { renderCertificate };
