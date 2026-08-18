import toast from "react-hot-toast";

// Mirrors backend/utils/voiceProfile.js's TONE_OPTIONS — keep in sync by
// hand (same pattern as ExportTemplatePicker.jsx mirroring the backend's
// export template metadata).
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

const MAX_TONES = 3;

// Chip/tag multi-select for a book's voice profile — select 1-3 tones.
// `value` is the currently-selected tone array; `onChange` receives the
// next array. The combined instruction text is derived server-side (see
// backend/utils/voiceProfile.js), never computed here.
const TonePicker = ({ value = [], onChange, className = "" }) => {
  const toggleTone = (tone) => {
    if (value.includes(tone)) {
      onChange(value.filter((t) => t !== tone));
      return;
    }
    if (value.length >= MAX_TONES) {
      toast.error(`You can select up to ${MAX_TONES} tones.`);
      return;
    }
    onChange([...value, tone]);
  };

  return (
    <div className={className}>
      <div className="flex flex-wrap gap-2">
        {TONE_OPTIONS.map((tone) => {
          const isSelected = value.includes(tone);
          return (
            <button
              type="button"
              key={tone}
              onClick={() => toggleTone(tone)}
              className={`px-4 py-2 rounded-full text-sm font-medium border transition-all ${
                isSelected
                  ? "bg-accent text-white border-accent shadow-sm"
                  : "bg-white text-gray-600 border-gray-200 hover:border-accent-300"
              }`}
            >
              {tone}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-gray-400 mt-2">
        {value.length}/{MAX_TONES} selected
      </p>
    </div>
  );
};

export default TonePicker;
