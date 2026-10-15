import { useState } from "react";
import { BookOpenText, ChevronDown } from "lucide-react";

// Collapsible "Chapter recap" at the top of a chapter in the gated reader
// (KenlibsReadPage only: the summary never comes from the public share-link
// endpoint). Open/closed is remembered per device for all books.
const STORAGE_KEY = "kenlibs_recap_open";

const readOpen = () => {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
};

const ChapterRecap = ({ summary }) => {
  const [isOpen, setIsOpen] = useState(readOpen);
  const text = String(summary || "").trim();
  if (!text) return null;

  const toggle = () => {
    setIsOpen((open) => {
      try {
        localStorage.setItem(STORAGE_KEY, open ? "0" : "1");
      } catch {
        /* storage unavailable: the choice just isn't remembered */
      }
      return !open;
    });
  };

  return (
    <div className="mb-8 rounded-2xl border border-accent-100 bg-accent-50/60">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={isOpen}
        className="w-full flex items-center justify-between gap-3 px-5 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-gray-800">
          <BookOpenText className="w-4 h-4 text-accent" />
          Chapter recap
        </span>
        <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>
      {isOpen && <p className="px-5 pb-4 text-sm leading-relaxed text-gray-700">{text}</p>}
    </div>
  );
};

export default ChapterRecap;
