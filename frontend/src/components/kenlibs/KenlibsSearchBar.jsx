import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";

// Debounced independently of the parent's committed query — the input stays
// snappy on every keystroke, but onSearchChange (which drives the actual
// filtering) only fires once typing pauses.
const DEBOUNCE_MS = 200;

const pillClass = (active) =>
  `px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
    active
      ? "bg-accent text-white"
      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
  }`;

const KenlibsSearchBar = ({
  onSearchChange,
  genres,
  selectedGenre,
  onSelectGenre,
}) => {
  const [input, setInput] = useState("");
  const debounceRef = useRef(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onSearchChange(input), DEBOUNCE_MS);
    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input]);

  return (
    <div className="mb-10">
      <div className="relative max-w-md">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Search by title or author…"
          aria-label="Search books and bundles"
          className="w-full pl-11 pr-10 py-3 rounded-2xl border border-gray-200 bg-white text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-shadow"
        />
        {input && (
          <button
            type="button"
            onClick={() => setInput("")}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Only worth showing once the catalog actually has more than one
          genre in use — a single-value or all-empty set can't filter
          anything, so forcing the pill row on would just show noise. */}
      {genres.length >= 2 && (
        <div className="flex flex-wrap gap-2 mt-4">
          <button
            type="button"
            onClick={() => onSelectGenre(null)}
            className={pillClass(selectedGenre === null)}
          >
            All
          </button>
          {genres.map((genre) => (
            <button
              key={genre}
              type="button"
              onClick={() => onSelectGenre(genre)}
              className={pillClass(selectedGenre === genre)}
            >
              {genre}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default KenlibsSearchBar;
