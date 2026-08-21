import { useCallback, useEffect, useRef, useState } from "react";

export const RATE_OPTIONS = [0.75, 1, 1.25, 1.5];

// How long to wait for the browser to report at least one voice before
// concluding Listen Mode genuinely isn't available. Chrome (and others)
// populate getVoices() asynchronously — the very first synchronous call
// often returns [] even in browsers that do have voices, until the
// 'voiceschanged' event fires. This is a "give up and say so" timeout, not
// a real per-browser guarantee.
const VOICE_DETECTION_TIMEOUT_MS = 1500;

// How long to wait, after calling speak(), for ANY sign of life from a
// voice (its 'start' or 'boundary' event) before concluding it's not
// actually going to work. Needed because "remote"/network voices
// (voice.localService === false — e.g. Chrome's "Google ..." voices,
// which synthesize via a network service rather than the device) can have
// speak() succeed with zero errors and speechSynthesis.speaking report
// true forever, while never producing a single event or any audio —
// confirmed via direct testing in this environment: local (SAPI) voices
// fired start→boundary…→end every time, while every remote voice tested
// fired nothing at all, indefinitely. This is what "only the first few
// voices work" turned out to be — not a picker/index bug, but specific
// voices' network backend being unreachable, with the browser giving no
// error to detect that by itself.
const VOICE_START_TIMEOUT_MS = 2500;

// Wraps the browser's SpeechSynthesis API for the gated reader's Listen
// Mode (Step 33). Deliberately owns nothing about chapter navigation or
// markdown — callers pass in already-built { spokenText, blocks } (see
// utils/speechText.js) and get back playback state + an activeBlockIndex
// to highlight.
const hasSpeechSynthesis = typeof window !== "undefined" && "speechSynthesis" in window;

const useListenMode = ({ onChapterEnd }) => {
  // Known synchronously at mount, so the "unsupported" case never needs a
  // setState call inside the effect body below — it's just the initial
  // value.
  const [isSupported, setIsSupported] = useState(hasSpeechSynthesis);
  const [isCheckingSupport, setIsCheckingSupport] = useState(hasSpeechSynthesis);
  const [voices, setVoices] = useState([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState(null);
  const [rate, setRateState] = useState(1);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [activeBlockIndex, setActiveBlockIndex] = useState(-1);
  // Set when a voice fails to produce any sign of life (see
  // VOICE_START_TIMEOUT_MS) — a human-readable message for the UI to show,
  // e.g. "'Google Deutsch' isn't responding — switched back to Microsoft
  // David." Cleared on the next explicit voice pick or successful start.
  const [voiceWarning, setVoiceWarning] = useState(null);

  const onChapterEndRef = useRef(onChapterEnd);
  useEffect(() => {
    onChapterEndRef.current = onChapterEnd;
  }, [onChapterEnd]);

  // Rate/voice are read via refs inside speakFrom (updated synchronously,
  // not via a useEffect reacting to state) so a rate/voice change followed
  // immediately by a restart-from-current-block always picks up the new
  // value rather than whatever was captured in an older closure.
  const rateRef = useRef(1);
  const voiceRef = useRef(null); // the SpeechSynthesisVoice object, not just its URI

  // Current material being read, so pause/resume and a rate/voice change
  // can restart from the right place without the caller re-supplying it.
  const currentMaterialRef = useRef(null); // { spokenText, blocks }
  const currentBlockIndexRef = useRef(0);
  // Bumped by every speakFrom()/stop() call and captured per-utterance, so
  // each utterance's onend/onerror can tell whether it's still the current
  // one before acting. A plain boolean "was this cancel() intentional" flag
  // (tried first) doesn't work reliably: cancel()'s resulting onend/onerror
  // isn't guaranteed to fire before the next speakFrom() call's own
  // setTimeout(0) resets such a flag — observed in testing as rapid rate
  // changes occasionally leaving isSpeaking stuck false (a stale cancelled
  // utterance's onend firing "naturally") while the browser was still
  // actually speaking the utterance that superseded it. A monotonically
  // increasing token has no such timing dependency: stale callbacks are
  // simply ones whose captured token no longer matches current.
  const utteranceTokenRef = useRef(0);

  useEffect(() => {
    if (!hasSpeechSynthesis) return; // already reflected in the initial state above

    const synth = window.speechSynthesis;

    const loadVoices = () => {
      const available = synth.getVoices();
      if (available.length > 0) {
        setVoices(available);
        setSelectedVoiceURI((prev) => {
          if (prev) return prev;
          voiceRef.current = available[0];
          return available[0].voiceURI;
        });
        setIsSupported(true);
        setIsCheckingSupport(false);
      }
    };

    loadVoices();
    synth.addEventListener("voiceschanged", loadVoices);

    const timeout = setTimeout(() => {
      if (synth.getVoices().length === 0) {
        setIsSupported(false);
      }
      setIsCheckingSupport(false);
    }, VOICE_DETECTION_TIMEOUT_MS);

    return () => {
      synth.removeEventListener("voiceschanged", loadVoices);
      clearTimeout(timeout);
    };
  }, []);

  // The utterance object currently (or most recently) handed to speak(), so
  // a new speakFrom() call can wait for ITS specific cancellation to be
  // acknowledged before speaking the replacement — see speakFrom below.
  const activeUtteranceRef = useRef(null);
  // The last voice actually confirmed to produce speech (its 'start' event
  // fired) — the fallback target when a different voice times out. Starts
  // null and is only ever set from a genuine success, so there's nothing to
  // fall back to until at least one voice has proven itself.
  const lastWorkingVoiceRef = useRef(null);
  // Voices that have already timed out once this page load — skipped
  // (falling straight back to lastWorkingVoiceRef) rather than re-attempted
  // and re-timed-out every single time they're picked again.
  const unavailableVoiceURIsRef = useRef(new Set());

  const stop = useCallback(() => {
    utteranceTokenRef.current += 1; // invalidate any in-flight utterance's callbacks
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    activeUtteranceRef.current = null;
    setIsSpeaking(false);
    setIsPaused(false);
    setActiveBlockIndex(-1);
  }, []);

  // Lets the voice-start-timeout below retry via speakFrom without directly
  // self-referencing it from inside its own useCallback body (flagged by
  // react-hooks/immutability — accessed-before-declared, since the
  // reference is captured in the closure before the `const` assignment
  // completes). Kept current via the effect right after speakFrom's
  // definition.
  const speakFromRef = useRef(null);

  // Speaks `material` starting at `fromBlockIndex` (default 0). Used for a
  // fresh play, a chapter change, a rate/voice change, and — since native
  // pause()/resume() proved unreliable across the browsers tested — as the
  // resume mechanism too (restarting the current block rather than
  // resuming mid-utterance; a well-understood, common tradeoff for TTS
  // readers).
  const speakFrom = useCallback((material, fromBlockIndex = 0) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const { spokenText, blocks } = material;
    if (!spokenText || blocks.length === 0) return;

    const synth = window.speechSynthesis;
    const clampedIndex = Math.min(Math.max(fromBlockIndex, 0), blocks.length - 1);
    const startChar = blocks[clampedIndex].start;
    const textFromStart = spokenText.slice(startChar);

    // A voice already known (this page load) to never actually produce
    // speech is skipped in favor of the last one confirmed to work, rather
    // than being retried (and re-timed-out) every time it comes up again —
    // e.g. on every chapter change while it's still selected.
    let voice = voiceRef.current;
    let fellBackFrom = null;
    if (
      voice &&
      unavailableVoiceURIsRef.current.has(voice.voiceURI) &&
      lastWorkingVoiceRef.current &&
      lastWorkingVoiceRef.current.voiceURI !== voice.voiceURI
    ) {
      fellBackFrom = voice;
      voice = lastWorkingVoiceRef.current;
      voiceRef.current = voice;
      setSelectedVoiceURI(voice.voiceURI);
    }

    const myToken = utteranceTokenRef.current + 1;
    utteranceTokenRef.current = myToken;

    const utterance = new SpeechSynthesisUtterance(textFromStart);
    utterance.rate = rateRef.current;
    if (voice) utterance.voice = voice;

    let hasStarted = false;
    let startTimeoutId = null;
    const confirmStarted = () => {
      if (hasStarted) return;
      hasStarted = true;
      if (startTimeoutId) clearTimeout(startTimeoutId);
      if (voice) lastWorkingVoiceRef.current = voice;
      // Deliberately doesn't clear voiceWarning here: a fallback's own
      // successful start would otherwise immediately wipe out the warning
      // that was just set to explain *why* it fell back — confirmed via
      // testing this was actually happening (warning set, then erased
      // within the same tick by the fallback utterance's own onboundary).
      // The warning already has its own auto-dismiss and is cleared
      // explicitly on the next manual voice pick (see selectVoice).
    };

    utterance.onstart = confirmStarted;

    utterance.onboundary = (event) => {
      if (myToken !== utteranceTokenRef.current) return; // superseded — ignore
      confirmStarted();
      const absoluteIndex = startChar + event.charIndex;
      const idx = blocks.findIndex((b) => absoluteIndex >= b.start && absoluteIndex < b.end);
      if (idx !== -1) {
        currentBlockIndexRef.current = idx;
        setActiveBlockIndex(idx);
      }
    };

    const handleEnd = () => {
      if (startTimeoutId) clearTimeout(startTimeoutId);
      // A stale/cancelled utterance's onend fires no differently from a
      // natural one — the token is what tells them apart. If a newer
      // speakFrom()/stop() has already run, this utterance is no longer
      // "current," so its end (whatever caused it) means nothing now.
      if (myToken !== utteranceTokenRef.current) return;
      setIsSpeaking(false);
      setIsPaused(false);
      setActiveBlockIndex(-1);
      onChapterEndRef.current?.();
    };
    utterance.onend = handleEnd;
    utterance.onerror = handleEnd;

    currentMaterialRef.current = material;
    currentBlockIndexRef.current = clampedIndex;
    setActiveBlockIndex(clampedIndex);
    setIsSpeaking(true);
    setIsPaused(false);
    if (fellBackFrom) {
      setVoiceWarning(
        `"${fellBackFrom.name}" isn't responding in this browser — switched back to "${voice.name}."`
      );
    }

    const doSpeak = () => {
      if (myToken !== utteranceTokenRef.current) return; // superseded before it even started
      activeUtteranceRef.current = utterance;
      synth.speak(utterance);

      // Some voices — confirmed via testing to be specifically "remote"
      // ones (voice.localService === false, e.g. Chrome's network-backed
      // "Google ..." voices) — can have speak() succeed with
      // speechSynthesis.speaking staying true forever while never firing
      // start, boundary, end, OR error: total silence, no way to tell
      // apart from a voice that's just slow. This timeout is what actually
      // detects that "silently fails" case.
      startTimeoutId = setTimeout(() => {
        if (hasStarted || myToken !== utteranceTokenRef.current) return;
        unavailableVoiceURIsRef.current.add(utterance.voice?.voiceURI);
        utteranceTokenRef.current += 1; // invalidate this dead utterance
        synth.cancel();
        const fallback = lastWorkingVoiceRef.current;
        if (fallback && fallback.voiceURI !== utterance.voice?.voiceURI) {
          voiceRef.current = fallback;
          setSelectedVoiceURI(fallback.voiceURI);
          setVoiceWarning(
            `"${utterance.voice?.name}" isn't responding in this browser — switched back to "${fallback.name}."`
          );
          speakFromRef.current(material, currentBlockIndexRef.current);
        } else {
          setIsSpeaking(false);
          setIsPaused(false);
          setVoiceWarning(`"${utterance.voice?.name}" isn't responding in this browser. Try a different voice.`);
        }
      }, VOICE_START_TIMEOUT_MS);
    };

    const previousUtterance = activeUtteranceRef.current;
    if (previousUtterance && (synth.speaking || synth.pending)) {
      // Interrupting an utterance that's actively mid-speech and calling
      // speak() again for the replacement in the same tick (or even a 0ms
      // timeout later) is unreliable — confirmed via testing that Chrome
      // can silently drop the replacement utterance entirely (no start,
      // boundary, end, or error ever fires for it) when the cancellation
      // hasn't been fully processed yet. Waiting for the interrupted
      // utterance's own end/error event — which cancel() reliably
      // triggers — before speaking the replacement sequences the two
      // properly instead of guessing at a delay. A timeout is still kept
      // as a safety net in case that event never arrives.
      let settled = false;
      const proceed = () => {
        if (settled) return;
        settled = true;
        previousUtterance.removeEventListener("end", proceed);
        previousUtterance.removeEventListener("error", proceed);
        doSpeak();
      };
      previousUtterance.addEventListener("end", proceed);
      previousUtterance.addEventListener("error", proceed);
      synth.cancel();
      setTimeout(proceed, 300);
    } else {
      // Nothing was actively speaking — cancel() is a no-op here, but
      // Chrome (and others) can still drop a speak() call issued in the
      // same tick as a cancel() call, so a beat's delay is kept for safety.
      synth.cancel();
      setTimeout(doSpeak, 0);
    }
  }, []);

  useEffect(() => {
    speakFromRef.current = speakFrom;
  }, [speakFrom]);

  // `fromBlockIndex` defaults to 0 (start of chapter) — callers resuming a
  // previous session's Listen Mode position (see KenlibsReadPage) pass the
  // block they'd gotten to instead.
  const play = useCallback(
    (material, fromBlockIndex = 0) => {
      speakFrom(material, fromBlockIndex);
    },
    [speakFrom]
  );

  // Deliberately doesn't use native speechSynthesis.pause()/resume() at all
  // — confirmed via live testing that pause() can silently no-op in Chrome
  // (speechSynthesis.paused stays false and the utterance keeps talking
  // right through it, with no error of any kind), which would leave the UI
  // showing "paused" while audio keeps playing. Pause is instead
  // implemented as stop-and-remember: cancel the utterance outright and let
  // resume() restart from the last-heard block via the same speakFrom()
  // primitive already used for rate/voice changes — the one mechanism this
  // hook actually trusts, since it doesn't rely on pause/resume semantics
  // that vary across browsers.
  const pause = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    utteranceTokenRef.current += 1; // invalidate the in-flight utterance's callbacks
    window.speechSynthesis.cancel();
    setIsPaused(true);
  }, []);

  const resume = useCallback(() => {
    setIsPaused(false);
    if (currentMaterialRef.current) {
      speakFrom(currentMaterialRef.current, currentBlockIndexRef.current);
    }
  }, [speakFrom]);

  const setRate = useCallback(
    (nextRate) => {
      rateRef.current = nextRate;
      setRateState(nextRate);
      // A rate change only takes effect on a new utterance — if actively
      // speaking (not paused), restart from the current block with the
      // new rate rather than silently ignoring the change until the next
      // chapter. Leave a paused reader paused; the new rate applies
      // whenever they resume.
      if (isSpeaking && !isPaused && currentMaterialRef.current) {
        setTimeout(() => speakFrom(currentMaterialRef.current, currentBlockIndexRef.current), 0);
      }
    },
    [isSpeaking, isPaused, speakFrom]
  );

  const selectVoice = useCallback(
    (voiceURI) => {
      const voice = voices.find((v) => v.voiceURI === voiceURI);
      voiceRef.current = voice || null;
      setSelectedVoiceURI(voiceURI);
      // A fresh manual pick deserves a fresh attempt even if this exact
      // voice timed out earlier — the read/network hiccup that caused it
      // may no longer apply — and clears any stale warning about a
      // different voice.
      if (voice) unavailableVoiceURIsRef.current.delete(voice.voiceURI);
      setVoiceWarning(null);
      if (isSpeaking && !isPaused && currentMaterialRef.current) {
        setTimeout(() => speakFrom(currentMaterialRef.current, currentBlockIndexRef.current), 0);
      }
    },
    [voices, isSpeaking, isPaused, speakFrom]
  );

  // Stop speech immediately on unmount — never leave a voice talking over
  // a page the reader has left.
  useEffect(() => {
    return () => {
      utteranceTokenRef.current += 1;
      activeUtteranceRef.current = null;
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  return {
    isSupported,
    isCheckingSupport,
    voices,
    selectedVoiceURI,
    selectVoice,
    rate,
    setRate,
    isSpeaking,
    isPaused,
    activeBlockIndex,
    voiceWarning,
    play,
    pause,
    resume,
    stop,
  };
};

export default useListenMode;
