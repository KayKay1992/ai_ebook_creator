import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import axiosInstance from "../utils/axiosInstance";
import { API_PATHS } from "../utils/apiPaths";
import toast from "react-hot-toast";
import {
  FileDown,
  Save,
  Menu,
  X,
  NotebookText,
  ChevronDown,
  FileText,
  Edit3,
} from "lucide-react";
import { arrayMove } from "@dnd-kit/sortable";

import Dropdown, { DropdownItem } from "../components/ui/Dropdown";
import Button from "../components/ui/Button";
import ChapterSidebar from "../components/editor/ChapterSidebar";
import ChapterEditorTab from "../components/editor/ChapterEditorTab";
import BookDetailsTab from "../components/editor/BookDetailsTab";

const EditorPage = () => {
  const { bookId } = useParams();
  const navigate = useNavigate();

  const [book, setBook] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedChapterIndex, setSelectedChapterIndex] = useState(0);
  const [activeTab, setActiveTab] = useState("editor");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(null); // null | number

  const fileInputRef = useRef(null);

  useEffect(() => {
    const fetchBook = async () => {
      try {
        const response = await axiosInstance.get(
          `${API_PATHS.BOOKS.GET_BOOK_BY_ID}/${bookId}`
        );
        setBook(response.data);
      } catch (error) {
        toast.error("Failed to load book");
        navigate("/dashboard");
      } finally {
        setIsLoading(false);
      }
    };
    fetchBook();
  }, [bookId, navigate]);

  const handleBookChange = (e) => {
    const { name, value } = e.target;
    setBook((prev) => ({ ...prev, [name]: value }));
  };

  const handleChapterChange = (e) => {
    const { name, value } = e.target;
    const updatedChapters = [...book.chapters];
    updatedChapters[selectedChapterIndex][name] = value;
    setBook((prev) => ({ ...prev, chapters: updatedChapters }));
  };

  const handleAddChapter = () => {
    const newChapter = {
      title: `Chapter ${book.chapters.length + 1}`,
      content: "",
      description: "",
    };
    const updated = [...book.chapters, newChapter];
    setBook((prev) => ({ ...prev, chapters: updated }));
    setSelectedChapterIndex(updated.length - 1);
  };

  const handleDeleteChapter = (index) => {
    if (book.chapters.length <= 1) {
      toast.error("You must have at least one chapter.");
      return;
    }
    const updated = book.chapters.filter((_, i) => i !== index);
    setBook((prev) => ({ ...prev, chapters: updated }));
    setSelectedChapterIndex((prev) =>
      prev >= index ? Math.max(0, prev - 1) : prev
    );
  };

  const handleReorderChapters = (oldIndex, newIndex) => {
    setBook((prev) => ({
      ...prev,
      chapters: arrayMove(prev.chapters, oldIndex, newIndex),
    }));
    setSelectedChapterIndex(newIndex);
  };

  const handleSaveChanges = async (bookToSave = book, showToast = true) => {
    setIsSaving(true);
    try {
      await axiosInstance.put(
        `${API_PATHS.BOOKS.UPDATE_BOOK}/${bookId}`,
        bookToSave
      );
      if (showToast) toast.success("Changes saved successfully!");
    } catch (error) {
      toast.error("Failed to save changes");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCoverImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("coverImage", file);

    setIsUploading(true);
    try {
      const response = await axiosInstance.put(
        `${API_PATHS.BOOKS.UPDATE_COVER}/${bookId}`,
        formData,
        { headers: { "Content-Type": "multipart/form-data" } }
      );
      setBook(response.data);
      toast.success("Cover image updated!");
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to upload cover");
    } finally {
      setIsUploading(false);
    }
  };

  const handleGenerateChapterContent = async (index) => {
    const chapter = book.chapters[index];
    if (!chapter?.title) {
      toast.error("Chapter title is required");
      return;
    }

    setIsGenerating(index);
    try {
      const response = await axiosInstance.post(
        API_PATHS.AI.GENERATE_CHAPTER_CONTENT,
        {
          chapterTitle: chapter.title,
          chapterDescription: chapter.description || "",
          style: "Informative",
        }
      );

      const updatedChapters = [...book.chapters];
      updatedChapters[index].content = response.data.content;

      const updatedBook = { ...book, chapters: updatedChapters };
      setBook(updatedBook);
      toast.success(`Content generated for "${chapter.title}"`);

      await handleSaveChanges(updatedBook, false);
    } catch (error) {
      toast.error("Failed to generate content");
    } finally {
      setIsGenerating(null);
    }
  };

  const handleExportPDF = async () => {
    const toastId = toast.loading("Generating PDF...");
    try {
      const response = await axiosInstance.get(
        `${API_PATHS.EXPORT.PDF}/${bookId}/pdf`,
        { responseType: "blob" }
      );

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `${book.title || "book"}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success("PDF exported!", { id: toastId });
    } catch (error) {
      toast.error("Failed to export PDF", { id: toastId });
    }
  };

  const handleExportDOC = async () => {
    const toastId = toast.loading("Generating DOCX...");
    try {
      const response = await axiosInstance.get(
        `${API_PATHS.EXPORT.DOC}/${bookId}/doc`,
        { responseType: "blob" }
      );
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `${book.title || "book"}.docx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success("DOCX exported!", { id: toastId });
    } catch (error) {
      toast.error("Failed to export DOCX", { id: toastId });
    }
  };

  if (isLoading || !book) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin mx-auto mb-6"></div>
          <p className="text-gray-500 font-medium">Loading your book...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Mobile Sidebar */}
      {isSidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setIsSidebarOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-80 bg-white shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <span className="font-semibold text-gray-900">Chapters</span>
              <button
                onClick={() => setIsSidebarOpen(false)}
                className="w-9 h-9 rounded-xl flex items-center justify-center text-gray-500 hover:bg-gray-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <ChapterSidebar
              book={book}
              selectedChapterIndex={selectedChapterIndex}
              onSelectChapter={(index) => {
                setSelectedChapterIndex(index);
                setIsSidebarOpen(false);
              }}
              onAddChapter={handleAddChapter}
              onDeleteChapter={handleDeleteChapter}
              onReorderChapters={handleReorderChapters}
              onGenerateChapterContent={handleGenerateChapterContent}
              isGenerating={isGenerating}
            />
          </div>
        </div>
      )}

      {/* Desktop Sidebar */}
      <div className="hidden md:flex md:w-80 lg:w-96 flex-shrink-0 border-r border-gray-200 bg-white">
        <ChapterSidebar
          book={book}
          selectedChapterIndex={selectedChapterIndex}
          onSelectChapter={setSelectedChapterIndex}
          onAddChapter={handleAddChapter}
          onDeleteChapter={handleDeleteChapter}
          onReorderChapters={handleReorderChapters}
          onGenerateChapterContent={handleGenerateChapterContent}
          isGenerating={isGenerating}
        />
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-xl border-b border-gray-200">
          <div className="flex items-center justify-between px-4 lg:px-8 h-16">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setIsSidebarOpen(true)}
                className="md:hidden w-10 h-10 rounded-xl flex items-center justify-center text-gray-600 hover:bg-gray-100"
              >
                <Menu className="w-5 h-5" />
              </button>
              <h1 className="text-lg font-semibold text-gray-900 truncate max-w-xs hidden sm:block">
                {book.title || "Untitled Book"}
              </h1>
            </div>

            {/* Tabs */}
            <div className="flex items-center bg-gray-100 p-1 rounded-2xl">
              <button
                onClick={() => setActiveTab("editor")}
                className={`flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-medium transition-all ${
                  activeTab === "editor"
                    ? "bg-white text-violet-700 shadow-sm"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                <Edit3 className="w-4 h-4" />
                Editor
              </button>
              <button
                onClick={() => setActiveTab("details")}
                className={`flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-medium transition-all ${
                  activeTab === "details"
                    ? "bg-white text-violet-700 shadow-sm"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                <NotebookText className="w-4 h-4" />
                Details
              </button>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3">
              <Dropdown
                trigger={
                  <Button variant="secondary" className="flex items-center gap-2">
                    <FileDown className="w-4 h-4" />
                    <span className="hidden sm:inline">Export</span>
                    <ChevronDown className="w-4 h-4" />
                  </Button>
                }
              >
                <DropdownItem onClick={handleExportPDF}>
                  <FileText className="w-4 h-4" />
                  Export as PDF
                </DropdownItem>
                <DropdownItem onClick={handleExportDOC}>
                  <FileText className="w-4 h-4" />
                  Export as DOCX
                </DropdownItem>
              </Dropdown>

              <Button
                onClick={() => handleSaveChanges()}
                loading={isSaving}
                className="flex items-center gap-2 shadow-lg shadow-violet-500/20"
              >
                <Save className="w-4 h-4" />
                <span className="hidden sm:inline">Save</span>
              </Button>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="max-w-5xl mx-auto px-4 lg:px-8 py-8">
            {activeTab === "editor" ? (
              <ChapterEditorTab
                book={book}
                selectedChapterIndex={selectedChapterIndex}
                onChapterChange={handleChapterChange}
                onGenerateChapterContent={handleGenerateChapterContent}
                isGenerating={isGenerating}
              />
            ) : (
              <BookDetailsTab
                book={book}
                onCoverUpload={handleCoverImageUpload}
                onBookChange={handleBookChange}
                isUploading={isUploading}
                fileInputRef={fileInputRef}
              />
            )}
          </div>
        </main>
      </div>
    </div>
  );
};

export default EditorPage;