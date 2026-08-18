import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, X, ChevronDown } from "lucide-react";
import CoverPreview from "../cards/CoverPreview";

const ViewChapterSidebar = ({
  book,
  selectedChapterIndex = 0,
  onSelectChapter,
  isOpen,
  onClose,
  backTo = "/dashboard",
  backLabel = "Back to Dashboard",
}) => {
  const navigate = useNavigate();
  const chapters = book?.chapters || [];
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const blurb = book?.coverDesign?.back?.blurb?.trim();
  const authorBio = book?.coverDesign?.back?.authorBio?.trim();
  const hasAboutContent = Boolean(blurb || authorBio);

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
          <div className="px-5 py-5 border-b border-gray-100">
            <div className="flex items-center justify-between mb-4">
              <button
                onClick={() => navigate(backTo)}
                className="flex items-center gap-2 text-sm text-gray-500 hover:text-accent transition-colors group"
              >
                <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
                {backLabel}
              </button>

              <button
                onClick={onClose}
                className="lg:hidden w-9 h-9 rounded-xl flex items-center justify-center text-gray-500 hover:bg-gray-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-11 flex-shrink-0">
                <CoverPreview
                  title={book?.title}
                  author={book?.author}
                  coverImage={book?.coverImage}
                  coverDesign={book?.coverDesign}
                  size="sm"
                  rounded="rounded-lg"
                />
              </div>
              <div className="min-w-0">
                <h2 className="font-semibold text-gray-900">Chapters</h2>
                <p className="text-xs text-gray-500">
                  {chapters.length} chapter{chapters.length !== 1 ? "s" : ""}
                </p>
              </div>
            </div>
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

          {/* About this book — collapsed by default so it never gets in
              the way of a reader who just wants to start reading. */}
          {hasAboutContent && (
            <div className="border-b border-gray-50">
              <button
                onClick={() => setIsAboutOpen((open) => !open)}
                className="w-full flex items-center justify-between px-5 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                About this book
                <ChevronDown
                  className={`w-4 h-4 text-gray-400 transition-transform ${
                    isAboutOpen ? "rotate-180" : ""
                  }`}
                />
              </button>
              {isAboutOpen && (
                <div className="px-5 pb-4 space-y-3">
                  {blurb && (
                    <p className="text-sm text-gray-600 leading-relaxed font-serif italic">
                      {blurb}
                    </p>
                  )}
                  {authorBio && (
                    <div className="flex items-start gap-2 pt-2 border-t border-gray-50">
                      {book?.coverDesign?.back?.authorPhoto && (
                        <img
                          src={book.coverDesign.back.authorPhoto}
                          alt=""
                          className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                        />
                      )}
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-gray-700">
                          {book?.author || "Unknown Author"}
                        </p>
                        <p className="text-xs text-gray-500 leading-relaxed">
                          {authorBio}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

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
                        className={`text-sm font-serif font-medium truncate leading-snug
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