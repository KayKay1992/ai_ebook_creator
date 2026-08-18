// Fixed list of selectable tones for a book's voice profile. Order is
// meaningful only for display (frontend/src/components/shared/TonePicker.jsx
// mirrors this list by hand — keep both in sync).
const TONE_OPTIONS = [
  "Informative",
  "Conversational",
  "Relatable",
  "Persuasive",
  "Educational",
  "Beginner-Friendly",
  "Entertaining",
  "Inspirational",
  "Narrative",
  "Technical",
  "Philosophical",
  "Fictional",
];

// Some tones aren't really "adjectives for a sentence" — echoing the label
// back at the model ("Write in a beginner-friendly tone") doesn't actually
// tell it what to change. These get expanded into concrete guidance instead.
//
// - Beginner-Friendly changes the *complexity level* of the writing, not
//   just its voice, so it needs explicit instruction about jargon/assumed
//   knowledge or the model tends to just use friendlier words at the same
//   difficulty level.
// - Fictional isn't a tone at all, it's a mode (invented narrative vs.
//   factual prose) — "a fictional tone" doesn't parse as an instruction.
// - Relatable benefits from a concrete anchor (everyday examples/analogies)
//   rather than being left as an abstract adjective, though it's a smaller
//   nudge than the two above.
const TONE_GUIDANCE = {
  "Beginner-Friendly":
    "written in an accessible, easy-to-understand way for readers with no prior knowledge of the subject, avoiding jargon and explaining concepts simply",
  "Fictional":
    "written as a fictional narrative, with invented characters or events in service of the ideas, rather than as factual, non-fiction prose",
  "Relatable":
    "grounded in relatable, everyday examples and analogies the reader can personally connect with",
};

const article = (phrase) => (/^[aeiou]/i.test(phrase) ? "an" : "a");

// Builds a single natural-language instruction from a book's selected
// tones. This is the one place tone -> prompt-instruction happens; both
// outline and chapter-content generation call it so every generation stays
// consistent with whatever the book's voice profile says.
const buildVoiceProfileInstruction = (tones = []) => {
  const clean = [...new Set((tones || []).filter(Boolean))];
  if (clean.length === 0) return "";

  const plainTones = clean.filter((t) => !TONE_GUIDANCE[t]);
  const specialGuidance = clean.filter((t) => TONE_GUIDANCE[t]).map((t) => TONE_GUIDANCE[t]);

  const parts = [];
  if (plainTones.length > 0) {
    const joined = plainTones.map((t) => t.toLowerCase()).join(", ");
    parts.push(`Write in ${article(joined)} ${joined} tone.`);
  }
  if (specialGuidance.length > 0) {
    const lead = plainTones.length > 0 ? "Also make sure the writing is" : "Make sure the writing is";
    parts.push(`${lead} ${specialGuidance.join("; and ")}.`);
  }
  return parts.join(" ");
};

module.exports = { TONE_OPTIONS, TONE_GUIDANCE, buildVoiceProfileInstruction };
