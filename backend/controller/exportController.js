const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    AlignmentType,
    UnderlineType,
    ImageRun,
} = require("docx");
const PDFDocument = require("pdfkit");
const MarkdownIt = require("markdown-it");
const nodepub = require("nodepub");
const { ZipArchive } = require("archiver");
const Book = require("../models/Book");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { getExportTemplate } = require("../config/exportTemplates");


const md = new MarkdownIt();
// xhtmlOut self-closes void elements (<img ... />, <br />) — EPUB content
// documents are XHTML and reject the bare HTML5 form markdown-it emits by default.
const mdEpub = new MarkdownIt({ xhtmlOut: true });

// Paragraph/heading spacing that stays constant across templates — only the
// font, size scale, margins, line-spacing and heading style vary by
// template (see backend/config/exportTemplates.js).
const DOCX_SPACING = {
    paragraphBefore: 200,
    paragraphAfter: 200,
    chapterBefore: 400,
    chapterAfter: 300,
    headingBefore: 300,
    headingAfter: 150,
};

const DOCX_ALIGN = {
    justified: AlignmentType.JUSTIFIED,
    left: AlignmentType.LEFT,
    center: AlignmentType.CENTER,
};

// Function to process markdown content into docx paragraphs
const processMarkdownToDocx = (markdown, docxT) => {
    const tokens = md.parse(markdown, {});
    const paragraphs = [];
    let inList = false;
    let listType = null;
    let orderedCounter = 1;

    for(let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        try{
            if (token.type === "heading_open") {
                const level = parseInt(token.tag.substring(1), 10);
                const nextToken = tokens[i + 1];
                if (nextToken && nextToken.type === "inline") {
                   let headingLevel;
                   let fontSize;
                   switch (level) {
                       case 1:
                           headingLevel = HeadingLevel.HEADING_1;
                           fontSize = docxT.h1;
                           break;
                       case 2:
                           headingLevel = HeadingLevel.HEADING_2;
                           fontSize = docxT.h2;
                           break;
                       case 3:
                           headingLevel = HeadingLevel.HEADING_3;
                           fontSize = docxT.h3;
                           break;
                       default:
                           headingLevel = HeadingLevel.HEADING_1;
                           fontSize = docxT.h1;
                           break;
                   }
                   paragraphs.push(
                       new Paragraph({
                           heading: headingLevel,
                           spacing: { before: DOCX_SPACING.headingBefore, after: DOCX_SPACING.headingAfter },
                           children: [
                               new TextRun({
                                   text: nextToken.content,
                                   bold: true,
                                   font: docxT.headingFont,
                                   size: fontSize * 2, // docx uses half-points
                               }),
                           ],
                       })
                   );
                   i += 2; // Skip the heading text and closing tag
                }
            }
            else if (token.type === "paragraph_open") {
                const nextToken = tokens[i + 1];
                if (nextToken && nextToken.type === "inline" && nextToken.children) {
                    const textRuns =  processInlineContent(nextToken.children, docxT);

                    if(textRuns.length > 0) {
                        paragraphs.push(
                            new Paragraph({
                                children: textRuns,
                                spacing: { before: inList ? 100 : DOCX_SPACING.paragraphBefore, after: inList ? 100 : DOCX_SPACING.paragraphAfter,
                                    line: docxT.lineSpacing,
                                 },
                                 alignment: DOCX_ALIGN[docxT.paragraphAlign] || AlignmentType.JUSTIFIED,

                            })
                        );
                    }
                    i += 2; // Skip the paragraph text and closing tag
                }
            }
            else if (token.type === "bullet_list_open") {
                inList = true;
                listType = "bullet";
            }
            else if (token.type === "bullet_list_close") {
                inList = false;
                listType = null;
               //add spacing after list
                paragraphs.push(
                    new Paragraph({
                        text: "",
                        spacing: { after: 100 },
                    })
                );     
            }
            else if (token.type === "ordered_list_open") {
                inList = true;
                listType = "ordered";
                orderedCounter = 1;
            }
            else if (token.type === "ordered_list_close") {
                inList = false;
                listType = null;
                orderedCounter = 1;
                //add spacing after list
                paragraphs.push(
                    new Paragraph({
                        text: "",
                        spacing: { after: 100 },
                    })
                );     
            }
            else if (token.type === "list_item_open") {
                const nextToken = tokens[i + 1];
                if (nextToken && nextToken.type === "paragraph_open") {
                    const inlineToken = tokens[i + 2];
                    if (inlineToken && inlineToken.type === "inline" && inlineToken.children) {
                        const textRuns = processInlineContent(inlineToken.children, docxT);
                        let bulletText = "";
                        if (listType === "bullet") {
                            bulletText = "• ";
                        } else if (listType === "ordered") {
                            bulletText = `${orderedCounter}. `;
                            orderedCounter++;
                        }
                        paragraphs.push(
                            new Paragraph({
                                children: [
                                    new TextRun({
                                        text: bulletText,
                                        font: docxT.bodyFont,
                                    }),
                                    ...textRuns,
                                ],
                                spacing: { before: 50, after: 50 },
                                indent: { left: 720 }, //0.5 Indent for list items

                            })
                        )
                        i += 4; // Skip tparagraph_open, inline, paragraph_close, list_item_close
                    }
                }
            }
            else if (token.type === "blockquote_open") {
                //Find the blockquote content
                const nextToken = tokens[i + 1];
                if (nextToken && nextToken.type === "paragraph_open") {
                    const inlineToken = tokens[i + 2];
                    if (inlineToken && inlineToken.type === "inline" ) {
                       paragraphs.push(
                        new Paragraph({ 
                            children: [
                                new TextRun({
                                    text: inlineToken.content,
                                    font: docxT.bodyFont,
                                    italics: true,
                                    color: "666666",
                                }),
                            ],
                            spacing: { before: 200, after: 200 },
                            indent: { left: 720 }, //0.5 Indent for blockquote
                            alignment: DOCX_ALIGN[docxT.paragraphAlign] || AlignmentType.JUSTIFIED,
                            border: {
                                left: {
                                    color: "4F46E5",
                                    space: 1,
                                    style: "single",
                                    size: 24,
                                },
                            },
                        })
                       );
                       i += 4;
                    }
                }
            }
            else if (token.type === "code_block" || token.type === "fence") {
                paragraphs.push(
                    new Paragraph({
                        children: [
                            new TextRun({
                                text: token.content,
                                font: "Courier New",
                                size: 20,
                                color: "333333",
                            }),
                        ],
                        spacing: { before: 200, after: 200 },
                        shading: {
                            fill: "F5F5F5",
                        },
                        })
                    );
                } 
                else if (token.type === "hr") {
                    paragraphs.push(
                        new Paragraph({
                            text: "",
                            border: {
                                bottom: {
                                    color: "CCCCCC",
                                    space: 1,
                                    style: "single",
                                    size: 6,
                                },
                            },
                            spacing: { before: 200, after: 200 },
                        })
                    );
            }
        }
        catch (tokenError) {
            console.error("Error processing token:", token.type, tokenError);
        }
    }
    return paragraphs;
}

// Function to process inline content for bold, italics, and text
const processInlineContent = (children, docxT) => {
    const textRuns = [];
    let currentFormatting = { bold: false, italics: false, };
    let textBuffer = "";

    const flushBuffer = () => {
        if (textBuffer.trim()) {
            textRuns.push(
                new TextRun({
                    text: textBuffer,
                    font: docxT.bodyFont,
                    bold: currentFormatting.bold,
                    italics: currentFormatting.italics,
                    size: docxT.bodySize * 2, // docx uses half-points
                })
            );
            textBuffer = "";
        }
    };
    children.forEach((child) => {
        if (child.type === "strong_open") {
            flushBuffer();
            currentFormatting.bold = true;
        } else if (child.type === "strong_close") {
            flushBuffer();
            currentFormatting.bold = false;
        } else if (child.type === "em_open") {
            flushBuffer();
            currentFormatting.italics = true;
        } else if (child.type === "em_close") {
            flushBuffer();
            currentFormatting.italics = false;
        } else if (child.type === "text") {
            textBuffer += child.content;
        }
    });
    flushBuffer();
    return textRuns;
};
const exportAsDocument = async (req, res) => {
  try {
    const book = await Book.findById(req.params.id);
    if (!book) {
      return res.status(404).json({ message: "Book not found" });
    }
    if (book.userId.toString() !== req.user._id.toString()) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const docxT = getExportTemplate(book.templateId).docx;
    const chapterHeadingAlignment =
      DOCX_ALIGN[docxT.chapterHeadingAlign] || AlignmentType.LEFT;

    const sections = [];

    // ========== 1. Cover Image ==========
    if (book.coverImage && !book.coverImage.includes("pravatar")) {
      const imagePath = path.join(
        __dirname,
        "..",
        book.coverImage.replace(/^\//, "").replace(/\\/g, "/")
      );

      try {
        if (fs.existsSync(imagePath)) {
          const imageBuffer = fs.readFileSync(imagePath);

          // Top spacing
          sections.push(new Paragraph({ text: "", spacing: { before: 1200 } }));

          // Cover image
          sections.push(
            new Paragraph({
              children: [
                new ImageRun({
                  data: imageBuffer,
                  transformation: {
                    width: 400,
                    height: 550,
                  },
                }),
              ],
              alignment: AlignmentType.CENTER,
              spacing: { after: 400 },
            })
          );

          // Page break after cover
          sections.push(
            new Paragraph({
              children: [],
              pageBreakBefore: true,
            })
          );
        }
      } catch (err) {
        console.error("Could not embed cover image:", err.message);
      }
    }

    // ========== 2. Title Page ==========
    // Main Title
    sections.push(
      new Paragraph({
        children: [
          new TextRun({
            text: book.title || "Untitled Book",
            bold: true,
            size: 56, // 28pt
            font: docxT.headingFont,
            color: "1A202C",
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { before: 2000, after: 300 },
      })
    );

    // Subtitle
    if (book.subtitle && book.subtitle.trim()) {
      sections.push(
        new Paragraph({
          children: [
            new TextRun({
              text: book.subtitle,
              size: 32, // 16pt
              font: docxT.headingFont,
              color: "4A5568",
            }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { after: 300 },
        })
      );
    }

    // Author
    sections.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `by ${book.author || "Unknown Author"}`,
            size: 28, // 14pt
            font: docxT.headingFont,
            color: "2D3748",
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
      })
    );

    // Decorative line
    if (docxT.decorativeRule) {
      sections.push(
        new Paragraph({
          border: {
            bottom: {
              color: "4F46E5",
              space: 1,
              value: "single",
              size: 12,
            },
          },
          spacing: { before: 200, after: 600 },
        })
      );
    }

    // ========== 3. Chapters ==========
    book.chapters.forEach((chapter, index) => {
      // Page break before every chapter except the first
      if (index > 0) {
        sections.push(
          new Paragraph({
            children: [],
            pageBreakBefore: true,
          })
        );
      }

      // Chapter Title
      const chapterTitleText = chapter.title || `Chapter ${index + 1}`;
      sections.push(
        new Paragraph({
          children: [
            new TextRun({
              text: docxT.chapterHeadingUppercase
                ? chapterTitleText.toUpperCase()
                : chapterTitleText,
              bold: true,
              size: docxT.chapterTitleSize * 2,
              font: docxT.headingFont,
              color: "1A202C",
            }),
          ],
          alignment: chapterHeadingAlignment,
          spacing: { before: 200, after: 300 },
          border: docxT.decorativeRule
            ? {
                bottom: { color: "4F46E5", space: 4, style: "single", size: 6 },
              }
            : undefined,
        })
      );

      // Chapter Content
      const content = chapter.content || "";

      if (content.trim()) {
        sections.push(...processMarkdownToDocx(content, docxT));
      }
    });

    // ========== 4. Create Document ==========
    const doc = new Document({
      sections: [
        {
          properties: {
            page: {
              margin: docxT.margins,
            },
          },
          children: sections,
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${(book.title || "book").replace(
        /[^a-zA-Z0-9]/g,
        "_"
      )}.docx"`
    );
    res.setHeader("Content-Length", buffer.length);
    res.send(buffer);
  } catch (error) {
    console.error("Error exporting document:", error);
    if (!res.headersSent) {
      res.status(500).json({
        message: "Server Error During Document Export",
        error: error.message,
      });
    }
  }
};

// Colors and spacing rhythm that stay constant across templates — only the
// font, size scale, margins, line-gap and heading style vary by template
// (see backend/config/exportTemplates.js).
const PDF_COLORS = {
    heading: "#1A1A1A",
    text: "#333333",
    accent: "#4F46E5",
};

const PDF_SPACING = {
    paragraphSpacing: 12,
    chapterSpacing: 24,
    headingSpacing: {
        before: 16, after: 8,
    },
    listSpacing: 6,
};

const renderInlineTokens = (doc, tokens, options = {}, pdfT) => {
    if (!tokens || tokens.length === 0) return;
    const baseOptions = {
        align: options.align || "justify",
        indent: options.indent || 0,
        lineGap: options.lineGap != null ? options.lineGap : pdfT.lineGap,
    };
    let currentFont = pdfT.bodyFont;
    let textBuffer = "";

    const flushBuffer = () => {
        if (textBuffer) {
            doc.font(currentFont).text(textBuffer, { ...baseOptions, continued: true });
            textBuffer = "";
        }
    };

    for(let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token.type === "text") {
            textBuffer += token.content;
        } else if (token.type === "strong_open") {
            flushBuffer();
            currentFont = pdfT.bodyFontBold;
        } else if (token.type === "strong_close") {
            flushBuffer();
            currentFont = pdfT.bodyFont;
        } else if (token.type === "em_open") {
            flushBuffer();
            currentFont = pdfT.bodyFontItalic;
        } else if (token.type === "em_close") {
            flushBuffer();
            currentFont = pdfT.bodyFont;
        }
         else if (token.type === "code_inline") {
            flushBuffer();
            doc.font("Courier").text(token.content, { ...baseOptions, continued: true });
            doc.font(currentFont); // Reset to current font after inline code
        }
        }
        if (textBuffer) {
            doc.font(currentFont).text(textBuffer, { ...baseOptions, continued: false });
        }
        else {
            doc.text("", { continued: false });
        }
    };

    //render markdown
const renderMarkdown = (doc, markdown, pdfT) => {
    if(!markdown || markdown.trim() === "") return;
    const tokens = md.parse(markdown, {});
    let inList = false;
    let listType = null;
    let orderedCounter = 1;
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        try {
        if (token.type === "heading_open") {
            const level = parseInt(token.tag.substring(1), 10);
           let fontSize;
            switch (level) {
                case 1:
                    fontSize = pdfT.h1;
                    break;
                case 2:
                    fontSize = pdfT.h2;
                    break;
                case 3:
                    fontSize = pdfT.h3;
                    break;
                default:
                    fontSize = pdfT.h3;

            }
            doc.moveDown(PDF_SPACING.headingSpacing.before / pdfT.bodySize);
            doc.font(pdfT.headingFont).fontSize(fontSize)
            .fillColor(PDF_COLORS.heading)
            if (i + 1 < tokens.length && tokens[i + 1].type === "inline") {
                renderInlineTokens(doc, tokens[i + 1].children, { align: "left", lineGap: 0}, pdfT);
                i++; // Skip the heading text and closing tag
            }
            doc.moveDown(PDF_SPACING.headingSpacing.after / pdfT.bodySize);
            if (i + 1 < tokens.length && tokens[i + 1].type === "heading_close") {
                i++; // Skip the closing tag
            }
        } else if (token.type === "paragraph_open") {
            doc
               .font(pdfT.bodyFont)
               .fontSize(pdfT.bodySize)
               .fillColor(PDF_COLORS.text);

            if (i + 1 < tokens.length && tokens[i + 1].type === "inline") {
                renderInlineTokens(doc, tokens[i + 1].children, { align: pdfT.paragraphAlign, lineGap: pdfT.lineGap}, pdfT);
                i++; // Skip the paragraph text and closing tag
            }

            if(!inList) {
                doc.moveDown(PDF_SPACING.paragraphSpacing / pdfT.bodySize);

            }

            if (i + 1 < tokens.length && tokens[i + 1].type === "paragraph_close") {
                i++; // Skip the closing tag
            }
        } else if (token.type === "bullet_list_open") {
            inList = true;
            listType = "bullet";
            doc.moveDown(PDF_SPACING.listSpacing / pdfT.bodySize);

        }
        else if (token.type === "bullet_list_close") {
            inList = false;
            listType = null;
            doc.moveDown(PDF_SPACING.paragraphSpacing / pdfT.bodySize);
        }
        else if (token.type === "ordered_list_open") {
            inList = true;
            listType = "ordered";
            orderedCounter = 1;
            doc.moveDown(PDF_SPACING.listSpacing / pdfT.bodySize);
        }
        else if (token.type === "ordered_list_close") {
            inList = false;
            listType = null;
            orderedCounter = 1;
            doc.moveDown(PDF_SPACING.paragraphSpacing / pdfT.bodySize);
        }
        else if (token.type === "list_item_open") {
           let bullet = "";
            if (listType === "bullet") {
                bullet = "• ";
            } else if (listType === "ordered") {
                bullet = `${orderedCounter}. `;
                orderedCounter++;
            }
            doc.font(pdfT.bodyFont).fontSize(pdfT.bodySize).fillColor(PDF_COLORS.text);
            doc.text(bullet, {indent: 20, continued: true });
           for (let j = i + 1; j < tokens.length; j++) {
            if (tokens[j].type === "inline" && tokens[j].children) {
                renderInlineTokens(doc, tokens[j].children, { align: "left", lineGap: pdfT.lineGap }, pdfT);
                  break;
        }else if(tokens[j].type === "list_item_close") {
        break;
    }

    }
   doc.moveDown(PDF_SPACING.listSpacing / pdfT.bodySize);
        } else if(token.type === "code_block" || token.type === "fence") {
            doc.moveDown(PDF_SPACING.paragraphSpacing / pdfT.bodySize);
            doc
            .font("Courier")
            .fontSize(9)
            .fillColor(PDF_COLORS.text)
            .text(token.content, {align: "left", indent: 20});

            doc.font(pdfT.bodyFont).fontSize(pdfT.bodySize).fillColor(PDF_COLORS.text);
            doc.moveDown(PDF_SPACING.paragraphSpacing / pdfT.bodySize);

        }
        else if (token.type === "hr") {
            doc.moveDown()
            const y = doc.y;
            doc
            .moveTo(doc.page.margins.left, y)
            .lineTo(doc.page.width - doc.page.margins.right, y)
            .stroke();
            doc.moveDown();
        }
    }
    catch(tokenError) {
        console.error("Error processing token:", token.type, tokenError);
        continue; // Skip to the next token
    }
}
}



const exportAsPDF = async (req, res) => {
  try {
    const book = await Book.findById(req.params.id);
    if (!book) {
      return res.status(404).json({ message: "Book not found" });
    }
    if (book.userId.toString() !== req.user._id.toString()) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const pdfT = getExportTemplate(book.templateId).pdf;

    const doc = new PDFDocument({
      margins: pdfT.margins,
      bufferPages: true,
      autoFirstPage: true,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${book.title.replace(/[^a-zA-Z0-9]/g, "_")}.pdf"`
    );

    doc.pipe(res);

    // ========== Cover Image ==========
    if (book.coverImage && !book.coverImage.includes("pravatar")) {
      const imagePath = path.join(
        __dirname,
        "..",
        book.coverImage.replace(/^\//, "").replace(/\\/g, "/")
      );

      try {
        if (fs.existsSync(imagePath)) {
          const pageWidth =
            doc.page.width - doc.page.margins.left - doc.page.margins.right;
          const pageHeight =
            doc.page.height - doc.page.margins.top - doc.page.margins.bottom;

          doc.image(imagePath, {
            fit: [pageWidth * 0.85, pageHeight * 0.85],
            align: "center",
            valign: "center",
          });
          doc.addPage();
        }
      } catch (err) {
        console.error("Cover image error:", err.message);
      }
    }

    // ========== Title Page ==========
    doc.moveDown(8);
    doc
      .font(pdfT.headingFont)
      .fontSize(28)
      .fillColor("#1A1A1A")
      .text(book.title || "Untitled", { align: "center" });

    doc.moveDown(1.5);

    if (book.subtitle && book.subtitle.trim()) {
      doc
        .font(pdfT.bodyFont)
        .fontSize(16)
        .fillColor("#4A5568")
        .text(book.subtitle, { align: "center" });
      doc.moveDown(1);
    }

    doc
      .font(pdfT.bodyFont)
      .fontSize(14)
      .fillColor("#2D3748")
      .text(`by ${book.author || "Unknown Author"}`, { align: "center" });

    // ========== Chapters ==========
    if (book.chapters && book.chapters.length > 0) {
      book.chapters.forEach((chapter, index) => {
        doc.addPage();

        // Chapter Title
        const chapterTitleText = chapter.title || `Chapter ${index + 1}`;
        doc
          .font(pdfT.headingFont)
          .fontSize(pdfT.chapterTitleSize)
          .fillColor("#1A1A1A")
          .text(
            pdfT.chapterHeadingUppercase
              ? chapterTitleText.toUpperCase()
              : chapterTitleText,
            { align: pdfT.chapterHeadingAlign }
          );

        if (pdfT.decorativeRule) {
          doc.moveDown(0.4);
          const y = doc.y;
          doc
            .moveTo(doc.page.margins.left, y)
            .lineTo(doc.page.width - doc.page.margins.right, y)
            .strokeColor(PDF_COLORS.accent)
            .lineWidth(1.5)
            .stroke()
            .strokeColor(PDF_COLORS.text) // reset for any later strokes (e.g. <hr>)
            .lineWidth(1);
        }

        doc.moveDown(1.5);

        // Chapter Content
        const content = chapter.content || "";
        if (content.trim()) {
          renderMarkdown(doc, content, pdfT);
        }
      });
    }

    doc.end();
  } catch (error) {
    console.error("Error exporting PDF:", error);
    if (!res.headersSent) {
      res.status(500).json({
        message: "Server Error During PDF Export",
        error: error.message,
      });
    }
  }
};

const escapeHtml = (str = "") =>
  String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// Rewrites <img src="/uploads/chapters/...jpg"> references in rendered chapter
// HTML to the "../images/<file>" paths nodepub expects, collecting the
// resolved on-disk source path for each into imageMap (basename -> abs path)
// so it can be embedded. Images that don't actually exist on disk are
// dropped from the markup entirely rather than left as broken internal links.
const resolveChapterImagesForEpub = (html, imageMap) => {
  return html.replace(
    /<img([^>]*?)src="([^"]+)"([^>]*?)\/?>/g,
    (match, before, src, after) => {
      if (!src.startsWith("/uploads/")) {
        return match; // leave any non-local reference alone
      }

      const diskPath = path.join(__dirname, "..", src.replace(/^\//, ""));
      if (!fs.existsSync(diskPath)) {
        console.warn("Skipping missing chapter image for EPUB:", diskPath);
        return "";
      }

      const basename = path.basename(diskPath);
      if (!imageMap.has(basename)) {
        imageMap.set(basename, diskPath);
      }
      return `<img${before}src="../images/${basename}"${after}/>`;
    }
  );
};

const toArchiveContent = (content) => {
  if (Buffer.isBuffer(content) || typeof content === "string") return content;
  return Buffer.from(content);
};

const wrapText = (text, maxCharsPerLine) => {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  words.forEach((word) => {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  });
  if (current) lines.push(current);
  return lines;
};

// nodepub requires a cover image and throws if the metadata is missing one,
// but a book's coverImage is optional in the schema. For books with no
// uploaded cover (or a placeholder pravatar URL), build a simple on-brand
// SVG cover on the fly instead of failing the export.
const buildPlaceholderCoverSvg = (title, author) => {
  const titleLines = wrapText(title || "Untitled Book", 18).slice(0, 4);
  const titleStartY = 420 - (titleLines.length - 1) * 27;
  const titleTspans = titleLines
    .map(
      (line, i) =>
        `<tspan x="300" y="${titleStartY + i * 54}">${escapeHtml(line)}</tspan>`
    )
    .join("");
  const authorY = titleStartY + titleLines.length * 54 + 40;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#7c3aed"/>
      <stop offset="100%" stop-color="#9333ea"/>
    </linearGradient>
  </defs>
  <rect width="600" height="900" fill="url(#bg)"/>
  <text text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="42" font-weight="bold" fill="#ffffff">${titleTspans}</text>
  <text x="300" y="${authorY}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="24" fill="#e9d5ff">${escapeHtml(
    author || "Unknown Author"
  )}</text>
</svg>`;
};

// Builds the template's CSS for the EPUB. Only body/heading font-family,
// line-height, and chapter-heading style map onto EPUB's reflowable format —
// see the "EPUB mapping notes" at the bottom of backend/config/exportTemplates.js
// for what was deliberately left out (fixed margins, absolute point sizes)
// and why. The chapter-title heading gets its own .chapter-title class so
// these rules only ever touch the title nodepub renders per chapter, never
// an "# heading" a user typed inside their own chapter markdown.
const buildEpubCss = (epubT) => `
  body { font-family: ${epubT.bodyFontFamily}; line-height: ${epubT.lineHeight}; }
  h1, h2, h3 { font-family: ${epubT.headingFontFamily}; }
  h1.chapter-title {
    text-align: ${epubT.chapterHeadingAlign};
    margin-top: 1.5em;
    margin-bottom: 1em;
    ${epubT.chapterHeadingUppercase ? "text-transform: uppercase; letter-spacing: 0.05em;" : ""}
    ${epubT.decorativeRule ? "border-top: 1px solid #4F46E5; padding-top: 0.75em;" : ""}
  }
`;

//@desc    Export a book as EPUB
//@route   GET /api/export/:id/epub
//@access  Private
const exportAsEPUB = async (req, res) => {
  try {
    const book = await Book.findById(req.params.id);
    if (!book) {
      return res.status(404).json({ message: "Book not found" });
    }
    if (book.userId.toString() !== req.user._id.toString()) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const epubT = getExportTemplate(book.templateId).epub;

    // ========== Cover Image ==========
    let coverPath;
    if (book.coverImage && !book.coverImage.includes("pravatar")) {
      const candidate = path.join(
        __dirname,
        "..",
        book.coverImage.replace(/^\//, "").replace(/\\/g, "/")
      );
      if (fs.existsSync(candidate)) {
        coverPath = candidate;
      } else {
        console.warn("Cover image not found on disk for EPUB:", candidate);
      }
    }

    // nodepub requires a cover — fall back to a generated placeholder when
    // the book has none, rather than failing the export.
    let tempCoverPath;
    if (!coverPath) {
      tempCoverPath = path.join(
        os.tmpdir(),
        `epub-cover-${book._id.toString()}-${Date.now()}.svg`
      );
      fs.writeFileSync(
        tempCoverPath,
        buildPlaceholderCoverSvg(book.title, book.author)
      );
      coverPath = tempCoverPath;
    }

    // ========== Chapters ==========
    const imageMap = new Map(); // basename -> absolute disk path
    const chapterSections = (book.chapters || []).map((chapter, index) => {
      const title = chapter.title || `Chapter ${index + 1}`;
      const bodyHtml =
        chapter.content && chapter.content.trim()
          ? mdEpub.render(chapter.content)
          : "<p><em>No content available for this chapter.</em></p>";
      const resolvedHtml = resolveChapterImagesForEpub(bodyHtml, imageMap);
      return {
        title,
        html: `<h1 class="chapter-title">${escapeHtml(title)}</h1>${resolvedHtml}`,
      };
    });

    // ========== Metadata ==========
    // nodepub emits an (invalid, per EPUBCheck) empty <dc:date> element when
    // no `published` value is given, so fall back to the book's creation date.
    const publishedDate = (book.createdAt ? new Date(book.createdAt) : new Date())
      .toISOString()
      .slice(0, 10);

    const metadata = {
      id: book._id.toString(),
      title: book.title || "Untitled Book",
      author: book.author || "Unknown Author",
      language: "en",
      description: book.subtitle || "",
      published: publishedDate,
      showContents: true,
      cover: coverPath,
      images: Array.from(imageMap.values()),
    };

    const epub = nodepub.document(metadata);
    epub.addCSS(buildEpubCss(epubT));
    chapterSections.forEach((section) => {
      epub.addSection(section.title, section.html);
    });

    let files;
    try {
      files = await epub.getFilesForEPUB();
    } finally {
      if (tempCoverPath) {
        fs.unlink(tempCoverPath, () => {}); // best-effort cleanup
      }
    }

    res.setHeader("Content-Type", "application/epub+zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${(book.title || "book").replace(
        /[^a-zA-Z0-9]/g,
        "_"
      )}.epub"`
    );

    const archive = new ZipArchive();
    archive.on("error", (archiveError) => {
      console.error("EPUB archive error:", archiveError);
      if (!res.headersSent) {
        res.status(500).json({ message: "Server Error During EPUB Export" });
      } else {
        res.end();
      }
    });
    archive.pipe(res);

    // The mimetype entry must be first in the zip and stored (not
    // compressed) per the EPUB spec — enforced explicitly here rather than
    // trusting file ordering/flags from the library.
    const mimetypeFile = files.find((file) => file.name === "mimetype");
    const otherFiles = files.filter((file) => file.name !== "mimetype");

    if (mimetypeFile) {
      archive.append(toArchiveContent(mimetypeFile.content), {
        name: path.posix.join(mimetypeFile.folder || "", mimetypeFile.name),
        store: true,
      });
    }

    otherFiles.forEach((file) => {
      archive.append(toArchiveContent(file.content), {
        name: path.posix.join(file.folder || "", file.name),
        store: !file.compress,
      });
    });

    await archive.finalize();
  } catch (error) {
    console.error("Error exporting EPUB:", error);
    if (!res.headersSent) {
      res.status(500).json({
        message: "Server Error During EPUB Export",
        error: error.message,
      });
    }
  }
};

module.exports = {
    exportAsDocument,
    exportAsPDF,
    exportAsEPUB,
};
