import { Languages } from "lucide-react";

// Language picker for a book's published AI translations: "Original" plus
// each language that has at least one published chapter. Shown only when
// there is something to pick. Used on the reader and the book detail page.
const ReadingLanguageSelect = ({ languages = [], value = "", onChange, compact = false, id = "reading-language" }) => {
  if (!languages.length) return null;
  return (
    <label
      htmlFor={id}
      className={`flex items-center gap-1.5 text-sm text-gray-600 ${compact ? "" : "font-medium"}`}
      title="Read in another language (AI-translated)"
    >
      <Languages className={`w-4 h-4 text-gray-400 flex-shrink-0 ${compact ? "hidden sm:block" : ""}`} />
      <span className={compact ? "sr-only" : ""}>Language</span>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`bg-white border border-gray-200 rounded-xl px-2.5 py-1.5 text-sm text-gray-900 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500 ${compact ? "max-w-[6.5rem] sm:max-w-[11rem]" : "max-w-[11rem]"}`}
      >
        <option value="">Original</option>
        {languages.map((language) => (
          <option key={language.code} value={language.code}>
            {language.nativeName && language.nativeName !== language.name
              ? `${language.nativeName} (${language.name})`
              : language.name}
          </option>
        ))}
      </select>
    </label>
  );
};

export default ReadingLanguageSelect;
