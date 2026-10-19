import { useEffect, useId, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Search, X } from "lucide-react";

// The storefront hero's search (KenlibsPage): a white pill on the green
// hero, filtering the loaded books by title or author (and bundles by
// title) on the client. Debounced independently of the parent's committed
// query: the input stays snappy on every keystroke, but onSearchChange
// (which drives the actual filtering) only fires once typing pauses.
const DEBOUNCE_MS = 200;

// Genre pills sit on the dark green hero: the active one is white with
// green text, the others translucent white (both well above 4.5:1).
const pillClass = (active) =>
  `min-h-[44px] px-4 rounded-full text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-forest-deep ${
    active ? "bg-white theme-keep-light text-forest" : "bg-white/10 text-white hover:bg-white/20"
  }`;

const KenlibsSearchBar = ({ onSearchChange, genres = [], selectedGenre, onSelectGenre }) => {
  const [input, setInput] = useState("");
  const debounceRef = useRef(null);
  const inputRef = useRef(null);
  const inputId = useId();
  // Arriving from the 404 page's "Search books" button: focus the field.
  const focusSearch = Boolean(useLocation().state?.focusSearch);
  useEffect(() => {
    if (focusSearch) inputRef.current?.focus();
  }, [focusSearch]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onSearchChange(input), DEBOUNCE_MS);
    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input]);

  return (
    <div>
      <form role="search" className="relative max-w-xl" onSubmit={(e) => e.preventDefault()}>
        <label htmlFor={inputId} className="sr-only">
          Search books by title or author
        </label>
        <Search
          className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500 pointer-events-none"
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          id={inputId}
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Search by title or author..."
          className="w-full h-[52px] pl-[52px] pr-14 rounded-full bg-white text-[15px] text-gray-900 placeholder:text-gray-500 shadow-lg shadow-black/25 focus:outline-none focus-visible:ring-4 focus-visible:ring-accent-on-dark/70 [&::-webkit-search-cancel-button]:appearance-none"
        />
        {input && (
          <button
            type="button"
            onClick={() => {
              setInput("");
              inputRef.current?.focus();
            }}
            aria-label="Clear search"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center rounded-full text-gray-500 hover:text-gray-800 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </form>

      {/* Only worth showing once the catalog actually has more than one
          genre in use — a single-value or all-empty set can't filter
          anything, so forcing the pill row on would just show noise. */}
      {genres.length >= 2 && (
        <div className="flex flex-wrap gap-2 mt-4" role="group" aria-label="Filter by genre">
          <button type="button" aria-pressed={selectedGenre === null} onClick={() => onSelectGenre(null)} className={pillClass(selectedGenre === null)}>
            All
          </button>
          {genres.map((genre) => (
            <button
              key={genre}
              type="button"
              aria-pressed={selectedGenre === genre}
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
