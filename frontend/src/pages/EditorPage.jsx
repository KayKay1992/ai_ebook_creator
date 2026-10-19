import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import axiosInstance from "../utils/axiosInstance";
import { API_PATHS, BASE_URL } from "../utils/apiPaths";
import getErrorMessage from "../utils/getErrorMessage";
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
  Check,
  Loader2,
  AlertCircle,
  Activity,
  Headphones,
  Languages,
} from "lucide-react";
import { arrayMove } from "@dnd-kit/sortable";

import Dropdown, { DropdownItem } from "../components/ui/Dropdown";
import Button from "../components/ui/Button";
import Modal from "../components/ui/Modal";
import ChapterSidebar from "../components/editor/ChapterSidebar";
import ChapterEditorTab from "../components/editor/ChapterEditorTab";
import BookDetailsTab from "../components/editor/BookDetailsTab";
import VitalsTab from "../components/editor/VitalsTab";

// Lazy: only admins who open the Audiobook tab download it.
const AudiobookTab = lazy(() => import("../components/editor/AudiobookTab"));
const TranslationsTab = lazy(() => import("../components/editor/TranslationsTab"));
import EditorSkeleton from "../components/skeletons/EditorSkeleton";

// Same word-in-title detection used server-side (aiController.js's
// isConclusionChapter) — kept in sync by hand, same pattern as
// TonePicker.jsx mirroring backend/utils/voiceProfile.js. Used here purely
// to decide whether the retrofit confirmation modal is even necessary, not
// as a security boundary, so client-side duplication is fine.
const looksLikeIntroduction = (chapter) => /introduction/i.test(chapter?.title || "");
const looksLikeConclusion = (chapter) => /conclusion/i.test(chapter?.title || "");

const EditorPage = () => {
  const { bookId } = useParams();
  const navigate = useNavigate();

  const [book, setBook] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isTogglingPublish, setIsTogglingPublish] = useState(false);
  const [selectedChapterIndex, setSelectedChapterIndex] = useState(0);
  const [activeTab, setActiveTab] = useState("editor");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(null); // null | number
  const [isGeneratingMoreChapters, setIsGeneratingMoreChapters] = useState(false);
  const [isIntroConclusionConfirmOpen, setIsIntroConclusionConfirmOpen] = useState(false);
  const [isGeneratingIntroConclusion, setIsGeneratingIntroConclusion] = useState(false);
  const [saveStatus, setSaveStatus] = useState("saved"); // 'saved' | 'saving' | 'unsaved' | 'error'

  // AI-drafted text the admin hasn't reviewed yet (the storefront teaser,
  // chapter summaries; BookDetailsTab.jsx) must never reach readers by
  // itself: on a published book, any save would make it live. While a draft
  // is pending, every automatic save of the book (debounced field autosave
  // and the save after AI chapter generation) is paused, for the whole book,
  // since any PUT sends the whole book. Only the manual Save button clears
  // it. Mirrored in a ref because the autosave timer and async handlers read
  // it from older closures. isTeaserDraftPending / pendingSummaryIds say
  // which drafts, for the per-field "review" hints.
  const [isDraftPending, setIsDraftPending] = useState(false);
  const draftPendingRef = useRef(false);
  const [isTeaserDraftPending, setIsTeaserDraftPending] = useState(false);
  const [pendingSummaryIds, setPendingSummaryIds] = useState([]);

  const fileInputRef = useRef(null);
  const autosaveTimerRef = useRef(null);

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

  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (saveStatus === "unsaved" || saveStatus === "saving") {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [saveStatus]);

  const pauseAutosaveForDraft = () => {
    draftPendingRef.current = true;
    setIsDraftPending(true);
    setIsTeaserDraftPending(true);
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    setSaveStatus("unsaved");
  };

  const scheduleAutosave = (updatedBook) => {
    setSaveStatus("unsaved");
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    // Paused: the change stays local (and marked unsaved) until manual Save.
    if (draftPendingRef.current) return;
    autosaveTimerRef.current = setTimeout(async () => {
      autosaveTimerRef.current = null;
      if (draftPendingRef.current) return;
      setSaveStatus("saving");
      try {
        await handleSaveChanges(updatedBook, false);
        // A teaser draft may have arrived while this (pre-draft) save was in
        // flight: the draft itself is still unsaved, so don't claim "Saved".
        setSaveStatus(draftPendingRef.current ? "unsaved" : "saved");
      } catch (error) {
        setSaveStatus("error");
      }
    }, 2500);
  };

  // `unreviewedDraft: true` marks the change as AI-drafted text that must be
  // reviewed before it's persisted (the storefront teaser): it pauses all
  // automatic saving for the book until the admin clicks Save. See
  // isDraftPending above.
  const handleBookChange = (e, { unreviewedDraft = false } = {}) => {
    const { name, value } = e.target;
    if (unreviewedDraft) {
      // Arrives after an AI request, from a closure captured at click time:
      // merge into the latest state so edits made while it was generating
      // aren't overwritten.
      setBook((prev) => ({ ...prev, [name]: value }));
      setIsTeaserDraftPending(true);
      pauseAutosaveForDraft();
      return;
    }
    const updatedBook = { ...book, [name]: value };
    setBook(updatedBook);
    scheduleAutosave(updatedBook);
  };

  const handleChapterChange = (e) => {
    const { name, value } = e.target;
    const updatedChapters = [...book.chapters];
    updatedChapters[selectedChapterIndex] = {
      ...updatedChapters[selectedChapterIndex],
      [name]: value,
    };
    const updatedBook = { ...book, chapters: updatedChapters };
    setBook(updatedBook);
    scheduleAutosave(updatedBook);
  };

  // Chapter summaries are matched by chapter _id (the summary endpoint needs
  // a saved chapter), so a draft lands on the right chapter even if the
  // chapters were reordered while it was generating.
  const updateChapterById = (chapterId, fields) =>
    setBook((prev) => ({
      ...prev,
      chapters: prev.chapters.map((chapter) =>
        chapter._id === chapterId ? { ...chapter, ...fields } : chapter
      ),
    }));

  // An AI-drafted summary: unreviewed, so it pauses autosave like the teaser.
  const handleSummaryDraft = (chapterId, summary, sourceHash) => {
    updateChapterById(chapterId, { summary, summaryEdited: false, summarySourceHash: sourceHash });
    setPendingSummaryIds((ids) => (ids.includes(chapterId) ? ids : [...ids, chapterId]));
    pauseAutosaveForDraft();
  };

  // The admin typing in a summary. Marks it edited, so regenerating asks
  // first; autosaves normally unless a draft is pending.
  const handleSummaryEdit = (chapterId, summary) => {
    const updatedBook = {
      ...book,
      chapters: book.chapters.map((chapter) =>
        chapter._id === chapterId ? { ...chapter, summary, summaryEdited: true } : chapter
      ),
    };
    setBook(updatedBook);
    scheduleAutosave(updatedBook);
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

  // Appends AI-generated outline entries — same shape/placement as a
  // manually-added chapter (empty content, filled in afterward via the
  // normal per-chapter generate flow) — so this only updates local state,
  // matching handleAddChapter/handleDeleteChapter/handleReorderChapters
  // above rather than persisting immediately. insertBeforeIndex is computed
  // server-side (see aiController.js's extendOutline) from the book as
  // currently saved in the DB, so it accounts for the Conclusion-stays-last
  // convention without the frontend needing its own copy of that logic.
  const handleGenerateMoreChapters = async (count) => {
    setIsGeneratingMoreChapters(true);
    try {
      const response = await axiosInstance.post(
        API_PATHS.AI.EXTEND_OUTLINE(bookId),
        { count }
      );
      const { outline, insertBeforeIndex } = response.data;
      const newChapters = (outline || []).map((entry) => ({
        title: entry.title,
        description: entry.description || "",
        content: "",
      }));

      if (newChapters.length === 0) {
        toast.error("No new chapters were generated.");
        return;
      }

      const updatedChapters = [...book.chapters];
      const insertAt = Math.min(
        Math.max(insertBeforeIndex ?? updatedChapters.length, 0),
        updatedChapters.length
      );
      updatedChapters.splice(insertAt, 0, ...newChapters);
      setBook((prev) => ({ ...prev, chapters: updatedChapters }));
      setSelectedChapterIndex(insertAt);
      toast.success(
        `${newChapters.length} new chapter${newChapters.length !== 1 ? "s" : ""} generated!`
      );
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to generate more chapters"));
    } finally {
      setIsGeneratingMoreChapters(false);
    }
  };

  // Entry point for the Intro/Conclusion toggle wherever it's flipped
  // (ChapterSidebar.jsx or BookDetailsTab.jsx both call this instead of the
  // plain onBookChange, so there's one shared decision tree regardless of
  // which screen triggered it). Turning it off is always a no-op on
  // chapters — only turning it on can trigger a retrofit, and only when
  // there's actually something to retrofit.
  const handleToggleIntroConclusionStructure = () => {
    const turningOn = !book.useIntroConclusionStructure;

    if (!turningOn) {
      handleBookChange({
        target: { name: "useIntroConclusionStructure", value: false },
      });
      return;
    }

    const chapters = book.chapters || [];
    const needsRetrofit =
      chapters.length > 0 &&
      !looksLikeIntroduction(chapters[0]) &&
      !looksLikeConclusion(chapters[chapters.length - 1]);

    if (!needsRetrofit) {
      // No chapters yet, or the book already has a real Introduction/
      // Conclusion at one end — nothing to retrofit, just flip the flag.
      handleBookChange({
        target: { name: "useIntroConclusionStructure", value: true },
      });
      return;
    }

    setIsIntroConclusionConfirmOpen(true);
  };

  // shouldGenerate is false when the user declines the retrofit modal —
  // the flag still turns on (matching the plain-toggle behavior), it just
  // doesn't touch any chapters.
  const handleIntroConclusionConfirm = async (shouldGenerate) => {
    setIsIntroConclusionConfirmOpen(false);

    if (!shouldGenerate) {
      handleBookChange({
        target: { name: "useIntroConclusionStructure", value: true },
      });
      return;
    }

    setIsGeneratingIntroConclusion(true);
    try {
      const response = await axiosInstance.post(
        API_PATHS.AI.GENERATE_INTRO_CONCLUSION(bookId)
      );
      const { introduction, conclusion } = response.data;

      // Purely additive — the existing first/last chapters are spread back
      // in untouched, just no longer first/last.
      const updatedChapters = [
        { title: introduction.title, description: introduction.description || "", content: "" },
        ...book.chapters,
        { title: conclusion.title, description: conclusion.description || "", content: "" },
      ];
      const updatedBook = {
        ...book,
        chapters: updatedChapters,
        useIntroConclusionStructure: true,
      };
      setBook(updatedBook);
      setSelectedChapterIndex(0);
      // Unlike handleGenerateMoreChapters, this also flips a book-level
      // flag — every OTHER path that flips this same flag (turning off,
      // declining the retrofit, no-retrofit-needed) already autosaves via
      // handleBookChange, so this path persists immediately too rather than
      // leaving the toggle looking "on" but actually unsaved.
      scheduleAutosave(updatedBook);
      toast.success("Introduction and Conclusion chapters added!");
    } catch (error) {
      toast.error(
        getErrorMessage(error, "Failed to generate introduction/conclusion")
      );
    } finally {
      setIsGeneratingIntroConclusion(false);
    }
  };

  // Chapters added in this session have no _id until the server assigns one
  // on save. Without adopting it, every later save would send the chapter
  // id-less again and the server would mint a new _id each time, which
  // detaches anything keyed by chapter id (audiobook narration). Matched by
  // position and title, so a chapter added or moved while the save was in
  // flight is simply left for the next save.
  const adoptServerChapterIds = (serverChapters) => {
    if (!Array.isArray(serverChapters)) return;
    setBook((prev) => {
      if (!prev?.chapters?.some((chapter) => !chapter._id)) return prev;
      const usedIds = new Set(prev.chapters.map((chapter) => chapter._id).filter(Boolean));
      let changed = false;
      const chapters = prev.chapters.map((chapter, index) => {
        const server = serverChapters[index];
        if (chapter._id || !server?._id || usedIds.has(server._id) || server.title !== chapter.title) {
          return chapter;
        }
        changed = true;
        usedIds.add(server._id);
        return { ...chapter, _id: server._id };
      });
      return changed ? { ...prev, chapters } : prev;
    });
  };

  const handleSaveChanges = async (bookToSave = book, showToast = true) => {
    setIsSaving(true);
    try {
      const response = await axiosInstance.put(
        `${API_PATHS.BOOKS.UPDATE_BOOK}/${bookId}`,
        bookToSave
      );
      adoptServerChapterIds(response.data?.chapters);
      if (showToast) toast.success("Changes saved successfully!");
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to save changes"));
      throw error;
    } finally {
      setIsSaving(false);
    }
  };

  const handleManualSave = async () => {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    setSaveStatus("saving");
    try {
      await handleSaveChanges();
      // The admin has now reviewed and published the draft: back to normal
      // autosave. Stays paused if the save failed.
      draftPendingRef.current = false;
      setIsDraftPending(false);
      setIsTeaserDraftPending(false);
      setPendingSummaryIds([]);
      setSaveStatus("saved");
    } catch (error) {
      setSaveStatus("error");
    }
  };

  // Cover upload and publish toggle save one thing on the server and return
  // the whole book. Only the fields that action changed are taken from it:
  // replacing the local book would revert anything not saved yet, including
  // unreviewed AI drafts (teaser, chapter summaries) while autosave is
  // paused for them, and edits still waiting for the autosave debounce.
  const applyServerFields = (serverBook, fields) => {
    setBook((prev) => {
      if (!prev) return serverBook;
      const next = { ...prev };
      for (const field of fields) next[field] = serverBook[field];
      return next;
    });
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
      applyServerFields(response.data, ["coverImage"]);
      toast.success("Cover image updated!");
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to upload cover"));
    } finally {
      setIsUploading(false);
    }
  };

  // Publish (with the rights confirmation for books by other authors) or
  // "Unpublish immediately" (with an optional private takedown note).
  // Returns true on success so the dialog can close.
  const handleTogglePublish = async ({ confirmRights = false, takedownNote } = {}) => {
    setIsTogglingPublish(true);
    try {
      const response =
        book.status === "published"
          ? await axiosInstance.post(API_PATHS.BOOKS.UNPUBLISH(bookId), takedownNote ? { takedownNote } : {})
          : await axiosInstance.put(`${API_PATHS.BOOKS.TOGGLE_PUBLISH}/${bookId}/publish`, confirmRights ? { confirmRights: true } : {});
      applyServerFields(response.data, ["status", "shareId", "rights"]);
      toast.success(
        response.data.status === "published"
          ? "Book published! Anyone with the link can now read it."
          : "Book unpublished. Its store page and share link stopped working; existing buyers can still read it."
      );
      return true;
    } catch (error) {
      const missing = error.response?.data?.missing;
      toast.error(missing?.length ? `Before publishing: ${missing.join(", ")}.` : getErrorMessage(error, "Failed to update publish status"));
      return false;
    } finally {
      setIsTogglingPublish(false);
    }
  };

  const handleRightsSaved = (rights) => applyServerFields({ rights }, ["rights"]);

  const handleGenerateChapterContent = async (index) => {
    const chapter = book.chapters[index];
    if (!chapter?.title) {
      toast.error("Chapter title is required");
      return;
    }

    setIsGenerating(index);

    const applyContent = (content) => {
      const updatedChapters = [...book.chapters];
      updatedChapters[index] = { ...updatedChapters[index], content };
      const updatedBook = { ...book, chapters: updatedChapters };
      setBook(updatedBook);
      return updatedBook;
    };

    if (!navigator.onLine) {
      toast.error("You're offline — AI generation needs a connection.");
      setIsGenerating(null);
      return;
    }

    let accumulated = "";
    try {
      const token = localStorage.getItem("token");
      const response = await fetch(
        `${BASE_URL}${API_PATHS.AI.GENERATE_CHAPTER_CONTENT}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            chapterTitle: chapter.title,
            chapterDescription: chapter.description || "",
            tones: book.voiceProfile?.tones || [],
          }),
        }
      );

      if (!response.ok || !response.body) {
        let message = "Failed to generate content";
        try {
          const errJson = await response.json();
          message = errJson.message || message;
        } catch {
          // response wasn't JSON (e.g. stream already started) — use default message
        }
        throw new Error(message);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let boundary;
        while ((boundary = buffer.indexOf("\n\n")) !== -1) {
          const rawEvent = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);

          let eventType = "message";
          const dataLines = [];
          for (const line of rawEvent.split("\n")) {
            if (line.startsWith("event:")) eventType = line.slice(6).trim();
            else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
          }
          if (dataLines.length === 0) continue;
          const data = JSON.parse(dataLines.join("\n"));

          if (eventType === "chunk") {
            accumulated += data.text;
            applyContent(accumulated);
          } else if (eventType === "error") {
            throw new Error(data.message || "Generation failed");
          } else if (eventType === "done") {
            accumulated = data.content ?? accumulated;
          }
        }
      }

      const finalBook = applyContent(accumulated);
      toast.success(`Content generated for "${chapter.title}"`);
      if (draftPendingRef.current) {
        // Paused for an unreviewed teaser draft: keep the new chapter local
        // until the admin reviews and clicks Save.
        setSaveStatus("unsaved");
      } else {
        await handleSaveChanges(finalBook, false);
      }
    } catch (error) {
      if (accumulated) {
        const partialBook = applyContent(accumulated);
        scheduleAutosave(partialBook);
        toast.error(
          !navigator.onLine
            ? "You went offline — partial content kept, reconnect to continue."
            : "Generation interrupted — partial content kept"
        );
      } else if (!navigator.onLine) {
        toast.error("You're offline — AI generation needs a connection.");
      } else {
        toast.error(error.message || "Failed to generate content");
      }
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
      toast.error(getErrorMessage(error, "Failed to export PDF"), { id: toastId });
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
      toast.error(getErrorMessage(error, "Failed to export DOCX"), { id: toastId });
    }
  };

  const handleExportEPUB = async () => {
    const toastId = toast.loading("Generating EPUB...");
    try {
      const response = await axiosInstance.get(
        `${API_PATHS.EXPORT.EPUB}/${bookId}/epub`,
        { responseType: "blob" }
      );
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `${book.title || "book"}.epub`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success("EPUB exported!", { id: toastId });
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to export EPUB"), { id: toastId });
    }
  };

  if (isLoading || !book) {
    return <EditorSkeleton />;
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
          <div className="absolute inset-y-0 left-0 w-80 bg-white shadow-2xl flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-gray-100 flex-shrink-0">
              <span className="font-semibold text-gray-900">Chapters</span>
              <button
                onClick={() => setIsSidebarOpen(false)}
                className="w-9 h-9 rounded-xl flex items-center justify-center text-gray-500 hover:bg-gray-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {/* ChapterSidebar's root is `h-full` — without this wrapper
                being a bounded flex child, `h-full` resolves against this
                whole panel (100% of the viewport) *on top of* the "Chapters"
                header already above it, overflowing the panel with no
                scroll route and pushing the "Add New Chapter" footer button
                off-screen entirely. min-h-0 is required alongside flex-1 —
                a flex child otherwise refuses to shrink below its content's
                natural height. */}
            <div className="flex-1 min-h-0">
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
                onGenerateMoreChapters={handleGenerateMoreChapters}
                isGeneratingMoreChapters={isGeneratingMoreChapters}
                onToggleIntroConclusionStructure={handleToggleIntroConclusionStructure}
                isGeneratingIntroConclusion={isGeneratingIntroConclusion}
              />
            </div>
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
          onGenerateMoreChapters={handleGenerateMoreChapters}
          isGeneratingMoreChapters={isGeneratingMoreChapters}
          onToggleIntroConclusionStructure={handleToggleIntroConclusionStructure}
          isGeneratingIntroConclusion={isGeneratingIntroConclusion}
        />
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-xl border-b border-gray-200">
          <div className="flex items-center justify-between gap-3 px-4 lg:px-8 h-16">
            <div className="flex items-center gap-4 min-w-0">
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

            {/* Tabs (scroll sideways when they don't fit, rather than widening the page) */}
            <div className="flex items-center bg-gray-100 p-1 rounded-2xl min-w-0 overflow-x-auto [scrollbar-width:none] [&>button]:shrink-0 [&>button]:whitespace-nowrap">
              <button
                onClick={() => setActiveTab("editor")}
                className={`flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-medium transition-all ${
                  activeTab === "editor"
                    ? "bg-white text-accent-hover shadow-sm"
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
                    ? "bg-white text-accent-hover shadow-sm"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                <NotebookText className="w-4 h-4" />
                Details
              </button>
              <button
                onClick={() => setActiveTab("vitals")}
                className={`flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-medium transition-all ${
                  activeTab === "vitals"
                    ? "bg-white text-accent-hover shadow-sm"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                <Activity className="w-4 h-4" />
                Vitals
              </button>
              <button
                onClick={() => setActiveTab("audiobook")}
                className={`flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-medium transition-all ${
                  activeTab === "audiobook"
                    ? "bg-white text-accent-hover shadow-sm"
                    : "text-gray-600 hover:text-gray-900"
                }`}
                title="Audiobook"
              >
                <Headphones className="w-4 h-4" />
                <span className="hidden md:inline">Audiobook</span>
              </button>
              <button
                onClick={() => setActiveTab("translations")}
                className={`flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-medium transition-all ${
                  activeTab === "translations"
                    ? "bg-white text-accent-hover shadow-sm"
                    : "text-gray-600 hover:text-gray-900"
                }`}
                title="Translations"
              >
                <Languages className="w-4 h-4" />
                <span className="hidden md:inline">Translations</span>
              </button>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 flex-shrink-0">
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
                <DropdownItem onClick={handleExportEPUB}>
                  <FileText className="w-4 h-4" />
                  Export as EPUB
                </DropdownItem>
              </Dropdown>

              {saveStatus === "saved" && (
                <span className="hidden sm:flex items-center gap-1.5 text-sm text-emerald-600">
                  <Check className="w-4 h-4" />
                  Saved
                </span>
              )}
              {saveStatus === "saving" && (
                <span className="hidden sm:flex items-center gap-1.5 text-sm text-gray-500">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving…
                </span>
              )}
              {saveStatus === "unsaved" && (
                <span
                  className={`hidden sm:flex items-center gap-1.5 text-sm ${
                    isDraftPending ? "text-amber-700 font-medium" : "text-gray-500"
                  }`}
                  title={
                    isDraftPending
                      ? "Autosave is paused until you review the AI-drafted text (teaser or chapter summaries) and click Save."
                      : undefined
                  }
                >
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                  {isDraftPending ? "Review and save" : "Unsaved changes"}
                </span>
              )}
              {saveStatus === "error" && (
                <span className="hidden sm:flex items-center gap-1.5 text-sm text-red-600">
                  <AlertCircle className="w-4 h-4" />
                  Couldn't save
                </span>
              )}

              <Button
                onClick={handleManualSave}
                loading={isSaving}
                className="flex items-center gap-2 shadow-lg shadow-accent-500/20"
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
            ) : activeTab === "details" ? (
              <BookDetailsTab
                book={book}
                onCoverUpload={handleCoverImageUpload}
                onBookChange={handleBookChange}
                isTeaserDraftPending={isTeaserDraftPending}
                pendingSummaryIds={pendingSummaryIds}
                onSummaryDraft={handleSummaryDraft}
                onSummaryEdit={handleSummaryEdit}
                onToggleIntroConclusionStructure={handleToggleIntroConclusionStructure}
                isGeneratingIntroConclusion={isGeneratingIntroConclusion}
                isUploading={isUploading}
                fileInputRef={fileInputRef}
                onTogglePublish={handleTogglePublish}
                onRightsSaved={handleRightsSaved}
                isTogglingPublish={isTogglingPublish}
              />
            ) : activeTab === "audiobook" ? (
              <Suspense
                fallback={
                  <div className="flex justify-center py-16">
                    <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                  </div>
                }
              >
                <AudiobookTab
                  bookId={bookId}
                  hasUnsavedChanges={saveStatus === "unsaved" || saveStatus === "saving"}
                />
              </Suspense>
            ) : activeTab === "translations" ? (
              <Suspense
                fallback={
                  <div className="flex justify-center py-16">
                    <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                  </div>
                }
              >
                <TranslationsTab
                  bookId={bookId}
                  hasUnsavedChanges={saveStatus === "unsaved" || saveStatus === "saving"}
                />
              </Suspense>
            ) : (
              <VitalsTab book={book} />
            )}
          </div>
        </main>
      </div>

      {/* Shared between ChapterSidebar.jsx and BookDetailsTab.jsx — one
          confirmation regardless of which screen flips the toggle, rather
          than duplicating this decision in both places. */}
      <Modal
        isOpen={isIntroConclusionConfirmOpen}
        onClose={() => handleIntroConclusionConfirm(false)}
        title="Add Introduction & Conclusion?"
      >
        <p className="text-gray-600 leading-relaxed mb-6">
          This will add a new Introduction chapter at the start and a new
          Conclusion chapter at the end. Your existing chapters won't be
          changed. Continue?
        </p>
        <div className="flex justify-end gap-3">
          <Button
            variant="secondary"
            onClick={() => handleIntroConclusionConfirm(false)}
          >
            No
          </Button>
          <Button onClick={() => handleIntroConclusionConfirm(true)}>
            Yes, add them
          </Button>
        </div>
      </Modal>
    </div>
  );
};

export default EditorPage;