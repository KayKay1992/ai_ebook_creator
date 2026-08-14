import { BookOpen, X } from "lucide-react";

const ViewChapterSidebar = ({
  book,
  selectedChapterIndex = 0,
  onSelectChapter,
  isOpen,
  onClose,
}) => {
  const chapters = book?.chapters || [];

  return (
    <>
      {/* Mobile Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:sticky top-0 left-0 h-screen w-80 bg-white border-r border-gray-200 z-50
        transform transition-transform duration-300 ease-in-out
        ${isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-5 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-accent-500 to-accent-secondary flex items-center justify-center shadow-lg shadow-accent-500/20">
                <BookOpen className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="font-semibold text-gray-900">Chapters</h2>
                <p className="text-xs text-gray-500">
                  {chapters.length} chapter{chapters.length !== 1 ? "s" : ""}
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="lg:hidden w-9 h-9 rounded-xl flex items-center justify-center text-gray-500 hover:bg-gray-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Book Title */}
          <div className="px-5 py-4 border-b border-gray-50">
            <p className="text-sm font-medium text-gray-900 line-clamp-2">
              {book?.title || "Untitled Book"}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {book?.author || "Unknown Author"}
            </p>
          </div>

          {/* Chapter List */}
          <div className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
            {chapters.map((chapter, index) => {
              const isActive = selectedChapterIndex === index;

              return (
                <button
                  key={chapter._id || index}
                  onClick={() => {
                    onSelectChapter(index);
                    onClose?.();
                  }}
                  className={`w-full text-left px-4 py-3 rounded-2xl transition-all duration-200 group
                    ${
                      isActive
                        ? "bg-accent-muted ring-1 ring-accent-200"
                        : "hover:bg-gray-50"
                    }`}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={`flex-shrink-0 w-7 h-7 rounded-xl flex items-center justify-center text-xs font-semibold
                      ${
                        isActive
                          ? "bg-accent text-white"
                          : "bg-gray-100 text-gray-600 group-hover:bg-gray-200"
                      }`}
                    >
                      {index + 1}
                    </span>

                    <div className="min-w-0">
                      <p
                        className={`text-sm font-medium truncate leading-snug
                        ${isActive ? "text-accent-900" : "text-gray-800"}`}
                      >
                        {chapter.title || `Chapter ${index + 1}`}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Chapter {index + 1}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </aside>
    </>
  );
};

export default ViewChapterSidebar;