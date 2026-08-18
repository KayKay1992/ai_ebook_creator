const { GoogleGenAI } = require("@google/genai");
const { buildVoiceProfileInstruction } = require("../utils/voiceProfile");
const Book = require("../models/Book");

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

//@desc Generate a book outline
//@route POST /api/ai/generate-outline
//@access Private
const generateOutline = async (req, res) => {
  try {
    const { topic, tones, numChapters, description, title } = req.body;

    if (!topic && !title) {
      return res.status(400).json({ message: "Topic or title is required" });
    }

    const voiceInstruction = buildVoiceProfileInstruction(
      Array.isArray(tones) && tones.length ? tones : ["Informative"]
    );

    const prompt = `
You are an elite book architect and professional non-fiction outline designer.

Create a high-quality, modern, and well-structured book outline based on the following details:

Book Title / Topic: "${title || topic}"
${description ? `Description: "${description}"` : ""}
Voice & Tone: ${voiceInstruction}
Number of Chapters: ${numChapters || 5}

### Outline Requirements:
1. Generate exactly ${numChapters || 5} chapters.
2. Chapter titles must be clear, elegant, and engaging.
3. Each chapter must build logically on the previous one.
4. Create a natural progression from introduction → core ideas → deeper insights → conclusion.
5. Apply this voice and tone throughout the titles and descriptions: ${voiceInstruction}
6. Make the outline feel premium, modern, and professional (like a published non-fiction book).
7. Avoid generic or boring titles.
8. Do not include any extra text outside the JSON.

### Chapter Description Rules:
- Each description must be 2–3 well-written sentences
- Clearly explain what the reader will learn
- Make it specific and valuable
- Avoid filler language
- Never use the em dash symbol (—). Use a comma, period, or colon instead.

### Output Format:
Return ONLY a valid JSON array. No markdown, no explanations, no extra text.

Example format:
[
  {
    "title": "Chapter 1: The Foundation of Modern Thinking",
    "description": "This chapter introduces the core ideas that shape the entire book. It explores the importance of the subject and prepares the reader for the journey ahead. Key concepts are introduced in a clear and engaging way."
  },
  {
    "title": "Chapter 2: Building Clarity and Direction",
    "description": "Readers will discover the essential principles that create long-term progress. Practical insights and real-world relevance are introduced. This chapter strengthens the foundation for deeper understanding."
  }
]

Generate the outline now:
`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    const text = response.text;

    // Extract JSON array
    const startIndex = text.indexOf("[");
    const endIndex = text.lastIndexOf("]");

    if (startIndex === -1 || endIndex === -1) {
      console.error("JSON array not found in AI response:", text);
      return res.status(500).json({ message: "Failed to generate outline" });
    }

    const jsonString = text.substring(startIndex, endIndex + 1);

    try {
      const outline = JSON.parse(jsonString);
      res.status(200).json({ outline });
    } catch (e) {
      console.error("Failed to parse AI response:", jsonString);
      res.status(500).json({ message: "Failed to generate outline" });
    }
  } catch (error) {
    console.error("Error generating outline:", error);
    res.status(500).json({ message: "Server Error" });
  }
};

//@desc Generate book content for a chapter
//@route POST /api/ai/generate-chapter-content
//@access Private
const generateChapterContent = async (req, res) => {
  try {
    const { chapterTitle, chapterDescription, tones } = req.body;

    if (!chapterTitle) {
      return res.status(400).json({ message: "Chapter title is required" });
    }

    const voiceInstruction = buildVoiceProfileInstruction(
      Array.isArray(tones) && tones.length ? tones : ["Informative"]
    );

    const prompt = `
You are a premium modern ebook author known for writing elegant, insightful, and highly readable content (similar to books published by major publishers).

Write a complete chapter with these details:

Chapter Title: "${chapterTitle}"
${chapterDescription ? `Chapter Description: "${chapterDescription}"` : ""}
Voice & Tone: ${voiceInstruction}
Length: 1600–2200 words

### Premium Writing Guidelines:
- Follow this voice and tone precisely, throughout the entire chapter: ${voiceInstruction}
- Beyond that specific voice and tone, keep the writing modern and polished
- Use short, readable paragraphs (maximum 4–5 lines)
- Start with a powerful opening hook
- Make the writing flow smoothly with natural transitions
- Include practical insights and real-world relevance
- Add emotional depth and human connection
- Use real-world examples or relatable insights
- Vary sentence length for better rhythm
- Avoid sounding robotic, academic, or overly formal
- Avoid clichés, filler, and generic statements
- Make every paragraph valuable and purposeful
- Make the content feel premium and valuable
- Never use the em dash symbol (—). Use a comma, period, or colon instead.

### Formatting Rules (Markdown):
1. Use ## for section headings
2. Format key concepts like this:
   *Concept Name:* Explanation continues here...
3. Put all direct quotes in italics:
   *"This is a powerful quote."*
4. Occasionally use short standalone italic lines as pull quotes for emphasis
5. Do not include the chapter title at the top
6. End the chapter with a strong, memorable conclusion

### Structure:
- Strong opening
- Clear sections with headings
- Smooth flow between ideas
- Valuable insights throughout
- Practical examples where relevant
- Powerful closing

Return only the clean Markdown content. No extra commentary.
`;

    let clientDisconnected = false;
    req.on("close", () => {
      clientDisconnected = true;
    });

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();

    const sendEvent = (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    let fullText = "";
    try {
      const stream = await ai.models.generateContentStream({
        model: "gemini-2.5-flash",
        contents: prompt,
      });

      for await (const chunk of stream) {
        if (clientDisconnected) break;
        const chunkText = chunk.text;
        if (chunkText) {
          fullText += chunkText;
          sendEvent("chunk", { text: chunkText });
        }
      }

      if (!clientDisconnected) {
        sendEvent("done", { content: fullText });
      }
    } catch (streamError) {
      console.error("Error streaming chapter content:", streamError);
      if (!clientDisconnected) {
        sendEvent("error", { message: "Failed to generate content" });
      }
    } finally {
      res.end();
    }
  } catch (error) {
    console.error("Error generating chapter content:", error);
    if (!res.headersSent) {
      res.status(500).json({ message: "Server Error" });
    } else {
      res.end();
    }
  }
};

// Each action gets its own focused instruction rather than one generic
// "edit this" prompt, so the four actions actually produce meaningfully
// different results instead of variations on the same rewrite.
const EDIT_ACTION_INSTRUCTIONS = {
  shorten:
    "Rewrite the passage to be noticeably shorter and more concise, cutting at least 30-40% of its length. Preserve the key meaning and information. Do not introduce new ideas.",
  improve:
    "Rewrite the passage to improve its clarity, flow, and overall quality. Elevate word choice and sentence rhythm. Preserve the original meaning and keep it roughly the same length. Do not introduce new ideas.",
  "fix-grammar":
    "Correct any grammar, spelling, and punctuation errors in the passage. Make the minimum changes necessary to fix actual errors, do not rewrite phrasing, restructure sentences, or otherwise change the style, voice, or length beyond what's needed to fix the errors.",
  continue:
    "Continue the passage naturally. Return the original passage followed by 2-4 new sentences that continue the thought, forming one seamless passage. Do not rephrase, summarize, or repeat the original text, only add new content after it.",
};

//@desc Rewrite/edit a selected snippet of chapter markdown per a specific action
//@route POST /api/ai/edit-selection
//@access Private
const editSelection = async (req, res) => {
  try {
    const { selectedText, action, surroundingContext, bookId } = req.body;

    if (!selectedText || !selectedText.trim()) {
      return res.status(400).json({ message: "Selected text is required" });
    }
    if (!EDIT_ACTION_INSTRUCTIONS[action]) {
      return res.status(400).json({ message: "Invalid action" });
    }

    // Voice profile is looked up server-side from the book itself (never
    // trusted from the client, same reasoning as bookController.js) —
    // ownership is checked so a bookId for a book the user doesn't own
    // can't be used to probe its voice profile. A missing/unowned book
    // just means the edit proceeds without a voice instruction, rather
    // than failing the whole request.
    let voiceInstruction = "";
    if (bookId) {
      const book = await Book.findById(bookId).select("userId voiceProfile");
      if (book && book.userId.toString() === req.user._id.toString()) {
        voiceInstruction = book.voiceProfile?.instruction || "";
      }
    }

    const actionInstruction = EDIT_ACTION_INSTRUCTIONS[action];

    const prompt = `
You are an expert editorial assistant revising a small section of an existing ebook chapter.

${surroundingContext ? `### Surrounding context (for continuity only — do not repeat or include this in your output)\n${surroundingContext}\n` : ""}
### Passage to edit
"""
${selectedText}
"""

### Task
${actionInstruction}
${voiceInstruction ? `\n### Voice & tone\nThis book has an established voice profile — match it precisely, the same way the rest of the chapter is written: ${voiceInstruction}` : ""}

### Formatting
- The passage may contain Markdown formatting (e.g. **bold**, *italic*, ## headings) — preserve it where it already exists, and match the surrounding style
- Never use the em dash symbol (—). Use a comma, period, or colon instead.
- Return ONLY the replacement passage as clean Markdown text. No explanations, no preamble like "Here's the revised text:", no wrapping quotes.
`;

    let clientDisconnected = false;
    req.on("close", () => {
      clientDisconnected = true;
    });

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();

    const sendEvent = (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    let fullText = "";
    try {
      const stream = await ai.models.generateContentStream({
        model: "gemini-2.5-flash",
        contents: prompt,
      });

      for await (const chunk of stream) {
        if (clientDisconnected) break;
        const chunkText = chunk.text;
        if (chunkText) {
          fullText += chunkText;
          sendEvent("chunk", { text: chunkText });
        }
      }

      if (!clientDisconnected) {
        sendEvent("done", { content: fullText });
      }
    } catch (streamError) {
      console.error("Error streaming selection edit:", streamError);
      if (!clientDisconnected) {
        sendEvent("error", { message: "Failed to generate edit" });
      }
    } finally {
      res.end();
    }
  } catch (error) {
    console.error("Error editing selection:", error);
    if (!res.headersSent) {
      res.status(500).json({ message: "Server Error" });
    } else {
      res.end();
    }
  }
};

//@desc Generate a back-cover blurb from the book's existing chapter content
//@route POST /api/ai/generate-blurb
//@access Private
const generateBlurb = async (req, res) => {
  try {
    const { bookId } = req.body;

    if (!bookId) {
      return res.status(400).json({ message: "bookId is required" });
    }

    const book = await Book.findById(bookId);
    if (!book) {
      return res.status(404).json({ message: "Book not found" });
    }
    if (book.userId.toString() !== req.user._id.toString()) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const writtenChapters = (book.chapters || []).filter(
      (c) => c.content && c.content.trim()
    );
    if (writtenChapters.length === 0) {
      return res.status(400).json({
        message: "Write some chapter content first — there's nothing to summarize yet.",
      });
    }

    const voiceInstruction = book.voiceProfile?.instruction || "";

    // A short excerpt per chapter (not the full manuscript) is plenty of
    // signal for back-cover copy and keeps the prompt a reasonable size.
    const chapterExcerpts = writtenChapters
      .slice(0, 6)
      .map((c, i) => `Chapter ${i + 1}: ${c.title}\n${(c.content || "").slice(0, 600)}`)
      .join("\n\n");

    const prompt = `
You are a professional back-cover copywriter for published books.

Book Title: "${book.title}"
${book.subtitle ? `Subtitle: "${book.subtitle}"` : ""}
Author: ${book.author}

Here are excerpts from the book, across its chapters:
${chapterExcerpts}

### Task
Write a compelling back-cover blurb for this book, in the style of real
published back-cover copy. 2-4 short paragraphs, roughly 80-150 words total.
Hook the reader in the first sentence. Make it feel professional and
enticing, not like a generic AI summary of the content.
${voiceInstruction ? `\n### Voice & tone\nMatch the book's established voice: ${voiceInstruction}` : ""}

Never use the em dash symbol (—). Use a comma, period, or colon instead.

Return ONLY the blurb text. No heading, no wrapping quotation marks, no commentary.
`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    const blurb = (response.text || "").trim();
    if (!blurb) {
      return res.status(500).json({ message: "Failed to generate blurb" });
    }

    res.status(200).json({ blurb });
  } catch (error) {
    console.error("Error generating blurb:", error);
    res.status(500).json({ message: "Server Error" });
  }
};

module.exports = {
  generateOutline,
  generateChapterContent,
  editSelection,
  generateBlurb,
};
