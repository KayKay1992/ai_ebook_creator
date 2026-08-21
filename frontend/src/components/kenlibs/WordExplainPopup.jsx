import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { BookOpenText, Loader2, Sparkles, X } from "lucide-react";
import toast from "react-hot-toast";
import axiosInstance from "../../utils/axiosInstance";
import { API_PATHS } from "../../utils/apiPaths";
import getErrorMessage from "../../utils/getErrorMessage";

// Strips leading/trailing punctuation the browser's default word-selection
// or a drag that catches a comma/period can pick up (e.g. "context," or
// "(invented"), without touching internal characters like an apostrophe in
// "reader's". Unicode-aware so it doesn't mangle non-English words.
const cleanWordForLookup = (raw) =>
  raw.trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

const MAX_MEANINGS = 3;
const MAX_DEFINITIONS_PER_MEANING = 2;

// Small, self-contained lookup card: free-dictionary lookup on mount, with
// an opt-in "Explain in context" fallback for misses/phrases (Step 36). One
// instance = one selection — the parent remounts this (via a fresh `key`)
// whenever a new word/phrase is selected, so all state below is naturally
// scoped to that single lookup.
// Dictionary lookups only make sense for single words — a multi-word phrase
// goes straight to the "Explain in context" offer rather than firing a
// lookup that's essentially guaranteed to 404. Computed once per instance
// (word is fixed for this component's lifetime — see the note below) so the
// effect never needs to setState synchronously for this branch.
const isLookupPhrase = (word) => {
  const cleaned = cleanWordForLookup(word);
  return !cleaned || /\s/.test(cleaned);
};

const WordExplainPopup = ({ word, sentence, bookId, position, onClose }) => {
  // 'dictionary' | 'miss' | 'ai-loading' | 'ai-result'
  const [phase, setPhase] = useState(() => (isLookupPhrase(word) ? "miss" : "dictionary"));
  const [entry, setEntry] = useState(null);
  const [aiExplanation, setAiExplanation] = useState("");
  const popupRef = useRef(null);

  useEffect(() => {
    if (isLookupPhrase(word)) return undefined; // already initialized to "miss" above

    let cancelled = false;
    const cleaned = cleanWordForLookup(word);

    fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(cleaned.toLowerCase())}`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setPhase("miss");
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        if (!Array.isArray(data) || data.length === 0) {
          setPhase("miss");
          return;
        }
        setEntry(data[0]);
        setPhase("hit");
      })
      .catch(() => {
        if (!cancelled) setPhase("miss");
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // word is fixed for the lifetime of this instance — see the note above

  // Dismiss on click-away or Escape — kept lightweight (two listeners, torn
  // down on unmount) rather than a portal/focus-trap library, matching the
  // "natural reading aid, not an interruption" bar from Step 31.
  useEffect(() => {
    const handlePointerDown = (e) => {
      if (popupRef.current && !popupRef.current.contains(e.target)) {
        onClose();
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const handleExplainInContext = async () => {
    setPhase("ai-loading");
    try {
      const response = await axiosInstance.post(API_PATHS.KENLIBS.EXPLAIN(bookId), {
        word,
        sentence,
      });
      setAiExplanation(response.data.explanation);
      setPhase("ai-result");
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to explain this"));
      setPhase("miss");
    }
  };

  const phonetic = entry?.phonetic || entry?.phonetics?.find((p) => p.text)?.text;
  const meanings = (entry?.meanings || []).slice(0, MAX_MEANINGS);

  return (
    <motion.div
      ref={popupRef}
      initial={{ opacity: 0, scale: 0.96, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.14, ease: "easeOut" }}
      className="fixed z-50 w-80 max-w-[calc(100vw-24px)] max-h-[70vh] overflow-y-auto rounded-2xl border border-gray-100 bg-white shadow-xl"
      style={position}
    >
      <div className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-2">
        <div className="min-w-0">
          <p className="font-serif text-base font-semibold text-gray-900 truncate">{word}</p>
          {phonetic && <p className="text-xs text-gray-400 mt-0.5">{phonetic}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex-shrink-0 w-6 h-6 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="px-4 pb-4">
        {phase === "dictionary" && (
          <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
            Looking it up…
          </div>
        )}

        {phase === "hit" && (
          <div className="space-y-3">
            {meanings.map((meaning, i) => (
              <div key={i}>
                <p className="text-xs font-semibold text-accent uppercase tracking-wide">
                  {meaning.partOfSpeech}
                </p>
                <ol className="mt-1 space-y-1 list-decimal list-inside">
                  {meaning.definitions.slice(0, MAX_DEFINITIONS_PER_MEANING).map((d, j) => (
                    <li key={j} className="text-sm text-gray-700 leading-snug">
                      {d.definition}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        )}

        {phase === "miss" && (
          <div className="py-1">
            <p className="text-sm text-gray-500">
              No dictionary definition found for "{word}".
            </p>
            <p className="text-xs text-gray-400 mt-1 mb-3">
              Could be a name, invented term, or concept specific to this book.
            </p>
            <button
              type="button"
              onClick={handleExplainInContext}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-accent to-accent-secondary hover:from-accent-hover hover:to-accent-secondary-hover transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Explain in context
            </button>
          </div>
        )}

        {phase === "ai-loading" && (
          <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
            Asking AI…
          </div>
        )}

        {phase === "ai-result" && (
          <div className="flex items-start gap-2">
            <BookOpenText className="w-4 h-4 text-accent flex-shrink-0 mt-0.5" />
            <p className="text-sm text-gray-700 leading-snug">{aiExplanation}</p>
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default WordExplainPopup;
