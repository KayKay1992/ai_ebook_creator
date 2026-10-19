import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  Headphones,
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  ListMusic,
  ChevronDown,
  Loader2,
  Volume2,
  X,
} from "lucide-react";

// Audiobook player for KenlibsReadPage (lazy-loaded there, so it only
// downloads for books that have narration). Plays the AI narration from
// short-lived signed URLs (GET /api/kenlibs/audio/:bookId). When a URL has
// expired, or playback fails, it fetches fresh ones via `refreshAudio` and
// resumes at the same position.
//
// Position and speed are remembered per book in localStorage, by chapter
// id (so reordering chapters doesn't scramble them). The server-side reader
// progress stores a text-block index for Listen Mode, which doesn't map to
// a time in an audio file, so it isn't reused here.
//
// Media Session API: lock-screen and headphone controls (play/pause,
// skip 15s, previous/next chapter, scrubbing) on phones.

const SKIP_SECONDS = 15;
const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];
// Fetch fresh URLs before starting a chapter whose URL expires sooner than this.
const URL_REFRESH_MARGIN_MS = 2 * 60 * 1000;
const POSITION_SAVE_INTERVAL_MS = 5000;
// Resuming within this many seconds of the end restarts the chapter instead.
const RESUME_END_MARGIN_SEC = 5;

const storageKey = (bookId) => `kenlibs_audiobook_${bookId}`;

const readSaved = (bookId) => {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(bookId)) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const writeSaved = (bookId, update) => {
  try {
    const current = readSaved(bookId);
    const next = {
      ...current,
      ...update,
      positions: { ...(current.positions || {}), ...(update.positions || {}) },
    };
    localStorage.setItem(storageKey(bookId), JSON.stringify(next));
  } catch {
    /* storage unavailable (private mode, quota): positions just aren't remembered */
  }
};

const formatTime = (totalSec) => {
  if (!Number.isFinite(totalSec) || totalSec < 0) return "0:00";
  const sec = Math.floor(totalSec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
};

const absoluteImage = (url) => (url && /^https?:\/\//i.test(url) ? url : null);

const AudiobookPlayer = forwardRef(
  (
    {
      bookId,
      book,
      initialAudio,
      refreshAudio,
      visibleChapterIndex,
      onNavigateToChapter,
      onUseListenMode,
      onPlaybackStart,
      onExpandedChange,
      // Reports the on-screen height (px) of whichever form is showing (the
      // "Listen" pill or the open player), so the reader can keep its
      // floating buttons and the chapter's end clear of it.
      onHeightChange,
      // Open the full player straight away (the Library's "Listen" shortcut).
      // Playback still waits for a tap.
      initiallyExpanded = false,
    },
    ref
  ) => {
    const chapters = book?.chapters || [];
    const [tracks, setTracks] = useState(initialAudio.chapters);
    // The chapter loaded into the audio element. Until the reader presses
    // play, the player simply targets whatever chapter is on screen.
    const [loadedIndex, setLoadedIndex] = useState(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isBuffering, setIsBuffering] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [rate, setRate] = useState(() => {
      const saved = Number(readSaved(bookId).rate);
      return SPEEDS.includes(saved) ? saved : 1;
    });
    const [isExpanded, setIsExpanded] = useState(initiallyExpanded);
    const [isListOpen, setIsListOpen] = useState(false);
    const [errorMessage, setErrorMessage] = useState("");
    const [endedBook, setEndedBook] = useState(false);

    const audioRef = useRef(null);
    const tracksRef = useRef(tracks);
    const loadedIndexRef = useRef(null);
    const pendingSeekRef = useRef(0);
    const autoplayRef = useRef(false);
    const retryCountRef = useRef(0);
    const lastSaveRef = useRef(0);
    const lastKnownTimeRef = useRef(0);
    const wantsPlayRef = useRef(false);
    // False while a chapter is loading: the element's time is meaningless
    // until the new file's metadata is in and the resume seek applied.
    const positionValidRef = useRef(false);

    const targetIndex = loadedIndex ?? visibleChapterIndex ?? 0;
    const trackFor = useCallback(
      (index) => tracksRef.current.find((t) => t.chapterIndex === index) || null,
      []
    );
    const targetTrack = tracks.find((t) => t.chapterIndex === targetIndex) || null;
    const targetChapter = chapters[targetIndex];

    const setExpanded = (value) => {
      setIsExpanded(value);
      onExpandedChange?.(value);
    };
    // The page sizes its floating controls around the open player.
    useEffect(() => {
      if (initiallyExpanded) onExpandedChange?.(true);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // The fixed element on screen (pill or open player), measured as it
    // changes size (chapter list opened, error shown, …).
    const [floatingEl, setFloatingEl] = useState(null);
    const onHeightChangeRef = useRef(onHeightChange);
    useEffect(() => {
      onHeightChangeRef.current = onHeightChange;
    }, [onHeightChange]);
    useEffect(() => {
      if (!floatingEl) return undefined;
      const report = () => onHeightChangeRef.current?.(Math.ceil(floatingEl.getBoundingClientRect().height));
      report();
      if (typeof ResizeObserver === "undefined") return undefined;
      const observer = new ResizeObserver(report);
      observer.observe(floatingEl);
      return () => observer.disconnect();
    }, [floatingEl]);

    const savePosition = useCallback(
      (force = false) => {
        const audio = audioRef.current;
        const index = loadedIndexRef.current;
        if (!audio || index === null || !positionValidRef.current) return;
        const now = Date.now();
        if (!force && now - lastSaveRef.current < POSITION_SAVE_INTERVAL_MS) return;
        lastSaveRef.current = now;
        const track = tracksRef.current.find((t) => t.chapterIndex === index);
        if (!track) return;
        writeSaved(bookId, {
          lastChapterId: track.chapterId,
          positions: { [track.chapterId]: Math.floor(audio.currentTime || 0) },
        });
      },
      [bookId]
    );

    const refreshTracks = useCallback(async () => {
      const fresh = await refreshAudio();
      tracksRef.current = fresh.chapters;
      setTracks(fresh.chapters);
      return fresh.chapters;
    }, [refreshAudio]);

    // Loads a chapter into the audio element. startAt: seconds (defaults to
    // the remembered position); autoplay: start playing once loaded.
    const loadChapter = useCallback(
      async (index, { startAt, autoplay = true } = {}) => {
        const audio = audioRef.current;
        if (!audio) return;
        savePosition(true);
        positionValidRef.current = false;
        setErrorMessage("");
        setEndedBook(false);
        loadedIndexRef.current = index;
        setLoadedIndex(index);

        let track = trackFor(index);
        if (!track) {
          // No narration for this chapter: stop, and let the UI offer
          // the device voice instead.
          audio.pause();
          audio.removeAttribute("src");
          audio.load();
          setIsPlaying(false);
          setCurrentTime(0);
          setDuration(0);
          return;
        }

        if (new Date(track.expiresAt).getTime() - Date.now() < URL_REFRESH_MARGIN_MS) {
          try {
            track = (await refreshTracks()).find((t) => t.chapterIndex === index) || null;
          } catch {
            /* try the old URL anyway; the error handler retries */
          }
          if (!track || loadedIndexRef.current !== index) return;
        }

        const saved = readSaved(bookId).positions?.[track.chapterId] || 0;
        const resumeAt = startAt ?? (saved < (track.durationSec || Infinity) - RESUME_END_MARGIN_SEC ? saved : 0);
        pendingSeekRef.current = resumeAt;
        lastKnownTimeRef.current = resumeAt;
        autoplayRef.current = autoplay;
        wantsPlayRef.current = autoplay;
        retryCountRef.current = 0;
        setCurrentTime(resumeAt);
        setDuration(track.durationSec || 0);
        setIsBuffering(autoplay);
        audio.src = track.url;
        audio.load();
      },
      [bookId, refreshTracks, savePosition, trackFor]
    );

    const play = useCallback(async () => {
      const audio = audioRef.current;
      if (!audio) return;
      if (loadedIndexRef.current === null || !audio.getAttribute("src")) {
        await loadChapter(targetIndex, { autoplay: true });
        return;
      }
      wantsPlayRef.current = true;
      try {
        await audio.play();
      } catch {
        /* the error/pause handlers report problems */
      }
    }, [loadChapter, targetIndex]);

    const pause = useCallback(() => {
      wantsPlayRef.current = false;
      audioRef.current?.pause();
      savePosition(true);
    }, [savePosition]);

    const seekBy = useCallback((delta) => {
      const audio = audioRef.current;
      if (!audio || !audio.getAttribute("src")) return;
      const max = Number.isFinite(audio.duration) ? audio.duration : Infinity;
      audio.currentTime = Math.min(Math.max(0, audio.currentTime + delta), max);
    }, []);

    const goToChapter = useCallback(
      (index, { autoplay = true } = {}) => {
        if (index < 0 || index >= chapters.length) return;
        onNavigateToChapter?.(index);
        loadChapter(index, { autoplay });
      },
      [chapters.length, loadChapter, onNavigateToChapter]
    );

    useImperativeHandle(ref, () => ({ pause }), [pause]);

    // Audio element events.
    useEffect(() => {
      const audio = audioRef.current;
      if (!audio) return undefined;

      const onLoadedMetadata = () => {
        if (Number.isFinite(audio.duration)) setDuration(audio.duration);
        if (pendingSeekRef.current) {
          audio.currentTime = Math.min(pendingSeekRef.current, audio.duration || pendingSeekRef.current);
          pendingSeekRef.current = 0;
        }
        positionValidRef.current = true;
        audio.playbackRate = rateRef.current;
        if (autoplayRef.current) {
          autoplayRef.current = false;
          audio.play().catch(() => setIsBuffering(false));
        }
      };
      const onPlay = () => {
        setIsPlaying(true);
        onPlaybackStartRef.current?.();
      };
      const onPause = () => {
        setIsPlaying(false);
        setIsBuffering(false);
        savePosition(true);
      };
      const onTimeUpdate = () => {
        if (!positionValidRef.current) return; // mid-load: keep showing the resume point
        lastKnownTimeRef.current = audio.currentTime;
        setCurrentTime(audio.currentTime);
        savePosition(false);
      };
      const onWaiting = () => setIsBuffering(true);
      const onPlaying = () => {
        setIsBuffering(false);
        retryCountRef.current = 0;
      };
      const onEnded = () => {
        const index = loadedIndexRef.current;
        const track = tracksRef.current.find((t) => t.chapterIndex === index);
        if (track) writeSaved(bookId, { positions: { [track.chapterId]: 0 } });
        const next = index + 1;
        if (next >= chapterCountRef.current) {
          setIsPlaying(false);
          setEndedBook(true);
          return;
        }
        // Auto-advance (also when the next chapter has no audio: the UI
        // then shows the device-voice option for it).
        navigateRef.current?.(next);
        loadChapterRef.current(next, { autoplay: true, startAt: 0 });
      };
      const onError = async () => {
        if (!audio.getAttribute("src")) return;
        const index = loadedIndexRef.current;
        // Most likely an expired signed URL: fetch fresh ones once and
        // resume where playback stopped.
        if (retryCountRef.current < 1 && index !== null) {
          retryCountRef.current += 1;
          const resumeAt = lastKnownTimeRef.current;
          const shouldPlay = wantsPlayRef.current;
          try {
            const fresh = await refreshTracksRef.current();
            const track = fresh.find((t) => t.chapterIndex === index);
            if (track && loadedIndexRef.current === index) {
              positionValidRef.current = false;
              pendingSeekRef.current = resumeAt;
              autoplayRef.current = shouldPlay;
              audio.src = track.url;
              audio.load();
              return;
            }
          } catch {
            /* fall through to the message below */
          }
        }
        setIsPlaying(false);
        setIsBuffering(false);
        setErrorMessage("Couldn't play this chapter. Check your connection and try again.");
      };

      audio.addEventListener("loadedmetadata", onLoadedMetadata);
      audio.addEventListener("play", onPlay);
      audio.addEventListener("pause", onPause);
      audio.addEventListener("timeupdate", onTimeUpdate);
      audio.addEventListener("waiting", onWaiting);
      audio.addEventListener("playing", onPlaying);
      audio.addEventListener("ended", onEnded);
      audio.addEventListener("error", onError);
      return () => {
        audio.removeEventListener("loadedmetadata", onLoadedMetadata);
        audio.removeEventListener("play", onPlay);
        audio.removeEventListener("pause", onPause);
        audio.removeEventListener("timeupdate", onTimeUpdate);
        audio.removeEventListener("waiting", onWaiting);
        audio.removeEventListener("playing", onPlaying);
        audio.removeEventListener("ended", onEnded);
        audio.removeEventListener("error", onError);
      };
    }, [bookId, savePosition]);

    // Latest values for the long-lived listeners above.
    const rateRef = useRef(rate);
    const chapterCountRef = useRef(chapters.length);
    const navigateRef = useRef(onNavigateToChapter);
    const loadChapterRef = useRef(loadChapter);
    const refreshTracksRef = useRef(refreshTracks);
    const onPlaybackStartRef = useRef(onPlaybackStart);
    useEffect(() => {
      rateRef.current = rate;
      chapterCountRef.current = chapters.length;
      navigateRef.current = onNavigateToChapter;
      loadChapterRef.current = loadChapter;
      refreshTracksRef.current = refreshTracks;
      onPlaybackStartRef.current = onPlaybackStart;
      tracksRef.current = tracks;
    });

    // Playback speed.
    useEffect(() => {
      if (audioRef.current) audioRef.current.playbackRate = rate;
      writeSaved(bookId, { rate });
    }, [rate, bookId]);

    // Save the position when the page is hidden or closed, and on unmount.
    useEffect(() => {
      const audio = audioRef.current;
      const flush = () => savePosition(true);
      window.addEventListener("pagehide", flush);
      document.addEventListener("visibilitychange", flush);
      return () => {
        flush();
        window.removeEventListener("pagehide", flush);
        document.removeEventListener("visibilitychange", flush);
        audio?.pause();
      };
    }, [savePosition]);

    // Media Session: metadata for the lock screen / notification.
    const loadedTrack = loadedIndex === null ? null : tracks.find((t) => t.chapterIndex === loadedIndex);
    useEffect(() => {
      if (!("mediaSession" in navigator) || !loadedTrack) return;
      const cover = absoluteImage(book?.coverDesign?.front?.backgroundImage) || absoluteImage(book?.coverImage);
      try {
        navigator.mediaSession.metadata = new window.MediaMetadata({
          title: loadedTrack.title || book?.title || "Audiobook",
          artist: book?.author || "",
          album: book?.title || "",
          artwork: cover ? [{ src: cover, sizes: "512x512" }] : [],
        });
      } catch {
        /* MediaMetadata unsupported */
      }
    }, [loadedTrack, book]);

    // Media Session: action handlers (headphones, lock screen, car).
    useEffect(() => {
      if (!("mediaSession" in navigator)) return undefined;
      const session = navigator.mediaSession;
      const handlers = {
        play: () => play(),
        pause: () => pause(),
        seekbackward: (details) => seekBy(-(details?.seekOffset || SKIP_SECONDS)),
        seekforward: (details) => seekBy(details?.seekOffset || SKIP_SECONDS),
        seekto: (details) => {
          if (audioRef.current && Number.isFinite(details?.seekTime)) audioRef.current.currentTime = details.seekTime;
        },
        previoustrack: () => goToChapter(Math.max(0, (loadedIndexRef.current ?? targetIndex) - 1)),
        nexttrack: () => goToChapter((loadedIndexRef.current ?? targetIndex) + 1),
      };
      Object.entries(handlers).forEach(([action, handler]) => {
        try {
          session.setActionHandler(action, handler);
        } catch {
          /* action not supported on this browser */
        }
      });
      return () => {
        Object.keys(handlers).forEach((action) => {
          try {
            session.setActionHandler(action, null);
          } catch {
            /* ignore */
          }
        });
      };
    }, [play, pause, seekBy, goToChapter, targetIndex]);

    // Media Session: playback state and position for the lock-screen scrubber.
    useEffect(() => {
      if (!("mediaSession" in navigator)) return;
      navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
      if (duration > 0 && navigator.mediaSession.setPositionState) {
        try {
          navigator.mediaSession.setPositionState({
            duration,
            playbackRate: rate,
            position: Math.min(currentTime, duration),
          });
        } catch {
          /* invalid state mid-load */
        }
      }
    }, [isPlaying, duration, rate, currentTime]);

    const hasAudioForTarget = Boolean(targetTrack);
    const showSwitchHint =
      loadedIndex !== null &&
      visibleChapterIndex !== loadedIndex &&
      !isPlaying &&
      tracks.some((t) => t.chapterIndex === visibleChapterIndex);

    return (
      <>
        {/* No crossOrigin attribute on purpose: playback needs no CORS, and
            the service worker never caches audio (see vite.config.js). */}
        <audio ref={audioRef} preload="metadata" />

        {!isExpanded ? (
          <button
            ref={setFloatingEl}
            onClick={() => setExpanded(true)}
            className="fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] left-6 z-40 flex items-center gap-2 h-14 pl-4 pr-5 rounded-full bg-gray-900 text-white shadow-xl shadow-black/20"
            aria-label="Open audiobook player"
          >
            {isPlaying ? <Volume2 className="w-5 h-5 animate-pulse" /> : <Headphones className="w-5 h-5" />}
            <span className="text-sm font-semibold">
              {isPlaying ? `${formatTime(currentTime)} / ${formatTime(duration)}` : "Listen"}
            </span>
          </button>
        ) : (
          <div
            ref={setFloatingEl}
            className="fixed z-40 bottom-[calc(1rem+env(safe-area-inset-bottom))] left-4 right-4 sm:right-auto sm:w-[400px] bg-white rounded-3xl shadow-2xl shadow-black/20 border border-gray-100 overflow-hidden"
            role="region"
            aria-label="Audiobook player"
          >
            {isListOpen && (
              <ul className="max-h-[40vh] overflow-y-auto border-b border-gray-100 py-2">
                {chapters.map((chapter, index) => {
                  const track = tracks.find((t) => t.chapterIndex === index);
                  const isCurrent = index === targetIndex;
                  return (
                    <li key={chapter._id || index}>
                      <button
                        onClick={() => {
                          setIsListOpen(false);
                          goToChapter(index, { autoplay: Boolean(track) });
                        }}
                        className={`w-full flex items-center justify-between gap-3 px-5 py-2 text-left text-sm ${
                          isCurrent ? "bg-accent-50 text-accent-hover font-semibold" : "text-gray-700 hover:bg-gray-50"
                        }`}
                      >
                        <span className="truncate">
                          {index + 1}. {chapter.title}
                        </span>
                        <span className={`text-xs whitespace-nowrap ${track ? "text-gray-400" : "text-gray-300"}`}>
                          {track ? formatTime(track.durationSec) : "No narration"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="px-5 pt-4 pb-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-accent flex items-center gap-1">
                    <Headphones className="w-3.5 h-3.5" /> Audiobook
                  </p>
                  <p className="text-sm font-semibold text-gray-900 truncate mt-0.5">
                    {targetIndex + 1}. {targetChapter?.title || "Chapter"}
                  </p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => setIsListOpen((open) => !open)}
                    className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                      isListOpen ? "bg-gray-100 text-gray-900" : "text-gray-500 hover:bg-gray-100"
                    }`}
                    aria-label="Chapters"
                    aria-expanded={isListOpen}
                  >
                    <ListMusic className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => {
                      setIsListOpen(false);
                      setExpanded(false);
                    }}
                    className="w-9 h-9 rounded-xl flex items-center justify-center text-gray-500 hover:bg-gray-100"
                    aria-label="Minimize player"
                  >
                    <ChevronDown className="w-4 h-4" />
                  </button>
                  {!isPlaying && (
                    <button
                      onClick={() => {
                        pause();
                        setIsListOpen(false);
                        setExpanded(false);
                      }}
                      className="w-9 h-9 rounded-xl flex items-center justify-center text-gray-400 hover:bg-gray-100"
                      aria-label="Close player"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {hasAudioForTarget ? (
                <>
                  <div className="mt-2">
                    {/* Themed slider (.kenlibs-range in theme-dark.css): the
                        played part fills up to --progress. */}
                    <input
                      type="range"
                      min={0}
                      max={duration || targetTrack.durationSec || 0}
                      step={1}
                      value={Math.min(currentTime, duration || targetTrack.durationSec || 0)}
                      style={{
                        "--progress": `${(duration || targetTrack.durationSec) > 0 ? (Math.min(currentTime, duration || targetTrack.durationSec) / (duration || targetTrack.durationSec)) * 100 : 0}%`,
                      }}
                      aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration || targetTrack.durationSec || 0)}`}
                      onChange={(e) => {
                        const value = Number(e.target.value);
                        setCurrentTime(value);
                        if (audioRef.current?.getAttribute("src") && loadedIndex === targetIndex) {
                          audioRef.current.currentTime = value;
                        } else {
                          loadChapter(targetIndex, { startAt: value, autoplay: false });
                        }
                      }}
                      className="kenlibs-range"
                      aria-label="Seek"
                    />
                    <div className="flex justify-between text-xs text-gray-400 tabular-nums">
                      <span>{formatTime(currentTime)}</span>
                      <span>-{formatTime(Math.max(0, (duration || targetTrack.durationSec || 0) - currentTime))}</span>
                    </div>
                  </div>

                  <div className="mt-2 flex items-center justify-between">
                    <select
                      value={rate}
                      onChange={(e) => setRate(Number(e.target.value))}
                      className="text-sm font-semibold text-gray-700 bg-gray-100 rounded-xl px-2 py-1.5 focus:outline-none"
                      aria-label="Playback speed"
                    >
                      {SPEEDS.map((speed) => (
                        <option key={speed} value={speed}>
                          {speed}x
                        </option>
                      ))}
                    </select>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => seekBy(-SKIP_SECONDS)}
                        className="w-11 h-11 rounded-full flex items-center justify-center text-gray-700 hover:bg-gray-100 relative"
                        aria-label="Back 15 seconds"
                      >
                        <RotateCcw className="w-5 h-5" />
                        <span className="absolute text-[9px] font-bold mt-0.5">15</span>
                      </button>
                      <button
                        onClick={() => (isPlaying ? pause() : play())}
                        className="w-14 h-14 rounded-full flex items-center justify-center bg-gradient-to-r from-accent to-accent-secondary text-white shadow-lg shadow-accent-500/30"
                        aria-label={isPlaying ? "Pause" : "Play"}
                      >
                        {isBuffering ? (
                          <Loader2 className="w-6 h-6 animate-spin" />
                        ) : isPlaying ? (
                          <Pause className="w-6 h-6" />
                        ) : (
                          <Play className="w-6 h-6 ml-0.5" />
                        )}
                      </button>
                      <button
                        onClick={() => seekBy(SKIP_SECONDS)}
                        className="w-11 h-11 rounded-full flex items-center justify-center text-gray-700 hover:bg-gray-100 relative"
                        aria-label="Forward 15 seconds"
                      >
                        <RotateCw className="w-5 h-5" />
                        <span className="absolute text-[9px] font-bold mt-0.5">15</span>
                      </button>
                    </div>

                    <span className="w-[52px]" />
                  </div>
                </>
              ) : (
                <div className="mt-4 rounded-2xl bg-gray-50 border border-gray-100 p-4 text-sm text-gray-600" role="status">
                  <p>This chapter doesn't have narration yet.</p>
                  <button
                    onClick={() => {
                      pause();
                      onUseListenMode?.(targetIndex);
                    }}
                    className="mt-2 font-semibold text-accent hover:text-accent-hover"
                  >
                    Listen with your device's voice instead
                  </button>
                </div>
              )}

              {showSwitchHint && (
                <button
                  onClick={() => loadChapter(visibleChapterIndex, { autoplay: true })}
                  className="mt-3 w-full text-xs font-medium text-accent hover:text-accent-hover"
                >
                  Play chapter {visibleChapterIndex + 1} (on screen) instead
                </button>
              )}
              {endedBook && <p className="mt-3 text-xs text-gray-500 text-center">End of the audiobook.</p>}
              {errorMessage && (
                <div className="mt-3 text-xs text-red-600 text-center" role="alert">
                  {errorMessage}{" "}
                  <button
                    onClick={() => loadChapter(targetIndex, { startAt: lastKnownTimeRef.current, autoplay: true })}
                    className="font-semibold underline"
                  >
                    Retry
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </>
    );
  }
);

AudiobookPlayer.displayName = "AudiobookPlayer";

export default AudiobookPlayer;
