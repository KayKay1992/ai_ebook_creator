import { useState } from "react";
import { ChevronLeft, ChevronRight, Menu } from "lucide-react";
import ViewChapterSidebar from "./ViewChapterSidebar";

const ViewBook = ({ book }) => {
  const [selectedChapterIndex, setSelectedChapterIndex] = useState(0);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [fontSize, setFontSize] = useState(18);

  const chapters = book?.chapters || [];
  const selectedChapter = chapters[selectedChapterIndex];

  const formatContent = (content = "") => {
    if (!content.trim()) {
      return `<p class="text-gray-400 italic">No content available for this chapter.</p>`;
    }

    return content
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        // Headings
        if (line.startsWith("### ")) {
          return `<h3 class="text-xl font-bold text-gray-900 mt-8 mb-3">${line.slice(4)}</h3>`;
        }
        if (line.startsWith("## ")) {
          return `<h2 class="text-2xl font-bold text-gray-900 mt-10 mb-4">${line.slice(3)}</h2>`;
        }
        if (line.startsWith("# ")) {
          return `<h1 class="text-3xl font-bold text-gray-900 mt-10 mb-4">${line.slice(2)}</h1>`;
        }

        // Bold + Italic
        let formatted = line
          .replace(/\*\*(.*?)\*\*/g, "<strong class='font-semibold text-gray-900'>$1</strong>")
          .replace(/\*(.*?)\*/g, "<em class='italic text-gray-800'>$1</em>");

        return `<p class="mb-5 leading-relaxed text-gray-700">${formatted}</p>`;
      })
      .join("");
  };

  if (!book) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">Book not found.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#faf9f7] flex">
      {/* Sidebar */}
      <ViewChapterSidebar
        book={book}
        selectedChapterIndex={selectedChapterIndex}
        onSelectChapter={setSelectedChapterIndex}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
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
              <button
                onClick={() => setFontSize((s) => Math.max(14, s - 2))}
                className="w-9 h-9 rounded-xl text-sm font-medium text-gray-600 hover:bg-white hover:shadow-sm transition-all"
              >
                A-
              </button>
              <span className="text-xs text-gray-500 w-10 text-center">{fontSize}px</span>
              <button
                onClick={() => setFontSize((s) => Math.min(26, s + 2))}
                className="w-9 h-9 rounded-xl text-sm font-medium text-gray-600 hover:bg-white hover:shadow-sm transition-all"
              >
                A+
              </button>
            </div>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-5 sm:px-8 py-12 sm:py-16">
            {selectedChapter ? (
              <>
                <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 tracking-tight mb-10 leading-tight">
                  {selectedChapter.title || `Chapter ${selectedChapterIndex + 1}`}
                </h1>

                <div
                  className="prose-content"
                  style={{
                    fontSize: `${fontSize}px`,
                    lineHeight: 1.8,
                    fontFamily: 'Charter, Georgia, "Times New Roman", serif',
                  }}
                  dangerouslySetInnerHTML={{
                    __html: formatContent(selectedChapter.content),
                  }}
                />
              </>
            ) : (
              <div className="text-center py-24 text-gray-400">
                <p>No chapter selected.</p>
              </div>
            )}

            {/* Navigation */}
            <div className="mt-16 pt-8 border-t border-gray-200 flex items-center justify-between gap-4">
              <button
                onClick={() =>
                  setSelectedChapterIndex((i) => Math.max(0, i - 1))
                }
                disabled={selectedChapterIndex === 0}
                className="flex items-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-medium text-gray-600 hover:bg-white hover:shadow-sm disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                <ChevronLeft className="w-4 h-4" />
                Previous
              </button>

              <span className="text-sm text-gray-500">
                {selectedChapterIndex + 1} / {chapters.length}
              </span>

              <button
                onClick={() =>
                  setSelectedChapterIndex((i) =>
                    Math.min(chapters.length - 1, i + 1)
                  )
                }
                disabled={selectedChapterIndex === chapters.length - 1}
                className="flex items-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-medium text-gray-600 hover:bg-white hover:shadow-sm disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                Next
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default ViewBook;