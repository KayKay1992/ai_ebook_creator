import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Menu } from "lucide-react";
import ViewChapterSidebar from "./ViewChapterSidebar";
import MarkdownContent from "../shared/MarkdownContent";

// Duration of each half of the chapter crossfade (fade-out, then fade-in),
// in ms — kept in sync with the CSS transition-duration class below.
const CHAPTER_FADE_MS = 150;

// `animated` defaults to false and is only ever passed `true` from the
// reader-facing callers (KenlibsReadPage, ReadBookPage) — the admin's own
// /view-book/:bookId preview (ViewBookPage) never passes it, so it renders
// exactly as before: same DOM, same behavior, zero visual change. When
// true, chapter switches cross-fade instead of jumping, and the nav/font
// controls get a touch of press feedback — kept deliberately understated so
// it doesn't compete with someone actually reading.
//
// The crossfade itself is a plain CSS opacity transition driven by a
// boolean + setTimeout, deliberately NOT Framer Motion's AnimatePresence,
// whileInView, or useAnimation().start() — testing turned up all three
// getting stuck mid-transition in this environment (a chapter change could
// leave the page permanently blank), which is unacceptable for a page whose
// whole job is showing the reader their content. Plain CSS has no
// completion-promise/observer machinery to get stuck on.
//
// `initialChapterIndex`/`onChapterChange` are likewise opt-in (Step 32,
// resume-where-you-left-off): only KenlibsReadPage passes them, to seed the
// starting chapter from ReaderProgress and report changes back so they can
// be persisted. Neither admin caller touches these, so their behavior is
// unaffected.
const ViewBook = ({
  book,
  backTo = "/dashboard",
  backLabel = "Back to Dashboard",
  animated = false,
  initialChapterIndex = 0,
  onChapterChange,
}) => {
  const chapters = book?.chapters || [];
  // Guards against a stored index that's no longer valid — e.g. the book
  // was edited and now has fewer chapters than when progress was last
  // saved — falling back to the start rather than rendering nothing.
  const clampedInitialIndex =
    Number.isInteger(initialChapterIndex) &&
    initialChapterIndex >= 0 &&
    initialChapterIndex < chapters.length
      ? initialChapterIndex
      : 0;

  const [selectedChapterIndex, setSelectedChapterIndex] = useState(clampedInitialIndex);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [fontSize, setFontSize] = useState(18);
  const [isChapterFading, setIsChapterFading] = useState(false);
  // Plain ref guard so a rapid second click can't overlap the fade
  // sequence's two setTimeouts and land the index change out of order.
  const isTransitioningRef = useRef(false);

  const selectedChapter = chapters[selectedChapterIndex];

  const changeChapter = (updater) => {
    const next = typeof updater === "function" ? updater(selectedChapterIndex) : updater;
    if (next === selectedChapterIndex) return;

    if (!animated) {
      onChapterChange?.(next);
      setSelectedChapterIndex(next);
      return;
    }

    if (isTransitioningRef.current) return;
    isTransitioningRef.current = true;
    onChapterChange?.(next);

    setIsChapterFading(true);
    setTimeout(() => {
      setSelectedChapterIndex(next);
      setIsChapterFading(false);
      setTimeout(() => {
        isTransitioningRef.current = false;
      }, CHAPTER_FADE_MS);
    }, CHAPTER_FADE_MS);
  };

  if (!book) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">Book not found.</p>
      </div>
    );
  }

  const NavButton = animated ? motion.button : "button";
  const navButtonMotionProps = animated ? { whileTap: { scale: 0.94 } } : {};

  const chapterContent = selectedChapter ? (
    <>
      <h1 className="font-serif text-3xl sm:text-4xl font-bold text-gray-900 tracking-tight mb-10 leading-tight">
        {selectedChapter.title || `Chapter ${selectedChapterIndex + 1}`}
      </h1>

      <MarkdownContent
        content={selectedChapter.content}
        emptyMessage="No content available for this chapter."
        className="font-serif leading-loose text-gray-700"
        style={{
          fontSize: `${fontSize}px`,
        }}
      />
    </>
  ) : (
    <div className="text-center py-24 text-gray-400">
      <p>No chapter selected.</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-surface-warm flex">
      {/* Sidebar */}
      <ViewChapterSidebar
        book={book}
        selectedChapterIndex={selectedChapterIndex}
        onSelectChapter={changeChapter}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        backTo={backTo}
        backLabel={backLabel}
      />

      {/* Main Reading Area */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-xl border-b border-gray-200">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
            <div className="flex items-center gap-4 min-w-0">
              <button
                onClick={() => setIsSidebarOpen(true)}
                className="lg:hidden w-10 h-10 rounded-xl flex items-center justify-center text-gray-600 hover:bg-gray-100 transition-colors"
              >
                <Menu className="w-5 h-5" />
              </button>

              <div className="min-w-0">
                <h1 className="text-base font-semibold text-gray-900 truncate">
                  {book.title || "Untitled Book"}
                </h1>
                <p className="text-xs text-gray-500 truncate">
                  {book.author || "Unknown Author"}
                </p>
              </div>
            </div>

            {/* Font Size Controls */}
            <div className="flex items-center gap-2 bg-gray-100 rounded-2xl p-1">
              <NavButton
                {...navButtonMotionProps}
                onClick={() => setFontSize((s) => Math.max(14, s - 2))}
                className="w-9 h-9 rounded-xl text-sm font-medium text-gray-600 hover:bg-white hover:shadow-sm transition-all"
              >
                A-
              </NavButton>
              <span className="text-xs text-gray-500 w-10 text-center">{fontSize}px</span>
              <NavButton
                {...navButtonMotionProps}
                onClick={() => setFontSize((s) => Math.min(26, s + 2))}
                className="w-9 h-9 rounded-xl text-sm font-medium text-gray-600 hover:bg-white hover:shadow-sm transition-all"
              >
                A+
              </NavButton>
            </div>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-[70ch] mx-auto px-5 sm:px-8 py-12 sm:py-16">
            {animated ? (
              <div
                className={`transition-opacity duration-150 ease-out ${
                  isChapterFading ? "opacity-0" : "opacity-100"
                }`}
              >
                {chapterContent}
              </div>
            ) : (
              chapterContent
            )}

            {/* Navigation */}
            <div className="mt-16 pt-8 border-t border-gray-200 flex items-center justify-between gap-4">
              <NavButton
                {...navButtonMotionProps}
                onClick={() => changeChapter((i) => Math.max(0, i - 1))}
                disabled={selectedChapterIndex === 0}
                className="flex items-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-medium text-gray-600 hover:bg-white hover:shadow-sm disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                <ChevronLeft className="w-4 h-4" />
                Previous
              </NavButton>

              <span className="text-sm text-gray-500">
                {selectedChapterIndex + 1} / {chapters.length}
              </span>

              <NavButton
                {...navButtonMotionProps}
                onClick={() =>
                  changeChapter((i) => Math.min(chapters.length - 1, i + 1))
                }
                disabled={selectedChapterIndex === chapters.length - 1}
                className="flex items-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-medium text-gray-600 hover:bg-white hover:shadow-sm disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                Next
                <ChevronRight className="w-4 h-4" />
              </NavButton>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default ViewBook;
