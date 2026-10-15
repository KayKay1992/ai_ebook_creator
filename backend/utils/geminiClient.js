const { GoogleGenAI } = require('@google/genai');

// The Gemini client for background work (narration, translations): one
// instance, created on first use, with a request timeout so a stuck call
// can't hold a job forever. (The interactive AI endpoints in
// aiController.js keep their own client.)
let client = null;
const getClient = () => {
    if (!client) {
        client = new GoogleGenAI({
            apiKey: process.env.GEMINI_API_KEY,
            // A ~2-minute narration chunk or a ~6,000-character translation
            // chunk normally takes well under a minute.
            httpOptions: { timeout: 180000 },
        });
    }
    return client;
};

module.exports = { getClient };
