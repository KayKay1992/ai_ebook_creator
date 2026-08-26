const { GoogleGenAI } = require("@google/genai");
const { buildVoiceProfileInstruction } = require("../utils/voiceProfile");
const Book = require("../models/Book");

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// The @google/genai SDK throws an ApiError with a real HTTP `.status` for
// anything the Gemini API itself rejected (quota exhaustion, transient
// overload, etc.) — surfacing that distinction instead of a generic
// "Server Error" is the difference between a reader knowing to just try
// again shortly and a dead end that looks like a real bug. Confirmed via a
// real reproduction (see generate-intro-conclusion's original fix): this
// project's Gemini key hit its free-tier daily quota (429/RESOURCE_EXHAUSTED)
// during testing, and an undifferentiated catch-all was what turned that
// into an unhelpful bare 500 with no way for the reader to know it was
// transient. Returns null for anything that isn't a recognized Gemini API
// error, so callers can fall back to their own generic message.
const aiErrorMessage = (error) => {
  if (error?.status === 429) {
    return "The AI service has hit its usage limit for now. Please try again in a few minutes.";
  }
  if (error?.status === 503) {
    return "The AI service is temporarily overloaded. Please try again in a moment.";
  }
  return null;
};

// Shared by every non-streaming AI endpoint below. Streaming endpoints
// (generateChapterContent, editSelection) can't use this — by the time
// their Gemini call runs, res.writeHead(200, ...) has already committed
// the response, so a later error can only be communicated through the SSE
// "error" event's message field, not a different HTTP status. They call
// aiErrorMessage directly instead.
const sendAiErrorResponse = (res, error, fallbackMessage) => {
  const message = aiErrorMessage(error);
  if (message) {
    return res.status(error.status).json({ message });
  }
  return res.status(500).json({ message: fallbackMessage });
};

//@desc Generate a book outline
//@route POST /api/ai/generate-outline
//@access Private
const generateOutline = async (req, res) => {
  try {
    const { topic, tones, numChapters, description, title, useIntroConclusionStructure } = req.body;

    if (!topic && !title) {
      return res.status(400).json({ message: "Topic or title is required" });
    }

    const voiceInstruction = buildVoiceProfileInstruction(
      Array.isArray(tones) && tones.length ? tones : ["Informative"]
    );

    // Default-on, same as the Book schema's default — only an explicit
    // `false` (the toggle actually switched off) skips the forced structure.
    const useIntroConclusion = useIntroConclusionStructure !== false;

    const prompt = `
You are an elite book architect and professional non-fiction outline designer.

Create a high-quality, modern, and well-structured book outline based on the following details:

Book Title: "${title || topic}"
${topic ? `Topic/Category: "${topic}"` : ""}
${description ? `Specific Description: "${description}"` : ""}
Voice & Tone: ${voiceInstruction}
Number of Chapters: ${numChapters || 5}
${description ? `\nThe Specific Description above is this book's actual angle, argument, audience, or premise, not just a restatement of the topic. The entire outline, every chapter title and every chapter description, must be built around this specific description. Someone reading only the outline should be able to tell what makes this particular book's approach distinct, not just recognize the general topic.\n` : ""}
${useIntroConclusion ? `\n### Introduction & Conclusion Convention\nChapter 1 must be a genuine Introduction: it sets up the book's core premise and the specific promise being made to the reader, establishes why this matters to them right now, and previews the journey ahead, not a generic "welcome to this book" filler chapter. Its title must literally include the word "Introduction".\nThe final chapter (chapter ${numChapters || 5}) must be a genuine Conclusion: it synthesizes the book's key ideas and gives the reader concrete, actionable next steps or takeaways they can actually apply, not a vague summary or restatement. Its title must literally include the word "Conclusion".\nThe chapters in between carry the book's actual core content and progression.\n` : ""}
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
    sendAiErrorResponse(res, error, "Server Error");
  }
};

const MAX_EXTEND_CHAPTERS = 10;

// A chapter counts as "the Conclusion" only if its title literally says so
// — the same word generateOutline is instructed to put there when
// useIntroConclusionStructure is on (see above), so this stays reliable
// against outlines this app actually generated rather than trusting the
// book-level toggle blindly (a manually renamed or manually added final
// chapter shouldn't be silently treated as a conclusion just because the
// toggle happens to be on).
const isConclusionChapter = (chapter) => /conclusion/i.test(chapter?.title || "");

//@desc Generate N new chapter outline entries that continue an existing book's arc
//@route POST /api/ai/extend-outline/:bookId
//@access Private
const extendOutline = async (req, res) => {
  try {
    const { bookId } = req.params;
    const requestedCount = Number(req.body.count);
    const count = Math.min(
      MAX_EXTEND_CHAPTERS,
      Math.max(1, Number.isFinite(requestedCount) ? requestedCount : 5)
    );

    const book = await Book.findById(bookId);
    if (!book) {
      return res.status(404).json({ message: "Book not found" });
    }
    if (book.userId.toString() !== req.user._id.toString()) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const existingChapters = book.chapters || [];
    const hasConclusion =
      book.useIntroConclusionStructure &&
      existingChapters.length > 0 &&
      isConclusionChapter(existingChapters[existingChapters.length - 1]);

    // Context chapters exclude the trailing Conclusion, if any — the new
    // chapters need to be written as leading UP TO it, not past it, and
    // showing the model its own conclusion as "recent context to continue
    // from" would invite it to write a second ending.
    const contextChapters = hasConclusion
      ? existingChapters.slice(0, -1)
      : existingChapters;
    const conclusionChapter = hasConclusion
      ? existingChapters[existingChapters.length - 1]
      : null;

    const voiceInstruction = buildVoiceProfileInstruction(
      Array.isArray(book.voiceProfile?.tones) && book.voiceProfile.tones.length
        ? book.voiceProfile.tones
        : ["Informative"]
    );

    const existingChaptersList = contextChapters.length
      ? contextChapters
          .map((c, i) => `${i + 1}. "${c.title}" — ${c.description || "(no description)"}`)
          .join("\n")
      : "(none yet — this book has no chapters written yet)";

    const prompt = `
You are an elite book architect continuing the outline of an existing, in-progress book. You are NOT starting a new book, you are extending one that already has a defined arc and voice.

Book Title: "${book.title}"
${book.description ? `Specific Description: "${book.description}"` : ""}
Voice & Tone: ${voiceInstruction}

### Existing chapters (in order, already written into this book's outline)
${existingChaptersList}
${conclusionChapter ? `\nThis book already ends with a Conclusion chapter, titled "${conclusionChapter.title}", which must remain the final chapter of the book. Do NOT write another conclusion, wrap-up, or "final thoughts" chapter, and do NOT reference this as the end of the book, the ${count} new chapters you generate come BEFORE it, extending the book's core content.` : ""}

### Task
Generate exactly ${count} NEW chapters that continue this book's actual arc coherently from where the existing chapters leave off. They must:
- Follow logically from the last existing chapter above, not restart the topic or repeat ground already covered
- Stay tightly connected to this specific book's established premise, argument, and voice, not just be generically related to the same broad subject
- Build in the same natural progression the rest of the book already established (deeper insight, new angles, or the next logical stage of the argument)
- Match this voice and tone throughout: ${voiceInstruction}

### Chapter Description Rules:
- Each description must be 2–3 well-written sentences
- Clearly explain what the reader will learn
- Make it specific and valuable
- Avoid filler language
- Never use the em dash symbol (—). Use a comma, period, or colon instead.

### Output Format:
Return ONLY a valid JSON array of exactly ${count} entries. No markdown, no explanations, no extra text.

Example format:
[
  {
    "title": "Chapter Title Here",
    "description": "2-3 sentence description of what this chapter covers and what the reader will learn."
  }
]

Generate the ${count} new chapters now:
`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    const text = response.text;
    const startIndex = text.indexOf("[");
    const endIndex = text.lastIndexOf("]");

    if (startIndex === -1 || endIndex === -1) {
      console.error("JSON array not found in AI response:", text);
      return res.status(500).json({ message: "Failed to generate additional chapters" });
    }

    const jsonString = text.substring(startIndex, endIndex + 1);

    try {
      const outline = JSON.parse(jsonString);
      // insertBeforeIndex tells the client exactly where in the CURRENT
      // book.chapters array to splice these new entries in — computed here,
      // once, rather than asking the client to re-derive the same
      // conclusion-detection logic and risk drifting out of sync with it.
      const insertBeforeIndex = hasConclusion
        ? existingChapters.length - 1
        : existingChapters.length;
      res.status(200).json({ outline, insertBeforeIndex });
    } catch (e) {
      console.error("Failed to parse AI response:", jsonString);
      res.status(500).json({ message: "Failed to generate additional chapters" });
    }
  } catch (error) {
    console.error("Error extending outline:", error);
    sendAiErrorResponse(res, error, "Server Error");
  }
};

// A short excerpt is enough signal for framing an Introduction/Conclusion
// around a chapter without ballooning the prompt — same reasoning and size
// as generateBlurb's chapterExcerpts. Falls back to the chapter's
// description when it has no content yet (e.g. its outline entry was
// generated or added but per-chapter content generation hasn't run).
const chapterContextExcerpt = (chapter) => {
  const content = (chapter?.content || "").trim();
  if (content) return content.slice(0, 1000);
  return chapter?.description || "(no description available)";
};

//@desc Generate a dedicated Introduction chapter and Conclusion chapter to retrofit onto an existing book, without touching any existing chapter
//@route POST /api/ai/generate-intro-conclusion/:bookId
//@access Private
const generateIntroConclusion = async (req, res) => {
  try {
    const { bookId } = req.params;

    const book = await Book.findById(bookId);
    if (!book) {
      return res.status(404).json({ message: "Book not found" });
    }
    if (book.userId.toString() !== req.user._id.toString()) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const chapters = book.chapters || [];
    if (chapters.length === 0) {
      return res.status(400).json({ message: "This book has no chapters yet." });
    }

    const firstChapter = chapters[0];
    const lastChapter = chapters[chapters.length - 1];
    const voiceInstruction = book.voiceProfile?.instruction || "";

    const prompt = `
You are an elite book architect retrofitting a dedicated Introduction and Conclusion onto an existing, already-written book. You are NOT writing or rewriting the book itself, only these two bookend chapters that go around it.

Book Title: "${book.title}"
${book.description ? `Specific Description: "${book.description}"` : ""}
Voice & Tone: ${voiceInstruction}

### The book's actual first chapter (what the new Introduction must set up)
Title: "${firstChapter.title}"
${chapterContextExcerpt(firstChapter)}

### The book's actual last chapter (what the new Conclusion must synthesize)
Title: "${lastChapter.title}"
${chapterContextExcerpt(lastChapter)}

### Task
Generate exactly two new chapters:
1. An Introduction that will be placed BEFORE the first chapter above. It must set up this specific book's actual premise and the promise being made to the reader, grounded in what the first chapter above actually covers, not a generic "welcome to this book" filler chapter. Its title must literally include the word "Introduction".
2. A Conclusion that will be placed AFTER the last chapter above. It must synthesize the whole book's arc, picking up from the actual note the last chapter above leaves off on, and give the reader concrete, actionable next steps or takeaways they can apply. Its title must literally include the word "Conclusion".

Match this voice and tone throughout: ${voiceInstruction}

### Chapter Description Rules:
- Each description must be 2–3 well-written sentences
- Clearly explain what the reader will learn
- Make it specific and valuable
- Avoid filler language
- Never use the em dash symbol (—). Use a comma, period, or colon instead.

### Output Format:
Return ONLY a valid JSON object, no markdown, no explanations, no extra text, in exactly this shape:
{
  "introduction": { "title": "Chapter title here", "description": "2-3 sentence description" },
  "conclusion": { "title": "Chapter title here", "description": "2-3 sentence description" }
}

Generate them now:
`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    const text = response.text;
    const startIndex = text.indexOf("{");
    const endIndex = text.lastIndexOf("}");

    if (startIndex === -1 || endIndex === -1) {
      console.error("JSON object not found in AI response:", text);
      return res.status(500).json({ message: "Failed to generate introduction/conclusion" });
    }

    const jsonString = text.substring(startIndex, endIndex + 1);

    try {
      const result = JSON.parse(jsonString);
      if (!result.introduction?.title || !result.conclusion?.title) {
        throw new Error("Response missing introduction or conclusion");
      }
      res.status(200).json(result);
    } catch (e) {
      console.error("Failed to parse AI response:", jsonString);
      res.status(500).json({ message: "Failed to generate introduction/conclusion" });
    }
  } catch (error) {
    console.error("Error generating introduction/conclusion:", error);
    sendAiErrorResponse(res, error, "Server Error");
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
        // By this point res.writeHead(200, ...) has already committed the
        // response — an HTTP status can no longer change, so the same
        // quota/overload distinction aiErrorMessage gives every other AI
        // endpoint travels through the SSE "error" event's message field
        // instead (see EditorPage.jsx: this becomes the thrown Error's
        // .message, which the toast then shows directly).
        sendEvent("error", { message: aiErrorMessage(streamError) || "Failed to generate content" });
      }
    } finally {
      res.end();
    }
  } catch (error) {
    console.error("Error generating chapter content:", error);
    if (!res.headersSent) {
      sendAiErrorResponse(res, error, "Server Error");
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
  rewrite:
    "Substantially rewrite the passage: restructure the sentences, change the word choice and phrasing throughout, and present the same ideas in a genuinely different way, not just a lighter polish. This should go well beyond a normal 'improve' pass, the reader should recognize it as a different way of saying the same thing, not the same sentences smoothed over. Preserve the core meaning and key information exactly, and do not introduce new ideas.",
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
    const { selectedText, action, surroundingContext, bookId, hint } = req.body;

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

    // A hint only ever applies to "rewrite" — the other four actions have
    // one fixed behavior by design (per this session's scoping), so it's
    // silently ignored for them rather than erroring, same tolerance as
    // any other field the client happens to send that isn't relevant here.
    const rewriteHint = action === "rewrite" && hint && hint.trim() ? hint.trim() : "";
    const actionInstruction = rewriteHint
      ? `${EDIT_ACTION_INSTRUCTIONS.rewrite} Specific instruction from the user for how this should be rewritten: "${rewriteHint}". This specific instruction should be the dominant guide for how the rewrite actually comes out, not just a minor influence alongside the general rewrite behavior above.`
      : EDIT_ACTION_INSTRUCTIONS[action];

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
        // Same reasoning as generateChapterContent: headers are already
        // committed by this point, so the quota/overload distinction
        // travels through the SSE "error" event's message field instead of
        // an HTTP status.
        sendEvent("error", { message: aiErrorMessage(streamError) || "Failed to generate edit" });
      }
    } finally {
      res.end();
    }
  } catch (error) {
    console.error("Error editing selection:", error);
    if (!res.headersSent) {
      sendAiErrorResponse(res, error, "Server Error");
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
    sendAiErrorResponse(res, error, "Server Error");
  }
};

module.exports = {
  generateOutline,
  extendOutline,
  generateIntroConclusion,
  generateChapterContent,
  editSelection,
  generateBlurb,
};
