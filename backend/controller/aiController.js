const { GoogleGenAI } = require("@google/genai");

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

//@desc Generate a book outline
//@route POST /api/ai/generate-outline
//@access Private
const generateOutline = async (req, res) => {
  try {
    const { topic, style, numChapters, description } = req.body;

    if (!topic) {
      return res.status(400).json({ message: "Topic is required" });
    }
    const prompt = `You are an expert book outline generator. create a comprehensive book outline based on the following details:
    
    Topic: "${topic}"
    ${description ? `Description: "${description}"` : ""}
    Writing Style: ${style}
    Number of Chapters: ${numChapters || 5}

    Requirements:
    1. Generate exactly ${numChapters || 5} chapters.
    2. Each chapter title should be clear, engaging, and follow a logical progression.
    3. Each chapter description should be 2-3 sentences explaining what the chapter covers.
    4. Ensure chapters build upon each other coherently, providing a structured flow of information.
    5. Match the "${style}" writing style in your titles and descriptions.
    6. Avoid any unnecessary information or details in the chapter descriptions.
    7. Use the provided topic and description to guide the outline. Do not generate chapters unrelated to the topic or description.

    Output Format:
    Return ONLY a valid JSON array with no additional text, markdown, or formatting. Each object must have exactly two keys: "title" and "description". The JSON array should look like this:
    [
      {
        "title": "Chapter 1:  Introduction to the Topic",
        "description": "A comprehensive overview of the topic, its significance, and what readers can expect to learn in the book. Introducing the main concepts. Sets the foundation for understanding the subject matter."
      },
      {
        "title": "Chapter 2:  Core Concepts and Principles",
        "description": "Explores the fundamental concepts and principles related to the topic. Provides detailed explanations, examples, and practical applications. Helps readers grasp the essential knowledge needed for deeper understanding.Provides a detailed examples and real-world applications to illustrate the concepts. Offers insights into how these principles can be applied in various contexts."
      },
    ]
      Generate the outline now:
    `;
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    const text = response.text;

    //Find and extract the JSON array from the response text
    const startIndex = text.indexOf("[");
    const endIndex = text.lastIndexOf("]");

    if (startIndex === -1 || endIndex === -1) {
      console.error("JSON array not found in the AI response text:", text);
      return res.status(500).json({ message: "Failed to generate outline" });
    }
    const jsonString = text.substring(startIndex, endIndex + 1);

    //validate if response is a valid JSON
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
           You are an expert writer specializing in ${style} content. Write a complete chapter for a book with the following specifications:

            Chapter Title: "${chapterTitle}"
            ${chapterDescription ? `Chapter Description: "${chapterDescription}"` : ""}
            Writing Style: ${style}
            Target Length: Comprehensive and detailed, approximately 1500-2500 words.

            Requirements:
            1. Write in a ${style.toLowerCase()} tone throughout the chapter.
            2. Structure the chapter with clear sections and smooth transitions between ideas.
            3. Include relevant examples, explanations, or anecdotes to illustrate key points as appropriate for the style.
            4. Ensure the content is original, engaging, and free from plagiarism.
            5. Avoid any unnecessary filler content; every paragraph should contribute to the chapter's purpose.
            6. Ensure the content flows logically and maintains the reader's interest from start to finish.
            7. Make the content informative, educational, and valuable to the reader, providing insights or actionable takeaways where relevant.
            8. Make the content engaging and valuable to the readers ${chapterDescription ? `6. Cover all points mentioned in the chapter description` : ""}.

            Output Guidelines:
            - Start with a compelling opening paragraph that sets the tone and introduces the chapter's main idea.
            - Use clear paragraph breaks for readability 
            - Include subheadings if appropriate to organize the content and enhance clarity.
            - Conclude with a strong closing paragraph that summarizes the key points and reinforces the chapter's main message or transition to the next chapter.
            - Write ain plain text without markdown formatting.

            Generate the chapter content now:
           `;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: prompt,
    });
    const text = response.text;
    res.status(200).json({ content: text });
  } catch (error) {
    console.error("Error generating chapter content:", error);
    res.status(500).json({ message: "Server Error" });
  }
};

module.exports = {
  generateOutline,
  generateChapterContent,
};
