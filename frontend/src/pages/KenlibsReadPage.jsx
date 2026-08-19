import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Lock, BookX, ArrowLeft, NotebookPen, X } from "lucide-react";
import axiosInstance from "../utils/axiosInstance";
import { API_PATHS } from "../utils/apiPaths";
import ViewBook from "../components/view/ViewBook";
import Button from "../components/ui/Button";
import ViewBookSkeleton from "../components/skeletons/ViewBookSkeleton";
import useDocumentTitle from "../hooks/useDocumentTitle";

// Short debounces (adapted from Step 2's autosave pattern, not reused
// verbatim — different data shape and no book-wide save-state banner here)
// so rapid chapter-clicking or normal typing doesn't fire a request per
// keystroke/click, while still saving well within a realistic "close the
// tab" window.
const CHAPTER_SAVE_DELAY_MS = 800;
const NOTES_SAVE_DELAY_MS = 800;

// The gated reader — same ViewBook rendering as the creator's own preview
// (/view-book/:bookId) and the public share link (/read/:shareId), but
// sourced from the access-checked /api/kenlibs/read/:bookId endpoint. The
// access decision is entirely server-side; this page just reacts to
// whatever comes back (200 = readable, 403 = not authorized yet).
//
// Step 32 adds resume-where-you-left-off and a private notepad, both
// backed by ReaderProgress and scoped to this page only — the admin's own
// /view-book/:bookId preview doesn't get either.
const KenlibsReadPage = () => {
  const { bookId } = useParams();
  const navigate = useNavigate();
  const [book, setBook] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ok | forbidden | not-found
  const [initialChapterIndex, setInitialChapterIndex] = useState(0);
  const [notes, setNotes] = useState("");
  const [isNotepadOpen, setIsNotepadOpen] = useState(false);
  const [notesSaveStatus, setNotesSaveStatus] = useState("saved"); // saved | saving | unsaved

  const chapterSaveTimerRef = useRef(null);
  const notesSaveTimerRef = useRef(null);
  // Latest not-yet-confirmed-saved notes value, or null once saved — lets
  // the beforeunload/pagehide handlers below fire one last best-effort
  // save if the debounce timer hasn't gone off yet.
  const pendingNotesRef = useRef(null);

  useDocumentTitle(book ? `${book.title} — Kenlibs` : "Kenlibs");

  useEffect(() => {
    const fetchBookAndProgress = async () => {
      try {
        const [bookRes, progressRes] = await Promise.all([
          axiosInstance.get(API_PATHS.KENLIBS.READ(bookId)),
          // A progress-fetch hiccup shouldn't block reading — fall back to
          // a fresh-read default rather than erroring the whole page.
          axiosInstance.get(API_PATHS.KENLIBS.PROGRESS(bookId)).catch(() => null),
        ]);
        setBook(bookRes.data);
        setInitialChapterIndex(progressRes?.data?.lastChapterIndex ?? 0);
        setNotes(progressRes?.data?.notes ?? "");
        setStatus("ok");
      } catch (error) {
        setStatus(error.response?.status === 403 ? "forbidden" : "not-found");
      }
    };
    fetchBookAndProgress();
  }, [bookId]);

  const handleChapterChange = (index) => {
    if (chapterSaveTimerRef.current) clearTimeout(chapterSaveTimerRef.current);
    chapterSaveTimerRef.current = setTimeout(() => {
      axiosInstance
        .put(API_PATHS.KENLIBS.PROGRESS(bookId), { lastChapterIndex: index })
        .catch(() => {});
    }, CHAPTER_SAVE_DELAY_MS);
  };

  const handleNotesChange = (e) => {
    const value = e.target.value;
    setNotes(value);
    setNotesSaveStatus("unsaved");
    pendingNotesRef.current = value;

    if (notesSaveTimerRef.current) clearTimeout(notesSaveTimerRef.current);
    notesSaveTimerRef.current = setTimeout(async () => {
      setNotesSaveStatus("saving");
      try {
        await axiosInstance.put(API_PATHS.KENLIBS.PROGRESS(bookId), { notes: value });
        pendingNotesRef.current = null;
        setNotesSaveStatus("saved");
      } catch {
        setNotesSaveStatus("unsaved");
      }
    }, NOTES_SAVE_DELAY_MS);
  };

  // Best-effort final save if the reader closes/leaves before the debounce
  // timer fires — fire-and-forget, since unload handlers can't reliably
  // await a response.
  useEffect(() => {
    const flushPendingNotes = () => {
      if (pendingNotesRef.current === null) return;
      const value = pendingNotesRef.current;
      pendingNotesRef.current = null;
      axiosInstance.put(API_PATHS.KENLIBS.PROGRESS(bookId), { notes: value }).catch(() => {});
    };
    window.addEventListener("beforeunload", flushPendingNotes);
    window.addEventListener("pagehide", flushPendingNotes);
    return () => {
      flushPendingNotes();
      window.removeEventListener("beforeunload", flushPendingNotes);
      window.removeEventListener("pagehide", flushPendingNotes);
    };
  }, [bookId]);

  if (status === "loading") {
    return <ViewBookSkeleton />;
  }

  if (status === "ok") {
    return (
      <>
        <ViewBook
          book={book}
          backTo="/kenlibs/my-books"
          backLabel="My Books"
          animated
          initialChapterIndex={initialChapterIndex}
          onChapterChange={handleChapterChange}
        />

        {/* Floating notepad toggle — fixed, so it never obscures reading
            content and doesn't require touching ViewBook's own layout. */}
        <motion.button
          onClick={() => setIsNotepadOpen((open) => !open)}
          whileTap={{ scale: 0.92 }}
          className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full bg-gradient-to-r from-accent to-accent-secondary text-white shadow-xl shadow-accent-500/30 flex items-center justify-center"
          title="My notes"
        >
          <NotebookPen className="w-6 h-6" />
        </motion.button>

        <AnimatePresence>
          {isNotepadOpen && (
            <>
              <motion.div
                key="notepad-backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-0 bg-black/20 z-40"
                onClick={() => setIsNotepadOpen(false)}
              />
              <motion.div
                key="notepad-panel"
                initial={{ x: "100%" }}
                animate={{ x: 0 }}
                exit={{ x: "100%" }}
                transition={{ type: "spring", stiffness: 320, damping: 34 }}
                className="fixed top-0 right-0 h-full w-full sm:w-96 bg-white shadow-2xl z-50 flex flex-col"
              >
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
                  <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                    <NotebookPen className="w-4 h-4 text-accent" />
                    My Notes
                  </h2>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-400">
                      {notesSaveStatus === "saving"
                        ? "Saving…"
                        : notesSaveStatus === "unsaved"
                          ? "Unsaved"
                          : "Saved"}
                    </span>
                    <button
                      onClick={() => setIsNotepadOpen(false)}
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <textarea
                  value={notes}
                  onChange={handleNotesChange}
                  placeholder="Jot down thoughts as you read — only you can see this."
                  className="flex-1 w-full resize-none p-5 text-sm text-gray-700 leading-relaxed focus:outline-none"
                />
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </>
    );
  }

  const isForbidden = status === "forbidden";

  return (
    <motion.div
      className="min-h-screen bg-gray-50 flex flex-col items-center justify-center py-32 text-center px-6"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
    >
      <div className="w-20 h-20 bg-accent-50 rounded-3xl flex items-center justify-center mb-6">
        {isForbidden ? (
          <Lock className="w-10 h-10 text-accent-500" />
        ) : (
          <BookX className="w-10 h-10 text-accent-500" />
        )}
      </div>

      <h2 className="text-2xl font-bold text-gray-900 mb-3">
        {isForbidden ? "You don't have access to this book" : "Book not found"}
      </h2>

      <p className="text-gray-500 max-w-md mb-8">
        {isForbidden
          ? "You'll be able to read this once your purchase request for it is approved."
          : "This book may have been removed."}
      </p>

      <Button onClick={() => navigate("/kenlibs/my-books")} className="flex items-center gap-2">
        <ArrowLeft className="w-4 h-4" />
        Back to My Books
      </Button>
    </motion.div>
  );
};

export default KenlibsReadPage;
