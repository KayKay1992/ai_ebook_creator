import { Languages } from "lucide-react";

// Shown at the top of each chapter while the reader is reading a published
// AI translation: the "AI-translated" label, and what that means for
// listening (audio narration is only ever in the original language; Listen
// Mode is off for languages device voices can't read well).
const TranslationNotice = ({ chapter, language, hasAudio, isListenAvailable }) => {
  if (!chapter.isTranslated) {
    return (
      <p className="mb-6 text-sm text-gray-500 bg-gray-50 border border-gray-100 rounded-2xl px-4 py-3">
        This chapter isn't available in {language.name} yet, so it's shown in the original language.
      </p>
    );
  }

  const listening = [];
  if (!isListenAvailable) {
    listening.push(
      `Listen Mode is off for ${language.name}, because device voices can't read it well.` +
        (hasAudio ? " The audiobook player narrates the original language." : " Switch to Original to listen.")
    );
  } else if (hasAudio) {
    listening.push("The audiobook player narrates the original language.");
  }

  return (
    <div className="mb-6 flex flex-col gap-1.5">
      <span className="inline-flex items-center gap-1.5 self-start px-2.5 py-1 rounded-full bg-sky-50 text-sky-700 text-xs font-semibold">
        <Languages className="w-3.5 h-3.5" />
        AI-translated into {language.nativeName || language.name}
      </span>
      {listening.map((text) => (
        <p key={text} className="text-xs text-gray-500">
          {text}
        </p>
      ))}
    </div>
  );
};

export default TranslationNotice;
