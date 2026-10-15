import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import MDEditor from "@uiw/react-md-editor";
import toast from "react-hot-toast";
import { Lock, BookX, ArrowLeft, NotebookPen, X, Award, Download, Highlighter } from "lucide-react";
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
import { getReadingLanguage, setReadingLanguage } from "../utils/readingLanguage";
import ReadingLanguageSelect from "../components/kenlibs/ReadingLanguageSelect";
import TranslationNotice from "../components/kenlibs/TranslationNotice";
import KenlibsWhatsAppButton from "../components/kenlibs/KenlibsWhatsAppButton";
import SelectionToolbar from "../components/kenlibs/SelectionToolbar";
import HighlightPopover from "../components/kenlibs/HighlightPopover";
import { TOOLBAR_WIDTH, POPOVER_WIDTH } from "../utils/annotationUi";
import AnnotationsPanel from "../components/kenlibs/AnnotationsPanel";
import BookmarkButton from "../components/kenlibs/BookmarkButton";
import useAnnotations from "../hooks/useAnnotations";
import { createAnchor, resolveAnchor, quoteStillPresent, annotationsFor } from "../utils/annotationAnchor";
import {
  paragraphElementOf,
  paragraphIndexOf,
  offsetWithin,
  rangeFromOffsets,
  caretAtPoint,
  paintHighlights,
  clearHighlights,
  supportsHighlightPainting,
} from "../utils/annotationDom";

// Only downloaded when the book actually has AI narration (see audioData
// below), so readers of books without audio never load it.
const AudiobookPlayer = lazy(() => import("../components/kenlibs/AudiobookPlayer"));
import ChapterRecap from "../components/kenlibs/ChapterRecap";

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
// Floating controls at the bottom of the reader (all fixed, z-40):
//   left:  the audiobook "Listen" pill, or the open player (full width on
//          phones, a 400px card from 640px up), reporting its own height;
//   right: one dock column: WhatsApp support above the notepad button.
// On phones the dock sits above the open player instead of on top of it.
// The chapter's scrolling content always ends with at least the height of
// the tallest of these (+ safe-area inset), so scrolled to the end, the
// last lines and the Previous/Next buttons sit above them, never under.
const FLOAT_EDGE_PX = 24; // bottom-6
const OPEN_PLAYER_EDGE_PX = 16; // the open player's bottom-4
const DOCK_GAP_PX = 12;
const DOCK_HEIGHT_PX = 56 + 12 + 48; // notepad + gap + WhatsApp
const CONTENT_CLEARANCE_PX = 16;

// A popup's top: below its anchor if it fits above the floating controls
// (the bottom `reservePx` of the screen); otherwise above both the anchor
// and that zone (an anchor can itself sit beside the controls); always on
// screen.
const placeAbove = (reservePx, { below, above, height }) => {
  const limit = window.innerHeight - reservePx;
  if (below + height <= limit) return below;
  const top = Math.min(above, limit) - height;
  if (top >= 8) return top;
  return Math.max(8, Math.min(below, window.innerHeight - height - 8));
};

const useMinWidth = (px) => {
  const query = `(min-width: ${px}px)`;
  const [matches, setMatches] = useState(() => typeof window !== "undefined" && Boolean(window.matchMedia?.(query).matches));
  useEffect(() => {
    const list = window.matchMedia?.(query);
    if (!list) return undefined;
    const onChange = (event) => setMatches(event.matches);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);
  return matches;
};

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
  // AI narration for this book ({ chapters: [...] } with signed URLs), or
  // null if it has none. Separate from the browser-voice Listen Mode,
  // which stays the fallback for chapters without narration.
  const [audioData, setAudioData] = useState(null);
  const [isPlayerExpanded, setIsPlayerExpanded] = useState(false);
  const [playerHeight, setPlayerHeight] = useState(0);
  const isWide = useMinWidth(640);
  const shownPlayerHeight = audioData ? playerHeight : 0;
  // The dock rides above the open player on phones (it's full width there).
  const dockBottomPx = !isWide && isPlayerExpanded && shownPlayerHeight ? OPEN_PLAYER_EDGE_PX + shownPlayerHeight + DOCK_GAP_PX : FLOAT_EDGE_PX;
  const playerTopPx = shownPlayerHeight ? (isPlayerExpanded ? OPEN_PLAYER_EDGE_PX : FLOAT_EDGE_PX) + shownPlayerHeight : 0;
  // How much of the bottom of the screen floating controls can cover.
  const floatingReservePx = Math.max(playerTopPx, dockBottomPx + DOCK_HEIGHT_PX) + CONTENT_CLEARANCE_PX;
  const floatingReserveRef = useRef(floatingReservePx);
  useEffect(() => {
    floatingReserveRef.current = floatingReservePx;
  }, [floatingReservePx]);
  // A popup's top: below its anchor if it fits above the floating
  // controls, otherwise above the anchor, always on screen.
  const placeNear = (options) => placeAbove(floatingReserveRef.current, options);
  // The chapter on screen, as state (currentChapterIndexRef below is the
  // same value for callbacks) so the audiobook player can follow it.
  const [visibleChapterIndex, setVisibleChapterIndex] = useState(0);
  // Published AI translations: the languages with at least one published
  // chapter, the reader's preferred one (remembered per device), and the
  // loaded translation ({ language, chapters }) while reading one. `book`
  // always stays the original: the audiobook player and saved progress use
  // it; what's on screen comes from readingBook below.
  const [translationLanguages, setTranslationLanguages] = useState([]);
  const [readingLanguage, setReadingLanguageState] = useState(getReadingLanguage);
  const [translation, setTranslation] = useState(null);
  // Highlights, notes and bookmarks (private to this reader, synced with
  // the server). The selection toolbar replaces the old auto-opening word
  // explanation popup: "Explain" is one of its buttons.
  const annotationsApi = useAnnotations(bookId);
  const [selectionToolbar, setSelectionToolbar] = useState(null);
  const [activeHighlight, setActiveHighlight] = useState(null); // { id, position, focusNote }
  const [isAnnotationsOpen, setIsAnnotationsOpen] = useState(false);
  // Where the current chapter's highlights were found in the rendered text:
  // { chapterKey, byId: { [id]: resolveAnchor result } }.
  const [resolvedHighlights, setResolvedHighlights] = useState({ chapterKey: "", byId: {} });
  const [pendingJump, setPendingJump] = useState(null); // { chapterId, paragraphIndex, highlightId }
  // The rendered chapter content element (state, so effects re-run when
  // ViewBook swaps chapters).
  const [contentContainerEl, setContentContainerEl] = useState(null);
  const audiobookPlayerRef = useRef(null);
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
  const setContentContainer = useCallback((element) => {
    contentContainerRef.current = element;
    setContentContainerEl(element);
  }, []);

  // TEMPORARY — Android Listen Mode / word-popup debugging (remove once
  // diagnosed). Loads Eruda (an on-screen mobile debug console) ONLY when
  // ?debug=1 is present in the URL, so ordinary readers never load or pay
  // for this third-party script. Not a real access-control boundary — it's
  // a public query param anyone could type, not a secret — so this should
  // come out again once the real device debugging session is done, same as
  // the [ListenMode] console logging it's meant to surface.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("debug") !== "1") return;
    if (document.getElementById("eruda-debug-script")) return; // already loaded
    const script = document.createElement("script");
    script.id = "eruda-debug-script";
    script.src = "https://cdn.jsdelivr.net/npm/eruda";
    script.onload = () => window.eruda?.init();
    document.body.appendChild(script);
  }, []);

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

  // The book as displayed: chapters with a published translation in the
  // chosen language get its title and text (and no recap, which is in the
  // original language); the rest stay original. Same chapters, same order,
  // so chapter indexes and progress line up either way.
  const readingBook = useMemo(() => {
    if (!book || !translation) return book;
    const translated = new Map(translation.chapters.map((chapter) => [chapter.chapterId, chapter]));
    return {
      ...book,
      chapters: book.chapters.map((chapter) => {
        const match = translated.get(String(chapter._id));
        return match
          ? { ...chapter, title: match.title || chapter.title, content: match.content, summary: "", isTranslated: true }
          : { ...chapter, isTranslated: false };
      }),
    };
  }, [book, translation]);
  const activeLanguage = translation?.language || null;
  // Listen Mode (device voice) only where the language config allows it.
  const isListenAvailable = !activeLanguage || activeLanguage.listenMode;

  // The language a chapter is shown in right now: its translation's code
  // if it's showing a published translation, else "original". Highlights
  // belong to that language only.
  const activeLanguageCode = activeLanguage?.code || "";
  const displayedChapters = useMemo(
    () =>
      (readingBook?.chapters || []).map((chapter, index) => ({
        _id: String(chapter._id),
        title: chapter.title,
        index,
        language: chapter.isTranslated && activeLanguageCode ? activeLanguageCode : "original",
        plainText: buildSpeechBlocks(chapter.content).spokenText,
      })),
    [readingBook, activeLanguageCode]
  );
  const currentDisplayed = displayedChapters[visibleChapterIndex] || null;
  const chapterKey = currentDisplayed ? `${currentDisplayed._id}|${currentDisplayed.language}` : "";
  const currentHighlights = useMemo(
    () =>
      currentDisplayed
        ? annotationsFor(annotationsApi.annotations, currentDisplayed._id, currentDisplayed.language).filter(
            (a) => a.type === "highlight"
          )
        : [],
    [annotationsApi.annotations, currentDisplayed]
  );
  const paintingSupported = supportsHighlightPainting();

  // Finds the current chapter's highlights in the rendered text and paints
  // them (CSS Custom Highlight API: no elements added, so neither React nor
  // Listen Mode is affected). Re-runs when the text is re-rendered.
  useEffect(() => {
    const container = contentContainerEl;
    if (!container || !currentDisplayed) return undefined;
    let frame = null;
    let lastResult = "";
    const paint = () => {
      // ViewBook reports a chapter change before it swaps the content in;
      // only paint once the DOM shows this chapter.
      if (container.getAttribute("data-chapter-id") !== currentDisplayed._id) return;
      const texts = [];
      const elements = new Map();
      container.querySelectorAll("[data-paragraph-index]").forEach((element) => {
        const index = paragraphIndexOf(element);
        texts[index] = element.textContent;
        elements.set(index, element);
      });
      const byId = {};
      const ranges = [];
      for (const highlight of currentHighlights) {
        const result = resolveAnchor(texts, highlight.anchor);
        byId[highlight._id] = result;
        if (result.status !== "ok") continue;
        const range = rangeFromOffsets(elements.get(result.paragraphIndex), result.start, result.end);
        if (range) ranges.push({ range, color: highlight.color });
      }
      paintHighlights(ranges);
      const serialized = JSON.stringify(byId);
      if (serialized !== lastResult) {
        lastResult = serialized;
        setResolvedHighlights({ chapterKey, byId });
      }
    };
    // A zero-delay timer (not requestAnimationFrame, which browsers pause in
    // background tabs) coalesces bursts of DOM changes into one repaint.
    const schedule = () => {
      clearTimeout(frame);
      frame = setTimeout(paint, 0);
    };
    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(container, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["data-chapter-id"] });
    return () => {
      clearTimeout(frame);
      observer.disconnect();
    };
  }, [contentContainerEl, currentDisplayed, currentHighlights, chapterKey]);

  // Highlights are painted in a page-wide registry: clear them on leaving.
  useEffect(() => clearHighlights, []);

  const listenMode = useListenMode({
    language: activeLanguage?.speechLang || "en",
    onChapterEnd: () => {
      if (!isListenModeOn) return;
      const chapters = readingBook?.chapters || [];
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
    const chapter = readingBook?.chapters?.[index];
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
      // Never two voices at once.
      audiobookPlayerRef.current?.pause();
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

  // Switching language: remembered for this device; Listen Mode stops (the
  // text it was reading changed). The chosen translation loads below.
  const handleLanguageChange = (code) => {
    setReadingLanguage(code);
    setReadingLanguageState(code);
    setTranslation(null);
    if (isListenModeOn) {
      setIsListenModeOn(false);
      listenMode.stop();
    }
  };

  // Loads the preferred language's translation once we know the book has
  // one published (otherwise the original is shown).
  const isPreferredLanguagePublished = translationLanguages.some((language) => language.code === readingLanguage);
  useEffect(() => {
    if (!isPreferredLanguagePublished) return undefined;
    let cancelled = false;
    axiosInstance
      .get(API_PATHS.KENLIBS.READ_TRANSLATION(bookId, readingLanguage))
      .then((res) => !cancelled && setTranslation(res.data))
      .catch(() => {
        if (cancelled) return;
        setTranslation(null);
        toast.error("Couldn't load the translation. Showing the original.");
      });
    return () => {
      cancelled = true;
    };
  }, [bookId, readingLanguage, isPreferredLanguagePublished]);

  // Audiobook player hooks. The player and Listen Mode never play together:
  // starting one stops the other.
  const refreshAudio = useCallback(
    () => axiosInstance.get(API_PATHS.KENLIBS.AUDIO(bookId)).then((res) => res.data),
    [bookId]
  );

  const handleAudiobookPlaybackStart = () => {
    if (isListenModeOn) {
      setIsListenModeOn(false);
      listenMode.stop();
    }
  };

  // Offered by the player for a chapter that has no narration.
  const handleUseListenModeForChapter = (index) => {
    if (currentChapterIndexRef.current !== index) {
      viewBookRef.current?.goToChapter(index);
    }
    currentChapterIndexRef.current = index;
    resumeBlockIndexRef.current = 0;
    setIsListenModeOn(true);
    speakChapter(index);
  };

  // Step 36: fires on mouseup inside the chapter content container — the
  // only reliable "selection settled" moment, and (per Step 19's toolbar
  // precedent) also the moment a double-click's browser-native word
  // selection has already landed, so no separate dblclick handler is
  // needed. A plain click with no drag collapses the selection, which
  // clears any open popup here; WordExplainPopup's own click-away listener
  // covers dismissing it from clicks that land outside the content area
  // entirely (e.g. the notepad, the completion banner).
  //
  // Also invoked (with a delay) from touchend and from a debounced
  // 'selectionchange' listener below — mouseup never fires on a
  // touchscreen at all, so this is the only handler and both those extra
  // triggers just call it at moments better suited to touch. Dedupe below
  // stops those extra triggers from reopening/remounting the popup for a
  // selection this function has already handled.
  const lastHandledSelectionRef = useRef(null);
  const handleSelectionEnd = () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      lastHandledSelectionRef.current = null;
      setSelectionToolbar(null);
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
    if (!text) {
      lastHandledSelectionRef.current = null;
      setSelectionToolbar(null);
      return;
    }

    // getBoundingClientRect() is intentionally used here instead of any
    // mouse/touch event coordinate (e.g. e.clientX/Y vs.
    // touches[0].clientX/Y) — it comes from the Selection Range itself, so
    // positioning is correct regardless of what kind of pointer created the
    // selection, with no separate touch-coordinate handling needed.
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    const left = Math.min(
      Math.max(rect.left, 12),
      window.innerWidth - EXPLAIN_POPUP_WIDTH - 12
    );
    const top = placeAbove(floatingReserveRef.current, { below: rect.bottom + 10, above: rect.top - 10, height: EXPLAIN_POPUP_HEIGHT_ESTIMATE });

    // Highlights stay within one paragraph: a selection that runs on into
    // the next one is clipped to the end of the first.
    let anchor = null;
    let clipped = false;
    const startParagraph = paragraphElementOf(range.startContainer);
    if (startParagraph) {
      const paragraphText = startParagraph.textContent;
      const endParagraph = paragraphElementOf(range.endContainer);
      clipped = endParagraph !== startParagraph;
      let start = offsetWithin(startParagraph, range.startContainer, range.startOffset);
      let end = clipped ? paragraphText.length : offsetWithin(startParagraph, range.endContainer, range.endOffset);
      while (start < end && /\s/.test(paragraphText[start])) start++;
      while (end > start && /\s/.test(paragraphText[end - 1])) end--;
      if (end > start) anchor = { paragraphIndex: paragraphIndexOf(startParagraph), start, end };
    }
    const toolbarPosition = {
      top: placeAbove(floatingReserveRef.current, { below: rect.bottom + 10, above: rect.top - 10, height: 52 }),
      left: Math.min(Math.max(rect.left, 12), window.innerWidth - TOOLBAR_WIDTH - 12),
    };

    // A touchend-triggered call and the selectionchange debounce below can
    // both end up re-observing the exact same already-handled selection —
    // skip re-opening/remounting WordExplainPopup (and re-running its
    // dictionary lookup) when nothing actually changed.
    const dedupeKey = `${text}|${Math.round(top)}|${Math.round(left)}`;
    if (lastHandledSelectionRef.current === dedupeKey) return;
    lastHandledSelectionRef.current = dedupeKey;

    if (clipped) {
      toast("Highlights stay within one paragraph, so only the first paragraph of your selection will be highlighted.", {
        id: "highlight-one-paragraph",
      });
    }
    const canExplain = text.length <= EXPLAIN_SELECTION_MAX_LENGTH;

    setExplainSelection(null);
    setActiveHighlight(null);
    setSelectionToolbar({
      key: `${text}-${Date.now()}`,
      text,
      anchor,
      canExplain,
      sentence: canExplain ? extractSentenceContext(range, text) : "",
      position: toolbarPosition,
      explainPosition: { top, left },
    });
  };

  // --- Highlights, notes and bookmarks -----------------------------------

  const chapterShownAt = (index) => readingBook?.chapters?.[index] || null;
  const languageOfChapter = (chapter) =>
    chapter?.isTranslated && activeLanguageCode ? activeLanguageCode : "original";

  // Opens below the tap, or above it when there isn't room below without
  // landing on the floating controls (see floatingReserveRef).
  const popoverPositionAt = (x, y) => ({
    top: placeNear({ below: y + 16, above: y - 16, height: 260 }),
    left: Math.min(Math.max(x - POPOVER_WIDTH / 2, 12), window.innerWidth - POPOVER_WIDTH - 12),
  });

  const closeSelectionToolbar = () => {
    setSelectionToolbar(null);
    lastHandledSelectionRef.current = null;
  };

  const handleCreateHighlight = async (color, { withNote = false } = {}) => {
    const toolbar = selectionToolbar;
    const chapter = chapterShownAt(currentChapterIndexRef.current);
    const paragraph = toolbar?.anchor
      ? contentContainerRef.current?.querySelector(`[data-paragraph-index="${toolbar.anchor.paragraphIndex}"]`)
      : null;
    if (!toolbar?.anchor || !chapter || !paragraph) return;
    const anchor = createAnchor(paragraph.textContent, toolbar.anchor.paragraphIndex, toolbar.anchor.start, toolbar.anchor.end);
    closeSelectionToolbar();
    window.getSelection()?.removeAllRanges();
    const created = await annotationsApi.create({
      type: "highlight",
      chapterId: String(chapter._id),
      language: languageOfChapter(chapter),
      color,
      anchor,
    });
    if (created && withNote) {
      setActiveHighlight({
        id: created._id,
        position: popoverPositionAt(toolbar.position.left + TOOLBAR_WIDTH / 2, toolbar.position.top - 16),
        focusNote: true,
      });
    }
  };

  const handleCopySelection = () => {
    const text = selectionToolbar?.text || "";
    closeSelectionToolbar();
    navigator.clipboard
      ?.writeText(text)
      .then(() => toast.success("Copied."))
      .catch(() => toast.error("Couldn't copy. Use your device's copy instead."));
  };

  const handleExplainSelection = () => {
    const toolbar = selectionToolbar;
    if (!toolbar?.canExplain) return;
    closeSelectionToolbar();
    setExplainSelection({
      key: toolbar.key,
      word: toolbar.text,
      sentence: toolbar.sentence,
      position: toolbar.explainPosition,
    });
  };

  // Tapping (or clicking) highlighted text opens its popover.
  const handleContentClick = (e) => {
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    if (!currentHighlights.length || resolvedHighlights.chapterKey !== chapterKey) return;
    const caret = caretAtPoint(e.clientX, e.clientY);
    if (!caret) return;
    const paragraphIndex = paragraphIndexOf(caret.paragraph);
    const hit = currentHighlights.find((highlight) => {
      const result = resolvedHighlights.byId[highlight._id];
      return result?.status === "ok" && result.paragraphIndex === paragraphIndex && caret.offset >= result.start && caret.offset < result.end;
    });
    if (hit) setActiveHighlight({ id: hit._id, position: popoverPositionAt(e.clientX, e.clientY), focusNote: false });
  };

  // The paragraph at the top of the screen, for "bookmark this spot".
  const spotParagraphIndex = () => {
    const paragraphs = contentContainerRef.current?.querySelectorAll("[data-paragraph-index]") || [];
    for (const element of paragraphs) {
      if (element.getBoundingClientRect().bottom > 96) return paragraphIndexOf(element);
    }
    return null;
  };

  const handleSaveBookmark = async (chapter, { paragraphIndex, label }) => {
    const paragraph =
      paragraphIndex === null
        ? null
        : contentContainerRef.current?.querySelector(`[data-paragraph-index="${paragraphIndex}"]`);
    const created = await annotationsApi.create({
      type: "bookmark",
      chapterId: String(chapter._id),
      language: languageOfChapter(chapter),
      label,
      anchor: { paragraphIndex, quote: paragraph ? paragraph.textContent.trim().slice(0, 200) : "" },
    });
    if (created) toast.success("Bookmarked.");
    return Boolean(created);
  };

  // Highlights in the current chapter are checked exactly against the
  // rendered text; other chapters with a quick text search.
  const highlightStatus = (annotation) => {
    if (resolvedHighlights.chapterKey === `${annotation.chapterId}|${annotation.language}`) {
      const result = resolvedHighlights.byId[annotation._id];
      if (result) return result.status;
    }
    const chapter = displayedChapters.find((c) => c._id === annotation.chapterId);
    return chapter && quoteStillPresent(chapter.plainText, annotation.anchor.quote) ? "ok" : "changed";
  };

  const handleJump = (annotation) => {
    const index = displayedChapters.findIndex((c) => c._id === annotation.chapterId);
    if (index < 0) return;
    setIsAnnotationsOpen(false);
    setPendingJump({
      chapterId: annotation.chapterId,
      paragraphIndex: annotation.anchor.paragraphIndex,
      highlightId: annotation.type === "highlight" ? annotation._id : null,
    });
    if (index !== currentChapterIndexRef.current) viewBookRef.current?.goToChapter(index);
  };

  // Android/iOS finalize touch text-selection (the long-press + drag-handle
  // UI) slightly AFTER touchend fires — reading window.getSelection()
  // synchronously inside the touchend handler itself often sees a stale or
  // still-collapsed selection. A short delay lets it settle first.
  const touchSelectionTimeoutRef = useRef(null);
  const handleTouchSelectionEnd = () => {
    if (touchSelectionTimeoutRef.current) clearTimeout(touchSelectionTimeoutRef.current);
    touchSelectionTimeoutRef.current = setTimeout(handleSelectionEnd, 250);
  };

  useEffect(() => {
    return () => {
      if (touchSelectionTimeoutRef.current) clearTimeout(touchSelectionTimeoutRef.current);
    };
  }, []);

  // touchend alone isn't sufficient on its own: once the native selection
  // handles appear, dragging one to adjust the selection is handled entirely
  // inside the browser's own selection UI — it never dispatches a further
  // touchend to this container — but it does keep firing 'selectionchange'
  // on the document the whole time. Debounced (rather than acted on
  // immediately) since it can fire on every pixel of handle movement;
  // scoped to touch-capable devices only so it never runs a second,
  // redundant check after every ordinary desktop mouse-drag selection
  // (already handled instantly by onMouseUp above).
  useEffect(() => {
    const isTouchCapable =
      typeof window !== "undefined" && ("ontouchstart" in window || navigator.maxTouchPoints > 0);
    if (!isTouchCapable) return;

    let debounceId = null;
    const onSelectionChange = () => {
      if (debounceId) clearTimeout(debounceId);
      debounceId = setTimeout(handleSelectionEnd, 300);
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      if (debounceId) clearTimeout(debounceId);
    };
  }, []);

  // Scrolls to a jumped-to highlight or bookmark once its chapter is on
  // screen (and, for a highlight, once it's been found in the text).
  useEffect(() => {
    if (!pendingJump || !contentContainerEl || currentDisplayed?._id !== pendingJump.chapterId) return undefined;
    if (contentContainerEl.getAttribute("data-chapter-id") !== pendingJump.chapterId) return undefined;
    let paragraphIndex = pendingJump.paragraphIndex;
    if (pendingJump.highlightId) {
      if (resolvedHighlights.chapterKey !== chapterKey) return undefined;
      const result = resolvedHighlights.byId[pendingJump.highlightId];
      if (result?.status === "ok") paragraphIndex = result.paragraphIndex;
    }
    const timer = setTimeout(() => {
      const target =
        paragraphIndex === null || paragraphIndex === undefined
          ? contentContainerEl
          : contentContainerEl.querySelector(`[data-paragraph-index="${paragraphIndex}"]`) || contentContainerEl;
      target.scrollIntoView({ behavior: "smooth", block: target === contentContainerEl ? "start" : "center" });
      setPendingJump(null);
    }, 120);
    return () => clearTimeout(timer);
  }, [pendingJump, contentContainerEl, currentDisplayed, resolvedHighlights, chapterKey]);

  const renderChapterContent = (chapter, chapterIndex, fontSize) => {
    const { blocks, renderBlocks } = buildSpeechBlocks(chapter.content);
    const chapterBookmarks = annotationsApi.annotations.filter(
      (a) => a.type === "bookmark" && a.chapterId === String(chapter._id)
    ).length;
    const isFinalChapter = chapterIndex === (book?.chapters?.length ?? 0) - 1;

    const body = (
      <>
      {activeLanguage && (
        <TranslationNotice
          chapter={chapter}
          language={activeLanguage}
          hasAudio={Boolean(audioData)}
          isListenAvailable={isListenAvailable}
        />
      )}
      <BookmarkButton
        key={`bookmark-${chapter._id || chapterIndex}`}
        count={chapterBookmarks}
        disabled={annotationsApi.status !== "ready"}
        getSpotParagraph={spotParagraphIndex}
        onSave={(bookmark) => handleSaveBookmark(chapter, bookmark)}
      />
      <ChapterRecap key={chapter._id || chapterIndex} summary={chapter.summary} />
      <div
        ref={setContentContainer}
        data-chapter-id={String(chapter._id)}
        onMouseUp={handleSelectionEnd}
        onTouchEnd={handleTouchSelectionEnd}
        onClick={handleContentClick}
      >
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
            {/* Every block, in order. Spoken blocks keep their Listen Mode
                index (blockIndex), which is also the highlight paragraph
                index; images and rules render between them unnumbered. */}
            {renderBlocks.map(({ markdown, blockIndex }, i) =>
              blockIndex === null ? (
                <div key={`static-${i}`} className="-mx-2 px-2">
                  <MDEditor.Markdown source={markdown} prefixCls="" style={{ background: "transparent" }} />
                </div>
              ) : (
                <div
                  key={`block-${blockIndex}`}
                  data-paragraph-index={blockIndex}
                  className={`listen-block rounded-lg -mx-2 px-2 transition-colors duration-300 ${
                    listenMode.activeBlockIndex === blockIndex ? "bg-accent-50" : ""
                  }`}
                >
                  <MDEditor.Markdown source={markdown} prefixCls="" style={{ background: "transparent" }} />
                </div>
              )
            )}
          </div>
        )}
      </div>
      </>
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
        setVisibleChapterIndex(resolvedInitialIndex);

        // Translations are optional too: any failure just means no
        // language selector.
        axiosInstance
          .get(API_PATHS.KENLIBS.TRANSLATIONS(bookId))
          .then((res) => setTranslationLanguages(res.data?.languages || []))
          .catch(() => setTranslationLanguages([]));

        // Narration is optional: 404 (no audio) or any failure just means
        // no player, never a broken reading page.
        axiosInstance
          .get(API_PATHS.KENLIBS.AUDIO(bookId))
          .then((res) => setAudioData(res.data?.chapters?.length ? res.data : null))
          .catch(() => setAudioData(null));

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
    setVisibleChapterIndex(index);

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
          book={readingBook}
          contentBottomInset={`calc(${floatingReservePx}px + env(safe-area-inset-bottom))`}
          backTo="/kenlibs/my-books"
          backLabel="My Books"
          animated
          initialChapterIndex={initialChapterIndex}
          onChapterChange={handleChapterChange}
          renderChapterContent={renderChapterContent}
          headerControls={
            <>
              <ReadingLanguageSelect
                compact
                languages={translationLanguages}
                value={isPreferredLanguagePublished ? readingLanguage : ""}
                onChange={handleLanguageChange}
              />
              <button
                type="button"
                onClick={() => setIsAnnotationsOpen(true)}
                className="relative w-9 h-9 rounded-xl flex items-center justify-center text-gray-600 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
                title="My highlights & notes"
                aria-label="My highlights and notes"
              >
                <Highlighter className="w-4 h-4" />
                {annotationsApi.annotations.length > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[1rem] h-4 px-1 rounded-full bg-accent text-white text-[10px] font-semibold leading-4 text-center">
                    {annotationsApi.annotations.length > 99 ? "99+" : annotationsApi.annotations.length}
                  </span>
                )}
              </button>
              {isListenAvailable && (
                <ListenModeControls
                  listenMode={listenMode}
                  isActive={isListenModeOn}
                  onToggle={handleToggleListenMode}
                  onReplay={() => speakChapter(currentChapterIndexRef.current)}
                />
              )}
            </>
          }
        />

        {audioData && (
          <Suspense fallback={null}>
            <AudiobookPlayer
              ref={audiobookPlayerRef}
              bookId={bookId}
              book={book}
              initialAudio={audioData}
              refreshAudio={refreshAudio}
              visibleChapterIndex={visibleChapterIndex}
              onNavigateToChapter={(index) => viewBookRef.current?.goToChapter(index)}
              onUseListenMode={handleUseListenModeForChapter}
              onPlaybackStart={handleAudiobookPlaybackStart}
              onExpandedChange={setIsPlayerExpanded}
              onHeightChange={setPlayerHeight}
            />
          </Suspense>
        )}

        {/* Floating button dock (see FLOAT_EDGE_PX above): WhatsApp support
            and the notepad toggle in one column, so they can't overlap each
            other, and ViewBook's contentBottomInset keeps the chapter's end
            clear of them. Rides above the open player on phones. */}
        <div
          className="fixed right-6 z-40 flex flex-col items-center gap-3"
          style={{ bottom: `calc(${dockBottomPx}px + env(safe-area-inset-bottom))` }}
        >
          <KenlibsWhatsAppButton docked />
          <motion.button
            onClick={() => setIsNotepadOpen((open) => !open)}
            whileTap={{ scale: 0.92 }}
            className="w-14 h-14 rounded-full bg-gradient-to-r from-accent to-accent-secondary text-white shadow-xl shadow-accent-500/30 flex items-center justify-center"
            title="My notes"
            aria-label="My notes"
          >
            <NotebookPen className="w-6 h-6" />
          </motion.button>
        </div>

        {/* Step 36: word/phrase explanation popup — anchored near the
            selection via inline position style, closed by setting
            explainSelection back to null (click-away/Escape are handled
            inside WordExplainPopup itself). Deliberately plain conditional
            rendering, not AnimatePresence — WordExplainPopup plays its own
            fade-out via a boolean + setTimeout before calling onClose (Step
            52 audit), so by the time this actually unmounts it, the
            component is already invisible; there's nothing left for
            AnimatePresence to coordinate. */}
        {selectionToolbar && (
          <SelectionToolbar
            key={selectionToolbar.key}
            position={selectionToolbar.position}
            canHighlight={Boolean(selectionToolbar.anchor) && annotationsApi.status === "ready"}
            canExplain={selectionToolbar.canExplain}
            onHighlight={(color) => handleCreateHighlight(color)}
            onNote={() => handleCreateHighlight("yellow", { withNote: true })}
            onCopy={handleCopySelection}
            onExplain={handleExplainSelection}
            onClose={closeSelectionToolbar}
          />
        )}

        {activeHighlight &&
          (() => {
            const highlight = annotationsApi.annotations.find((a) => a._id === activeHighlight.id);
            if (!highlight) return null;
            return (
              <HighlightPopover
                key={highlight._id}
                highlight={highlight}
                position={activeHighlight.position}
                focusNote={activeHighlight.focusNote}
                onChangeColor={(color) => annotationsApi.update(highlight._id, { color }, { immediate: true })}
                onChangeNote={(note) => annotationsApi.update(highlight._id, { note })}
                onDelete={() => {
                  setActiveHighlight(null);
                  annotationsApi.remove(highlight._id);
                }}
                onClose={() => setActiveHighlight(null)}
              />
            );
          })()}

        <AnnotationsPanel
          isOpen={isAnnotationsOpen}
          onClose={() => setIsAnnotationsOpen(false)}
          bookTitle={readingBook?.title || book?.title}
          chapters={displayedChapters}
          annotations={annotationsApi.annotations}
          loadStatus={annotationsApi.status}
          onRetry={annotationsApi.retry}
          statusOf={highlightStatus}
          paintingSupported={paintingSupported}
          onJump={handleJump}
          onUpdate={annotationsApi.update}
          onDelete={annotationsApi.remove}
        />

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

        {/* Always mounted, animated via `animate` only + `inert` when
            closed — not AnimatePresence-conditional mounting (Step 52 audit:
            framer-motion 13.1.0 + React 19 never fires AnimatePresence's
            exit-complete unmount here, so the exit animation finishes
            visually but the fixed inset-0/full-height overlay stays in the
            DOM, silently blocking every click on the page underneath it
            until a full reload — see DashboardLayout.jsx's original fix for
            the full story). */}
        <div className="fixed inset-0 z-40" inert={!isNotepadOpen}>
          <motion.div
            animate={{ opacity: isNotepadOpen ? 1 : 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-black/20"
            onClick={() => setIsNotepadOpen(false)}
          />
          <motion.div
            animate={{ x: isNotepadOpen ? 0 : "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 34 }}
            className="absolute top-0 right-0 h-full w-full sm:w-96 bg-white shadow-2xl z-50 flex flex-col"
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
        </div>
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
