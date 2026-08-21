import { useEffect, useState } from "react";
import { Headphones, Pause, Play, Square, Gauge, X } from "lucide-react";
import { RATE_OPTIONS } from "../../hooks/useListenMode";

// How long a voice-fallback warning stays visible before auto-dismissing —
// long enough to read, short enough not to linger as clutter.
const VOICE_WARNING_AUTO_DISMISS_MS = 7000;

// Listen Mode's UI (Step 33) — rendered by KenlibsReadPage as ViewBook's
// `headerControls` slot, right next to the font-size controls. Deliberately
// dumb: all playback state/logic lives in useListenMode, this just renders
// it and forwards clicks.
const ListenModeControls = ({ listenMode, isActive, onToggle, onReplay }) => {
  const {
    isSupported,
    isCheckingSupport,
    voices,
    selectedVoiceURI,
    selectVoice,
    rate,
    setRate,
    isSpeaking,
    isPaused,
    voiceWarning,
    pause,
    resume,
    stop,
  } = listenMode;

  // Tracks the last warning the reader dismissed (via the X button or
  // auto-dismiss) so it stays hidden — but a genuinely NEW warning message
  // (different text) never matches it and shows automatically, no reset
  // needed.
  const [dismissedWarning, setDismissedWarning] = useState(null);
  useEffect(() => {
    if (!voiceWarning) return;
    const timeout = setTimeout(() => setDismissedWarning(voiceWarning), VOICE_WARNING_AUTO_DISMISS_MS);
    return () => clearTimeout(timeout);
  }, [voiceWarning]);
  const visibleWarning = voiceWarning && voiceWarning !== dismissedWarning ? voiceWarning : null;

  if (isCheckingSupport) {
    return (
      <div className="w-9 h-9 rounded-xl flex items-center justify-center text-gray-300">
        <Headphones className="w-4 h-4 animate-pulse" />
      </div>
    );
  }

  if (!isSupported) {
    return (
      <span
        className="hidden sm:flex items-center gap-1.5 text-xs text-gray-400 px-2"
        title="Your browser isn't reporting any text-to-speech voices, so Listen Mode isn't available here."
      >
        <Headphones className="w-3.5 h-3.5 opacity-50" />
        Listen unavailable
      </span>
    );
  }

  const cycleRate = () => {
    const idx = RATE_OPTIONS.indexOf(rate);
    setRate(RATE_OPTIONS[(idx + 1) % RATE_OPTIONS.length]);
  };

  const handlePlayPause = () => {
    if (isSpeaking && !isPaused) {
      pause();
    } else if (isPaused) {
      resume();
    } else {
      onReplay();
    }
  };

  return (
    <div className="relative flex items-center gap-1.5">
      {visibleWarning && (
        <div className="absolute top-full right-0 mt-2 z-40 flex items-start gap-2 max-w-xs rounded-xl bg-gray-900 text-white text-xs px-3 py-2 shadow-lg">
          <span className="flex-1">{visibleWarning}</span>
          <button
            onClick={() => setDismissedWarning(voiceWarning)}
            className="text-gray-400 hover:text-white flex-shrink-0"
            title="Dismiss"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
      <button
        onClick={onToggle}
        title={isActive ? "Turn off Listen Mode" : "Listen to this chapter"}
        className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all ${
          isActive
            ? "bg-accent text-white shadow-sm"
            : "text-gray-600 hover:bg-white hover:shadow-sm"
        }`}
      >
        <Headphones className="w-4 h-4" />
      </button>

      {isActive && (
        <div className="flex items-center gap-1 bg-gray-100 rounded-2xl p-1">
          <button
            onClick={handlePlayPause}
            title={isSpeaking && !isPaused ? "Pause" : "Play"}
            className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-600 hover:bg-white hover:shadow-sm transition-all"
          >
            {isSpeaking && !isPaused ? (
              <Pause className="w-3.5 h-3.5" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
          </button>

          <button
            onClick={stop}
            disabled={!isSpeaking}
            title="Stop"
            className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-600 hover:bg-white hover:shadow-sm disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            <Square className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={cycleRate}
            title="Playback speed"
            className="h-8 px-2 rounded-xl flex items-center gap-1 text-xs font-medium text-gray-600 hover:bg-white hover:shadow-sm transition-all"
          >
            <Gauge className="w-3.5 h-3.5" />
            {rate}×
          </button>

          {voices.length > 1 && (
            <select
              value={selectedVoiceURI || ""}
              onChange={(e) => selectVoice(e.target.value)}
              title="Voice"
              className="hidden md:block h-8 max-w-[7rem] rounded-xl border-0 bg-transparent text-xs text-gray-600 hover:bg-white focus:outline-none focus:ring-1 focus:ring-accent-300"
            >
              {voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
    </div>
  );
};

export default ListenModeControls;
