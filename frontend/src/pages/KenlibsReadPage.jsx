import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import MDEditor from "@uiw/react-md-editor";
import toast from "react-hot-toast";
import { Lock, BookX, ArrowLeft, NotebookPen, X, Award, Download } from "lucide-react";
import axiosInstance from "../utils/axiosInstance";
import { API_PATHS } from "../utils/apiPaths";
import ViewBook from "../components/view/ViewBook";
import Button from "../components/ui/Button";
import MarkdownContent from "../components/shared/MarkdownContent";
import ListenModeControls from "../components/kenlibs/ListenModeControls";
import WordExplainPopup from "../components/kenlibs/WordExplainPopup";
import ViewBookSkeleton from "../components/skeletons/ViewBookSkeleton";
import useDocumentTitle from "../hooks/useDocumentTitle";
import useListenMode from "../hooks/useListenMode";
import { buildSpeechBlocks } from "../utils/speechText";
import getErrorMessage from "../utils/getErrorMessage";

// Short debounces (adapted from Step 2's autosave pattern, not reused
// verbatim — different data shape and no book-wide save-state banner here)
// so rapid chapter-clicking or normal typing doesn't fire a request per
// keystroke/click, while still saving well within a realistic "close the
// tab" window.
const CHAPTER_SAVE_DELAY_MS = 800;
const NOTES_SAVE_DELAY_MS = 800;
// Longer than the others deliberately — Listen Mode can advance a block
// every few seconds while actively reading, and this position only needs to
// be "in the right neighborhood" on resume, not exact.
const SPOKEN_BLOCK_SAVE_DELAY_MS = 3000;

// Step 36's word-explain popup: selections longer than this are almost
// certainly an accidental multi-paragraph drag rather than a word/phrase
// someone wants explained, so they're silently ignored rather than sent
// anywhere. Mirrors kenlibsController.js's EXPLAIN_WORD_MAX_LENGTH.
const EXPLAIN_SELECTION_MAX_LENGTH = 120;
// Conservative width/height estimate used to clamp the popup on-screen
// before it has actually rendered (same reasoning as SimpleMDEditor's
// TOOLBAR_WIDTH estimate for Step 19's inline AI toolbar).
const EXPLAIN_POPUP_WIDTH = 320;
const EXPLAIN_POPUP_HEIGHT_ESTIMATE = 260;

// Best-effort "which sentence is this selection inside" — walks up to the
// nearest block-level ancestor, naively splits its text on sentence-ending
// punctuation, and returns whichever chunk contains the selected text. Only
// used as context for the AI fallback explanation, not shown to the reader
// directly, so an imperfect split (e.g. on "Mr." or a decimal) is a
// non-issue in practice.
const extractSentenceContext = (range, selectedText) => {
  let node = range.commonAncestorContainer;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  const block =
    node?.closest?.("p, li, blockquote, h1, h2, h3, h4, h5, h6, td, th") || node;
  const blockText = (block?.textContent || "").replace(/\s+/g, " ").trim();
  if (!blockText) return "";

  const idx = blockText.indexOf(selectedText);
  if (idx === -1) return blockText.slice(0, 300);

  const sentences = blockText.match(/[^.!?]+[.!?]*/g) || [blockText];
  let cursor = 0;
  for (const sentence of sentences) {
    cursor += sentence.length;
    if (cursor >= idx) return sentence.trim();
  }
  return blockText.slice(0, 300);
};

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
  const [initialSpokenBlockIndex, setInitialSpokenBlockIndex] = useState(0);
  const [notes, setNotes] = useState("");
  const [isNotepadOpen, setIsNotepadOpen] = useState(false);
  const [notesSaveStatus, setNotesSaveStatus] = useState("saved"); // saved | saving | unsaved
  const [isListenModeOn, setIsListenModeOn] = useState(false);
  const [isDownloadingCertificate, setIsDownloadingCertificate] = useState(false);
  // Step 36: the word/phrase explanation popup. null = closed. `key` forces
  // WordExplainPopup to remount (and re-run its dictionary lookup) on every
  // new selection, including re-selecting the exact same word twice in a row.
  const [explainSelection, setExplainSelection] = useState(null);
  // Scoped to just the current chapter's rendered content (see
  // renderChapterContent below) — deliberately not the whole page, so
  // selecting text in the notepad or the completion banner never triggers
  // this.
  const contentContainerRef = useRef(null);

  const notesSaveTimerRef = useRef(null);
  // Latest not-yet-confirmed-saved notes value, or null once saved — lets
  // the beforeunload/pagehide handlers below fire one last best-effort
  // save if the debounce timer hasn't gone off yet.
  const pendingNotesRef = useRef(null);
  // lastChapterIndex and lastSpokenBlockIndex are saved through one
  // single-flight, latest-wins pipeline rather than two independent
  // debounced PUTs — confirmed via testing that firing overlapping PUT
  // requests for these two (both change together during active Listen Mode,
  // since auto-advancing a chapter and progressing through its blocks
  // happen in close succession) can have their HTTP responses arrive out of
  // order, letting an older chapter/block combination silently overwrite a
  // newer one that had already saved successfully — observed as a real
  // refresh resuming from a stale, earlier position despite the reader
  // having listened well past it. Never more than one PUT for this pair of
  // fields is in flight at a time; anything that changes while one is
  // already in flight is captured and sent as a single follow-up request
  // once it settles, so the last state always wins regardless of network
  // timing. See schedulePositionSave/flushPositionSave below.
  const positionSaveTimerRef = useRef(null);
  const positionSaveInFlightRef = useRef(false);
  const pendingPositionRef = useRef(null); // { lastChapterIndex?, lastSpokenBlockIndex? }
  const viewBookRef = useRef(null);
  // Which chapter Listen Mode should read — kept in sync with ViewBook's own
  // chapter index via handleChapterChange below (the same callback already
  // used for progress-saving), so Listen Mode never needs its own idea of
  // "current chapter."
  const currentChapterIndexRef = useRef(initialChapterIndex);
  // The block Listen Mode should resume from the *next* time it's turned on
  // — seeded from ReaderProgress on load, consumed (reset to 0) the first
  // time it's actually used, so a later Stop→Play within the same session
  // still restarts from the top like it always has. Only trusted when the
  // reader hasn't navigated to a different chapter than the one the
  // position was saved for — see handleToggleListenMode.
  const resumeBlockIndexRef = useRef(0);

  useDocumentTitle(book ? `${book.title} — Kenlibs` : "Kenlibs");

  useEffect(() => {
    currentChapterIndexRef.current = initialChapterIndex;
  }, [initialChapterIndex]);

  useEffect(() => {
    resumeBlockIndexRef.current = initialSpokenBlockIndex;
  }, [initialSpokenBlockIndex]);

  const listenMode = useListenMode({
    onChapterEnd: () => {
      if (!isListenModeOn) return;
      const chapters = book?.chapters || [];
      const nextIndex = currentChapterIndexRef.current + 1;
      if (nextIndex >= chapters.length) return; // end of book — nothing more to advance to
      viewBookRef.current?.goToNextChapter();
    },
  });

  // Builds this chapter's speech blocks and starts Listen Mode reading it
  // from `fromBlockIndex` (default: the top). Used when Listen Mode is
  // first turned on, when the reader is already listening and the chapter
  // changes (manually or via auto-advance), and when resuming a previous
  // session's position — same primitive either way.
  const speakChapter = (index, fromBlockIndex = 0) => {
    const chapter = book?.chapters?.[index];
    if (!chapter) return;
    const material = buildSpeechBlocks(chapter.content);
    if (material.blocks.length === 0) return; // nothing speakable in this chapter
    listenMode.play(material, fromBlockIndex);
  };

  const handleToggleListenMode = () => {
    if (isListenModeOn) {
      setIsListenModeOn(false);
      listenMode.stop();
    } else {
      setIsListenModeOn(true);
      // Only resume mid-chapter if the reader hasn't navigated away from
      // the chapter this position was saved for — otherwise a block index
      // from a completely different chapter would be meaningless. Consumed
      // immediately so a later Stop→Play in this same session restarts
      // from the top as usual, not this stale saved position again.
      const startBlock =
        currentChapterIndexRef.current === initialChapterIndex ? resumeBlockIndexRef.current : 0;
      resumeBlockIndexRef.current = 0;
      speakChapter(currentChapterIndexRef.current, startBlock);
    }
  };

  // Step 36: fires on mouseup inside the chapter content container — the
  // only reliable "selection settled" moment, and (per Step 19's toolbar
  // precedent) also the moment a double-click's browser-native word
  // selection has already landed, so no separate dblclick handler is
  // needed. A plain click with no drag collapses the selection, which
  // clears any open popup here; WordExplainPopup's own click-away listener
  // covers dismissing it from clicks that land outside the content area
  // entirely (e.g. the notepad, the completion banner).
  const handleSelectionEnd = () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      setExplainSelection(null);
      return;
    }

    const container = contentContainerRef.current;
    if (
      !container ||
      !container.contains(selection.anchorNode) ||
      !container.contains(selection.focusNode)
    ) {
      return; // selection isn't (fully) inside this chapter's content
    }

    const text = selection.toString().trim();
    if (!text || text.length > EXPLAIN_SELECTION_MAX_LENGTH) {
      setExplainSelection(null);
      return;
    }

    const range = selection.getRangeAt(0);
    const sentence = extractSentenceContext(range, text);
    const rect = range.getBoundingClientRect();

    const left = Math.min(
      Math.max(rect.left, 12),
      window.innerWidth - EXPLAIN_POPUP_WIDTH - 12
    );
    const top = Math.min(rect.bottom + 10, window.innerHeight - EXPLAIN_POPUP_HEIGHT_ESTIMATE);

    setExplainSelection({
      key: `${text}-${Date.now()}`,
      word: text,
      sentence,
      position: { top, left },
    });
  };

  const renderChapterContent = (chapter, chapterIndex, fontSize) => {
    const { blocks } = buildSpeechBlocks(chapter.content);
    const isFinalChapter = chapterIndex === (book?.chapters?.length ?? 0) - 1;

    const body = (
      <div ref={contentContainerRef} onMouseUp={handleSelectionEnd}>
        {blocks.length === 0 ? (
          <MarkdownContent
            content={chapter.content}
            emptyMessage="No content available for this chapter."
            className="font-serif leading-loose text-gray-700"
            style={{ fontSize: `${fontSize}px` }}
          />
        ) : (
          <div
            data-color-mode="light"
            className="markdown-content font-serif leading-loose text-gray-700"
            style={{ fontSize: `${fontSize}px` }}
          >
            {blocks.map((block, i) => (
              <div
                key={i}
                className={`listen-block rounded-lg -mx-2 px-2 transition-colors duration-300 ${
                  listenMode.activeBlockIndex === i ? "bg-accent-50" : ""
                }`}
              >
                <MDEditor.Markdown source={block.markdown} prefixCls="" style={{ background: "transparent" }} />
              </div>
            ))}
          </div>
        )}
      </div>
    );

    // The finishing moment lives at the bottom of the final chapter's own
    // content — reached naturally by reading to the end, not a popup that
    // interrupts. Restrained per Step 31's reader-facing motion philosophy:
    // one spring pop-in, no confetti, no auto-opening anything.
    if (!isFinalChapter) return body;

    return (
      <>
        {body}
        <motion.div
          key={`completion-${bookId}`}
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 24, delay: 0.15 }}
          className="mt-14 rounded-3xl border border-accent-100 bg-gradient-to-br from-accent-50 to-white p-8 text-center shadow-sm"
        >
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-r from-accent to-accent-secondary text-white flex items-center justify-center mx-auto mb-5 shadow-lg shadow-accent-500/30">
            <Award className="w-8 h-8" />
          </div>
          <p className="text-xs font-bold tracking-[0.2em] uppercase text-accent-secondary mb-2">
            Achievement Unlocked
          </p>
          <h3 className="font-serif text-3xl sm:text-4xl font-extrabold text-gray-900 tracking-tight">
            You finished this book!
          </h3>
          <p className="text-gray-500 mt-3 max-w-md mx-auto">
            Nice work reaching the end of {book?.title || "this book"}. Download a certificate to
            mark the occasion.
          </p>
          <motion.div className="mt-7 inline-block" whileTap={{ scale: 0.97 }}>
            <Button
              size="xl"
              loading={isDownloadingCertificate}
              onClick={handleDownloadCertificate}
              className="flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Download Certificate
            </Button>
          </motion.div>
        </motion.div>
      </>
    );
  };

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
        setInitialSpokenBlockIndex(progressRes?.data?.lastSpokenBlockIndex ?? 0);
        setNotes(progressRes?.data?.notes ?? "");
        setStatus("ok");

        const chapters = bookRes.data?.chapters || [];
        const finalIndex = chapters.length - 1;
        const resolvedInitialIndex = Math.min(
          Math.max(progressRes?.data?.lastChapterIndex ?? 0, 0),
          Math.max(finalIndex, 0)
        );
        setInitialChapterIndex(resolvedInitialIndex);

        // Covers landing directly on the final chapter without ever firing
        // a chapter-change event to trigger the usual save — a book with
        // only one chapter, or resuming a session that was already sitting
        // on the last page. A plain fire-and-forget PUT rather than routing
        // through schedulePositionSave/flushPositionSave (defined further
        // down) — idempotent either way, since the backend only ever sets
        // completedAt once.
        if (finalIndex >= 0 && resolvedInitialIndex === finalIndex && !progressRes?.data?.completedAt) {
          axiosInstance
            .put(API_PATHS.KENLIBS.PROGRESS(bookId), { lastChapterIndex: resolvedInitialIndex })
            .catch(() => {});
        }
      } catch (error) {
        setStatus(error.response?.status === 403 ? "forbidden" : "not-found");
      }
    };
    fetchBookAndProgress();
  }, [bookId]);

  // Sends whatever's pending in pendingPositionRef, unless a request for
  // this pair of fields is already in flight — in which case it's left
  // there and picked up as soon as that one settles, rather than firing a
  // second overlapping request that could resolve out of order and
  // overwrite the newer value with the older one.
  const flushPositionSave = () => {
    if (positionSaveInFlightRef.current) return;
    const update = pendingPositionRef.current;
    if (!update) return;
    pendingPositionRef.current = null;
    positionSaveInFlightRef.current = true;
    axiosInstance
      .put(API_PATHS.KENLIBS.PROGRESS(bookId), update)
      .catch(() => {})
      .finally(() => {
        positionSaveInFlightRef.current = false;
        if (pendingPositionRef.current) flushPositionSave();
      });
  };

  const schedulePositionSave = (fields, delayMs) => {
    pendingPositionRef.current = { ...pendingPositionRef.current, ...fields };
    if (positionSaveTimerRef.current) clearTimeout(positionSaveTimerRef.current);
    positionSaveTimerRef.current = setTimeout(flushPositionSave, delayMs);
  };

  const handleChapterChange = (index) => {
    currentChapterIndexRef.current = index;

    // Landing on the final chapter skips the usual debounce and saves right
    // away — the completion banner (see renderChapterContent below) offers
    // a certificate download that only unlocks server-side once this exact
    // save round-trips and sets completedAt, so a reader who scrolls
    // straight to the button shouldn't have to wait out the normal
    // "close the tab" debounce window first.
    const isFinalChapter = index === (book?.chapters?.length ?? 0) - 1;
    schedulePositionSave({ lastChapterIndex: index }, isFinalChapter ? 0 : CHAPTER_SAVE_DELAY_MS);

    // Chapter changed while actively listening — whether the reader clicked
    // Next/Previous/a sidebar entry themselves, or this is Listen Mode's own
    // auto-advance calling goToNextChapter() — either way the audio should
    // always match what's on screen, so restart speech for the new chapter.
    if (isListenModeOn) {
      speakChapter(index);
    }
  };

  const handleDownloadCertificate = async () => {
    setIsDownloadingCertificate(true);
    try {
      const response = await axiosInstance.get(API_PATHS.KENLIBS.CERTIFICATE(bookId), {
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `${book?.title || "certificate"} — Kenlibs Certificate.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      // A 400 here almost always means the last-chapter save above hasn't
      // finished round-tripping yet (near-instant in practice, but not
      // literally zero latency) — a distinct, actionable message rather
      // than the generic export-failure fallback.
      if (error.response?.status === 400) {
        toast.error(error.response?.data?.message || "Still saving your progress — try again in a moment.");
      } else {
        toast.error(getErrorMessage(error, "Failed to generate certificate"));
      }
    } finally {
      setIsDownloadingCertificate(false);
    }
  };

  // Persists Listen Mode's position as it advances through blocks, so a
  // refresh can resume "in the right neighborhood" instead of from the top
  // of the chapter (see handleToggleListenMode). Debounced rather than
  // fired on every block — activeBlockIndex only changes when speech moves
  // to a new block in the first place, but a fast reader/rate could still
  // advance blocks faster than is worth a request each time.
  useEffect(() => {
    if (!isListenModeOn || listenMode.activeBlockIndex < 0) return;
    schedulePositionSave({ lastSpokenBlockIndex: listenMode.activeBlockIndex }, SPOKEN_BLOCK_SAVE_DELAY_MS);
    // schedulePositionSave is intentionally omitted: it's a plain function
    // redefined every render (not memoized), so including it would re-run
    // this effect — and re-debounce the save — on every render rather than
    // only when the block actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isListenModeOn, listenMode.activeBlockIndex, bookId]);

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

  // Best-effort final save if the reader closes/leaves/refreshes before a
  // debounce timer fires — fire-and-forget, since unload handlers can't
  // reliably await a response. Covers notes, chapter index, and Listen
  // Mode's block position so a refresh mid-sentence doesn't lose more than
  // a moment's worth of progress on any of them. Bypasses the position
  // pipeline's single-flight guard deliberately — the page is on its way
  // out either way, so there's no later request left to race against.
  useEffect(() => {
    const flushPending = () => {
      const update = { ...pendingPositionRef.current };
      pendingPositionRef.current = null;
      if (pendingNotesRef.current !== null) {
        update.notes = pendingNotesRef.current;
        pendingNotesRef.current = null;
      }
      if (Object.keys(update).length === 0) return;
      axiosInstance.put(API_PATHS.KENLIBS.PROGRESS(bookId), update).catch(() => {});
    };
    window.addEventListener("beforeunload", flushPending);
    window.addEventListener("pagehide", flushPending);
    return () => {
      flushPending();
      window.removeEventListener("beforeunload", flushPending);
      window.removeEventListener("pagehide", flushPending);
    };
  }, [bookId]);

  if (status === "loading") {
    return <ViewBookSkeleton />;
  }

  if (status === "ok") {
    return (
      <>
        <ViewBook
          ref={viewBookRef}
          book={book}
          backTo="/kenlibs/my-books"
          backLabel="My Books"
          animated
          initialChapterIndex={initialChapterIndex}
          onChapterChange={handleChapterChange}
          renderChapterContent={renderChapterContent}
          headerControls={
            <ListenModeControls
              listenMode={listenMode}
              isActive={isListenModeOn}
              onToggle={handleToggleListenMode}
              onReplay={() => speakChapter(currentChapterIndexRef.current)}
            />
          }
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

        {/* Step 36: word/phrase explanation popup — anchored near the
            selection via inline position style, closed by setting
            explainSelection back to null (click-away/Escape are handled
            inside WordExplainPopup itself). */}
        <AnimatePresence>
          {explainSelection && (
            <WordExplainPopup
              key={explainSelection.key}
              word={explainSelection.word}
              sentence={explainSelection.sentence}
              bookId={bookId}
              position={{ top: explainSelection.position.top, left: explainSelection.position.left }}
              onClose={() => setExplainSelection(null)}
            />
          )}
        </AnimatePresence>

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
      className="min-h-screen bg-surface-warm flex flex-col items-center justify-center py-32 text-center px-6"
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
