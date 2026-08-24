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
  "Storytelling",
  "Brutal Honest",
  "Humour",
  "Practical Wisdom",
  "Nigerian Realities",
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
// - Storytelling, on its own, doesn't say what to do differently from
//   "Narrative" as a bare adjective — it needs to explicitly push toward
//   anecdotes/scenes/concrete examples, including inside non-fiction, or
//   the model just writes normal exposition with a slightly warmer voice.
// - Brutal Honest is the one most likely to be misread in the wrong
//   direction — echoed as a bare label it invites actual rudeness. The
//   instruction has to name both halves explicitly: direct/unflinching
//   AND not cruel/dismissive, or only one half survives in practice.
// - Humour as a bare label just gets content described as funny without
//   anything in the prose actually being funny — it needs to point at
//   actual comedic technique (wit, dry asides, playful phrasing).
// - Practical Wisdom needs to be pointed at actionability specifically,
//   or "wisdom" alone tends to pull the model toward abstract, reflective
//   prose — the opposite of what this tone is for.
// - Nigerian Realities is the tone most likely to be satisfied only
//   superficially (the word "Nigeria" dropped into a couple of sentences
//   without the underlying specificity). The instruction below names
//   concrete domains (power supply, transport, the naira/cost of living,
//   family/community obligations, the informal economy) as anchors and
//   states the actual bar explicitly — a Nigerian reader should recognize
//   their own daily reality in it, not just see the word "Nigeria."
const TONE_GUIDANCE = {
  "Beginner-Friendly":
    "written in an accessible, easy-to-understand way for readers with no prior knowledge of the subject, avoiding jargon and explaining concepts simply",
  "Fictional":
    "written as a fictional narrative, with invented characters or events in service of the ideas, rather than as factual, non-fiction prose",
  "Relatable":
    "grounded in relatable, everyday examples and analogies the reader can personally connect with",
  "Storytelling":
    "built around narrative — real or illustrative anecdotes, scenes, and concrete examples — rather than dry exposition, even when the content itself is non-fiction",
  "Brutal Honest":
    "direct and honest, willing to state uncomfortable truths plainly and without softening language for the sake of comfort — but never cruel, mocking, or dismissive of the reader",
  "Humour":
    "genuinely witty, using real comedic technique — playful phrasing, dry asides, well-placed levity — rather than simply being described as funny with nothing in the prose that actually earns a laugh",
  "Practical Wisdom":
    "focused on actionable, real-world guidance the reader can actually apply, favoring concrete takeaways and specific steps over abstract theory",
  "Nigerian Realities":
    "grounded in genuine Nigerian context — specific, recognizable references to Nigerian everyday life, economy, and culture (e.g. power supply realities, transportation like okada and danfo, the naira and cost of living, family and community obligations, the informal/hustle economy, local markets) rather than generic or Western-default framing — written with enough real specificity that a Nigerian reader recognizes their own daily reality in it, not just the word \"Nigeria\" inserted a few times",
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
