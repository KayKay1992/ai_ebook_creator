import { useMemo, useState } from "react";
import { Sparkles, Type, Eye, Maximize2, Minimize2 } from "lucide-react";
import Button from "../ui/Button";
import InputField from "../ui/inputField";
import SimpleMDEditor from "./SimpleMDEditor";

const ChapterEditorTab = ({
  book,
  selectedChapterIndex = 0,
  onChapterChange = () => {},
  onGenerateChapterContent = () => {},
  isGenerating,
}) => {
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Simple markdown parser
  const formatMarkdown = (content) => {
    if (!content) return "<p class='text-gray-400 italic'>No content yet...</p>";

    return content
      .replace(/^### (.*$)/gim, "<h3 class='text-xl font-bold mb-3 mt-6 text-gray-900'>$1</h3>")
      .replace(/^## (.*$)/gim, "<h2 class='text-2xl font-bold mb-4 mt-8 text-gray-900'>$1</h2>")
      .replace(/^# (.*$)/gim, "<h1 class='text-3xl font-bold mb-5 mt-8 text-gray-900'>$1</h1>")
      .replace(/\*\*(.*?)\*\*/g, "<strong class='font-semibold text-gray-900'>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em class='italic'>$1</em>")
      .replace(/^> (.*$)/gim, "<blockquote class='border-l-4 border-violet-500 pl-5 py-1 my-4 italic text-gray-600 bg-violet-50/50 rounded-r-xl'>$1</blockquote>")
      .replace(/^\* (.*$)/gim, "<li class='ml-5 list-disc mb-1'>$1</li>")
      .replace(/^\d+\. (.*$)/gim, "<li class='ml-5 list-decimal mb-1'>$1</li>")
      .split("\n\n")
      .map((paragraph) => {
        if (!paragraph.trim()) return "";
        if (
          paragraph.startsWith("<h") ||
          paragraph.startsWith("<li") ||
          paragraph.startsWith("<blockquote")
        ) {
          return paragraph;
        }
        return `<p class='mb-5 leading-relaxed text-gray-700'>${paragraph}</p>`;
      })
      .join("");
  };

  const mdeOptions = useMemo(
    () => ({
      autoFocus: true,
      spellChecker: false,
      status: false,
      toolbar: [
        "bold",
        "italic",
        "heading",
        "|",
        "quote",
        "unordered-list",
        "ordered-list",
        "|",
        "link",
        "image",
        "|",
        "preview",
        "side-by-side",
        "fullscreen",
      ],
    }),
    []
  );

  if (selectedChapterIndex === null || !book?.chapters?.[selectedChapterIndex]) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-center">
        <div className="w-20 h-20 bg-violet-50 rounded-3xl flex items-center justify-center mb-6">
          <Type className="w-10 h-10 text-violet-400" />
        </div>
        <h3 className="text-xl font-semibold text-gray-900 mb-2">No chapter selected</h3>
        <p className="text-gray-500 max-w-sm">
          Select a chapter from the sidebar or create a new one to start writing.
        </p>
      </div>
    );
  }

  const currentChapter = book.chapters[selectedChapterIndex];
  const wordCount = currentChapter.content
    ? currentChapter.content.trim().split(/\s+/).filter(Boolean).length
    : 0;

  return (
    <div
      className={`${
        isFullscreen ? "fixed inset-0 z-50 bg-white" : "relative"
      } flex flex-col h-full animate-in fade-in duration-500`}
    >
      {/* ===== Header ===== */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
            Chapter Editor
          </h1>
          <p className="text-gray-500 mt-1">
            Editing:{" "}
            <span className="font-medium text-violet-700">
              {currentChapter.title || `Chapter ${selectedChapterIndex + 1}`}
            </span>
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Mode Toggle */}
          <div className="flex items-center bg-gray-100 p-1 rounded-2xl">
            <button
              onClick={() => setIsPreviewMode(false)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                !isPreviewMode
                  ? "bg-white text-violet-700 shadow-sm"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              <Type className="w-4 h-4" />
              Edit
            </button>
            <button
              onClick={() => setIsPreviewMode(true)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                isPreviewMode
                  ? "bg-white text-violet-700 shadow-sm"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              <Eye className="w-4 h-4" />
              Preview
            </button>
          </div>

          {/* Fullscreen */}
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="w-10 h-10 rounded-2xl flex items-center justify-center text-gray-500 hover:bg-gray-100 transition-colors"
            title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          >
            {isFullscreen ? (
              <Minimize2 className="w-4 h-4" />
            ) : (
              <Maximize2 className="w-4 h-4" />
            )}
          </button>

          {/* AI Generate */}
          <Button
            onClick={() => onGenerateChapterContent(selectedChapterIndex)}
            loading={isGenerating === selectedChapterIndex}
            className="flex items-center gap-2 shadow-lg shadow-violet-500/20"
          >
            <Sparkles className="w-4 h-4" />
            Generate with AI
          </Button>
        </div>
      </div>

      {/* ===== Chapter Title ===== */}
      <div className="mb-6">
        <InputField
          label="Chapter Title"
          name="title"
          value={currentChapter.title || ""}
          onChange={onChapterChange}
          placeholder="Enter a compelling chapter title..."
        />
      </div>

      {/* ===== Editor / Preview ===== */}
      <div className="flex-1 min-h-[500px] bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
        {isPreviewMode ? (
          <div className="h-full overflow-y-auto p-8 lg:p-12">
            <div className="max-w-3xl mx-auto">
              <div className="flex items-center gap-2 text-violet-600 mb-8">
                <Eye className="w-5 h-5" />
                <span className="text-sm font-medium tracking-wide">PREVIEW MODE</span>
              </div>

              <h1 className="text-4xl font-bold text-gray-900 mb-10 leading-tight">
                {currentChapter.title || "Untitled Chapter"}
              </h1>

              <div
                className="prose prose-lg max-w-none text-gray-700"
                style={{
                  fontFamily: 'Charter, Georgia, "Times New Roman", serif',
                  lineHeight: "1.8",
                }}
                dangerouslySetInnerHTML={{
                  __html: formatMarkdown(currentChapter.content),
                }}
              />
            </div>
          </div>
        ) : (
          <div className="h-full">
            <SimpleMDEditor
              value={currentChapter.content || ""}
              onChange={(value) =>
                onChapterChange({ target: { name: "content", value } })
              }
              options={mdeOptions}
            />
          </div>
        )}
      </div>

      {/* ===== Status Bar ===== */}
      <div className="flex items-center justify-between mt-5 text-sm text-gray-500">
        <div className="flex items-center gap-6">
          <span>
            <span className="font-medium text-gray-700">{wordCount}</span> words
          </span>
          <span>
            <span className="font-medium text-gray-700">
              {currentChapter.content?.length || 0}
            </span>{" "}
            characters
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
          <span>Ready</span>
        </div>
      </div>
    </div>
  );
};

export default ChapterEditorTab;