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
const Book = require("../models/Book");
const path = require("path");
const fs = require("fs");


const md = new MarkdownIt();

//Typography configuration matching the PDF export
const DOCX_STYLES = {
    fonts: {
        body: "Charter",
        heading: "Inter",
    },
    sizes: {
        title: 32,
        subtitle: 20,
        author: 18,
        chapterTitle: 24,
        h1: 20,
        h2: 18,
        h3: 16,
        body: 12,
    },
    spacing: {
        paragraphBefore: 200,
        paragraphAfter: 200,
        chapterBefore: 400,
        chapterAfter: 300,
        headingBefore: 300,
        headingAfter: 150,
    },
};

// Function to process markdown content into docx paragraphs
const processMarkdownToDocx = (markdown) => {
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
                           fontSize = DOCX_STYLES.sizes.h1;
                           break;
                       case 2:
                           headingLevel = HeadingLevel.HEADING_2;
                           fontSize = DOCX_STYLES.sizes.h2;
                           break;
                       case 3:
                           headingLevel = HeadingLevel.HEADING_3;
                           fontSize = DOCX_STYLES.sizes.h3;
                           break;
                       default:
                           headingLevel = HeadingLevel.HEADING_1;
                           fontSize = DOCX_STYLES.sizes.h1;
                           break;
                   }
                   paragraphs.push(
                       new Paragraph({
                           text: nextToken.content,
                           heading: headingLevel,
                           spacing: { before: DOCX_STYLES.spacing.headingBefore, after: DOCX_STYLES.spacing.headingAfter },
                           style: {
                             
                                   font: DOCX_STYLES.fonts.heading,
                                   size: fontSize * 2, // docx uses half-points
                              
                           },
                       })
                   );
                   i += 2; // Skip the heading text and closing tag
                }
            }
            else if (token.type === "paragraph_open") {
                const nextToken = tokens[i + 1];
                if (nextToken && nextToken.type === "inline" && nextToken.children) {
                    const textRuns =  processInlineContent(nextToken.children);

                    if(textRuns.length > 0) {
                        paragraphs.push(
                            new Paragraph({
                                children: textRuns,
                                spacing: { before: inList ? 100 : DOCX_STYLES.spacing.paragraphBefore, after: inList ? 100 : DOCX_STYLES.spacing.paragraphAfter,
                                    line: 360, // 1.5 line spacing in twips (1/20 of a point)
                                 },
                                 alignment: AlignmentType.JUSTIFIED,
                                
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
                        const textRuns = processInlineContent(inlineToken.children);
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
                                        font: DOCX_STYLES.fonts.body,
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
                                    font: DOCX_STYLES.fonts.body,
                                    italics: true,
                                    color: "666666",
                                }),
                            ],
                            spacing: { before: 200, after: 200 },
                            indent: { left: 720 }, //0.5 Indent for blockquote
                            alignment: AlignmentType.JUSTIFIED,
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
const processInlineContent = (children) => {
    const textRuns = [];
    let currentFormatting = { bold: false, italics: false, };
    let textBuffer = "";

    const flushBuffer = () => {
        if (textBuffer.trim()) {
            textRuns.push(
                new TextRun({
                    text: textBuffer,
                    font: DOCX_STYLES.fonts.body,
                    bold: currentFormatting.bold,
                    italics: currentFormatting.italics,
                    size: DOCX_STYLES.sizes.body * 2, // docx uses half-points
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
            font: "Arial",
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
              font: "Arial",
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
            font: "Arial",
            color: "2D3748",
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
      })
    );

    // Decorative line
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
      sections.push(
        new Paragraph({
          children: [
            new TextRun({
              text: chapter.title || `Chapter ${index + 1}`,
              bold: true,
              size: 36, // 18pt
              font: "Arial",
              color: "1A202C",
            }),
          ],
          spacing: { before: 200, after: 300 },
        })
      );

      // Chapter Content
      const content = chapter.content || "";

      if (content.trim()) {
        // Split into paragraphs (simple & reliable)
        const paragraphs = content
          .split(/\n\s*\n/)
          .map((p) => p.trim())
          .filter((p) => p.length > 0);

        paragraphs.forEach((para) => {
          // Clean basic markdown
          const cleanText = para
            .replace(/^#{1,6}\s+/gm, "")
            .replace(/\*\*(.*?)\*\*/g, "$1")
            .replace(/\*(.*?)\*/g, "$1")
            .replace(/`(.*?)`/g, "$1")
            .replace(/^\s*[-*+]\s+/gm, "• ")
            .trim();

          if (cleanText) {
            sections.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: cleanText,
                    size: 24, // 12pt
                    font: "Times New Roman",
                  }),
                ],
                spacing: { after: 200 },
                alignment: AlignmentType.JUSTIFIED,
              })
            );
          }
        });
      }
    });

    // ========== 4. Create Document ==========
    const doc = new Document({
      sections: [
        {
          properties: {
            page: {
              margin: {
                top: 1440, // 1 inch
                right: 1440,
                bottom: 1440,
                left: 1440,
              },
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

//Typography configuration for modern ebook styling
const TYPOGRAPHY = {
    fonts: {
        serif: "Times New Roman, Times-Roman",
        serifBold: "Times-Bold",
        serifItalic: "Times-Italic",
        sans: "Helvetica",
        sansBold: "Helvetica-Bold",
        sansItalic: "Helvetica-Oblique",
    },
    sizes: {
        title: 28,
        author: 16,
        chapterTitle: 20,
        h1: 18,
        h2: 16,
        h3: 14,
        body: 11,
        caption: 9,
    },
    colors: {
        heading: "#1A1A1A",
        text: "#333333",
        accent: "#4F46E5",
    },
    spacing: {
        paragraphSpacing: 12,
        chapterSpacing: 24,
        headingSpacing: {
            before: 16, after: 8,
        },
        listSpacing: 6,
    },
};

const renderInlineTokens = (doc, tokens, options = {}) => {
    if (!tokens || tokens.length === 0) return;
    const baseOptions = {
        align: options.align || "justify",
        indent: options.indent || 0,
        lineGap: options.lineGap || 2,
    };
    let currentFont = TYPOGRAPHY.fonts.serif;
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
            currentFont = TYPOGRAPHY.fonts.serifBold;
        } else if (token.type === "strong_close") {
            flushBuffer();
            currentFont = TYPOGRAPHY.fonts.serif;
        } else if (token.type === "em_open") {
            flushBuffer();
            currentFont = TYPOGRAPHY.fonts.serifItalic;
        } else if (token.type === "em_close") {
            flushBuffer();
            currentFont = TYPOGRAPHY.fonts.serif;
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
const renderMarkdown = (doc, markdown) => {
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
                    fontSize = TYPOGRAPHY.sizes.h1;
                    break;
                case 2:
                    fontSize = TYPOGRAPHY.sizes.h2;
                    break;
                case 3:
                    fontSize = TYPOGRAPHY.sizes.h3;
                    break;
                default:
                    fontSize = TYPOGRAPHY.sizes.h3;
                    
            }
            doc.moveDown(TYPOGRAPHY.spacing.headingSpacing.before / TYPOGRAPHY.sizes.body);
            doc.font(TYPOGRAPHY.fonts.sansBold).fontSize(fontSize)
            .fillColor(TYPOGRAPHY.colors.heading)
            if (i + 1 < tokens.length && tokens[i + 1].type === "inline") {
                renderInlineTokens(doc, tokens[i + 1].children, { align: "left", lineGap: 0});
                i++; // Skip the heading text and closing tag
            }
            doc.moveDown(TYPOGRAPHY.spacing.headingSpacing.after / TYPOGRAPHY.sizes.body);
            if (i + 1 < tokens.length && tokens[i + 1].type === "heading_close") {
                i++; // Skip the closing tag
            }
        } else if (token.type === "paragraph_open") {
            doc
               .font(TYPOGRAPHY.fonts.serif)
               .fontSize(TYPOGRAPHY.sizes.body)
               .fillColor(TYPOGRAPHY.colors.text);

            if (i + 1 < tokens.length && tokens[i + 1].type === "inline") {
                renderInlineTokens(doc, tokens[i + 1].children, { align: "justify", lineGap: 2});
                i++; // Skip the paragraph text and closing tag
            }

            if(!inList) {
                doc.moveDown(TYPOGRAPHY.spacing.paragraphSpacing / TYPOGRAPHY.sizes.body);
            
            }

            if (i + 1 < tokens.length && tokens[i + 1].type === "paragraph_close") {
                i++; // Skip the closing tag
            }
        } else if (token.type === "bullet_list_open") {
            inList = true;
            listType = "bullet";
            doc.moveDown(TYPOGRAPHY.spacing.listSpacing / TYPOGRAPHY.sizes.body);
            
        }
        else if (token.type === "bullet_list_close") {
            inList = false;
            listType = null;
            doc.moveDown(TYPOGRAPHY.spacing.paragraphSpacing / TYPOGRAPHY.sizes.body);
        }
        else if (token.type === "ordered_list_open") {
            inList = true;
            listType = "ordered";
            orderedCounter = 1;
            doc.moveDown(TYPOGRAPHY.spacing.listSpacing / TYPOGRAPHY.sizes.body);
        }
        else if (token.type === "ordered_list_close") {
            inList = false;
            listType = null;
            orderedCounter = 1;
            doc.moveDown(TYPOGRAPHY.spacing.paragraphSpacing / TYPOGRAPHY.sizes.body);
        }
        else if (token.type === "list_item_open") {
           let bullet = "";
            if (listType === "bullet") {
                bullet = "• ";
            } else if (listType === "ordered") {
                bullet = `${orderedCounter}. `;
                orderedCounter++;
            }
            doc.font(TYPOGRAPHY.fonts.serif).fontSize(TYPOGRAPHY.sizes.body).fillColor(TYPOGRAPHY.colors.text);
            doc.text(bullet, {indent: 20, continued: true });
           for (let j = i + 1; j < tokens.length; j++) {
            if (tokens[j].type === "inline" && tokens[j].children) {
                renderInlineTokens(doc, tokens[j].children, { align: "left",lineGap:2 });
                  break;
        }else if(tokens[j].type === "list_item_close") {
        break;
    }
    
    }
   doc.moveDown(TYPOGRAPHY.spacing.listSpacing / TYPOGRAPHY.sizes.body);
        } else if(token.type === "code_block" || token.type === "fence") {
            doc.moveDown(TYPOGRAPHY.spacing.paragraphSpacing / TYPOGRAPHY.sizes.body);
            doc
            .font("Courier")
            .fontSize(9)
            .fillColor(TYPOGRAPHY.colors.text)
            .text(token.content, {align: "left", indent: 20});

            doc.font(TYPOGRAPHY.fonts.serif).fontSize(TYPOGRAPHY.sizes.body).fillColor(TYPOGRAPHY.colors.text);
            doc.moveDown(TYPOGRAPHY.spacing.paragraphSpacing / TYPOGRAPHY.sizes.body);
            
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

    const doc = new PDFDocument({
      margins: { top: 72, bottom: 72, left: 72, right: 72 },
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
      .font("Helvetica-Bold")
      .fontSize(28)
      .fillColor("#1A1A1A")
      .text(book.title || "Untitled", { align: "center" });

    doc.moveDown(1.5);

    if (book.subtitle && book.subtitle.trim()) {
      doc
        .font("Helvetica")
        .fontSize(16)
        .fillColor("#4A5568")
        .text(book.subtitle, { align: "center" });
      doc.moveDown(1);
    }

    doc
      .font("Helvetica")
      .fontSize(14)
      .fillColor("#2D3748")
      .text(`by ${book.author || "Unknown Author"}`, { align: "center" });

    // ========== Chapters ==========
    if (book.chapters && book.chapters.length > 0) {
      book.chapters.forEach((chapter, index) => {
        doc.addPage();

        // Chapter Title
        doc
          .font("Helvetica-Bold")
          .fontSize(20)
          .fillColor("#1A1A1A")
          .text(chapter.title || `Chapter ${index + 1}`, {
            align: "left",
          });

        doc.moveDown(1.5);

        // Chapter Content (simple & reliable)
        const content = chapter.content || "";
        if (content.trim()) {
          // Convert basic markdown to plain text for reliability
          const plainText = content
            .replace(/^#{1,6}\s+/gm, "") // remove headings
            .replace(/\*\*(.*?)\*\*/g, "$1") // bold
            .replace(/\*(.*?)\*/g, "$1") // italic
            .replace(/`(.*?)`/g, "$1") // inline code
            .replace(/^\s*[-*+]\s+/gm, "• ") // bullets
            .replace(/^\s*\d+\.\s+/gm, "") // ordered lists
            .trim();

          doc
            .font("Times-Roman")
            .fontSize(11)
            .fillColor("#333333")
            .text(plainText, {
              align: "justify",
              lineGap: 4,
              paragraphGap: 8,
            });
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
module.exports = {
    exportAsDocument,
    exportAsPDF
};
