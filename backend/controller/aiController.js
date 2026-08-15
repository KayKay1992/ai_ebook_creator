const { GoogleGenAI } = require("@google/genai");

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

//@desc Generate a book outline
//@route POST /api/ai/generate-outline
//@access Private
const generateOutline = async (req, res) => {
  try {
    const { topic, style, numChapters, description, title } = req.body;

    if (!topic && !title) {
      return res.status(400).json({ message: "Topic or title is required" });
    }

    const prompt = `
You are an elite book architect and professional non-fiction outline designer.

Create a high-quality, modern, and well-structured book outline based on the following details:

Book Title / Topic: "${title || topic}"
${description ? `Description: "${description}"` : ""}
Writing Style: ${style || "Informative"}
Number of Chapters: ${numChapters || 5}

### Outline Requirements:
1. Generate exactly ${numChapters || 5} chapters.
2. Chapter titles must be clear, elegant, and engaging.
3. Each chapter must build logically on the previous one.
4. Create a natural progression from introduction → core ideas → deeper insights → conclusion.
5. Match the "${style || "Informative"}" tone in the titles and descriptions.
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
    const { chapterTitle, chapterDescription, style } = req.body;

    if (!chapterTitle) {
      return res.status(400).json({ message: "Chapter title is required" });
    }

    const prompt = `
You are a premium modern ebook author known for writing elegant, insightful, and highly readable content (similar to books published by major publishers).

Write a complete chapter with these details:

Chapter Title: "${chapterTitle}"
${chapterDescription ? `Chapter Description: "${chapterDescription}"` : ""}
Writing Style: ${style || "Informative"}
Length: 1600–2200 words

### Premium Writing Guidelines:
- Write in a modern, elegant, and sophisticated tone
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

module.exports = {
  generateOutline,
  generateChapterContent,
};
