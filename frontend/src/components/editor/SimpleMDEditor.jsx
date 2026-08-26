import { useEffect, useRef, useState } from "react";
import {
  Type,
  Image as ImageIcon,
  Scissors,
  Wand2,
  SpellCheck,
  PenLine,
  Repeat,
  Loader2,
  Send,
  X,
} from "lucide-react";
import MDEditor, { commands } from "@uiw/react-md-editor";
import toast from "react-hot-toast";
import axiosInstance from "../../utils/axiosInstance";
import { API_PATHS, BASE_URL } from "../../utils/apiPaths";
import getErrorMessage from "../../utils/getErrorMessage";

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif"];
const MAX_IMAGE_SIZE = 8 * 1024 * 1024; // 8MB — matches the backend's chapter-image limit

// How much text on either side of a selection to send as continuity context
// for the AI edit (not shown to the user, just informs tone/flow).
const CONTEXT_CHARS = 400;

const EDIT_ACTIONS = [
  { key: "shorten", label: "Shorten", icon: Scissors },
  { key: "improve", label: "Improve", icon: Wand2 },
  { key: "rewrite", label: "Rewrite", icon: Repeat },
  { key: "fix-grammar", label: "Fix Grammar", icon: SpellCheck },
  { key: "continue", label: "Continue", icon: PenLine },
];

const ACTION_LABELS = EDIT_ACTIONS.reduce((acc, a) => ({ ...acc, [a.key]: a.label }), {});

// Same reasoning as KenlibsReadPage.jsx's word-explain selection fix: a
// plain `mouseup`/`keyup` pair never fires on a touchscreen at all, so the
// toolbar never appeared on mobile no matter how a passage was selected.
// Checked once at module scope since it doesn't change during a session.
const isTouchCapable =
  typeof window !== "undefined" && ("ontouchstart" in window || navigator.maxTouchPoints > 0);

const SimpleMDEditor = ({ value, onChange, bookId }) => {
  const fileInputRef = useRef(null);
  const pendingApiRef = useRef(null);

  // Inline AI editing: `selection` is the last non-empty text selection
  // captured from the underlying textarea ({start, end, text} char offsets
  // into `value`); `toolbarPos` is where to float the action toolbar.
  const [selection, setSelection] = useState(null);
  const [toolbarPos, setToolbarPos] = useState(null);
  const [activeAction, setActiveAction] = useState(null);
  // Rewrite is the one action that asks for an optional hint before firing
  // — these two are scoped to that single action only, the other four
  // fire immediately on click exactly as before.
  const [isAwaitingRewriteHint, setIsAwaitingRewriteHint] = useState(false);
  const [rewriteHint, setRewriteHint] = useState("");

  const uploadImageCommand = {
    name: "upload-image",
    keyCommand: "upload-image",
    buttonProps: { "aria-label": "Insert image", title: "Insert image" },
    icon: <ImageIcon size={13} />,
    execute: (_state, api) => {
      pendingApiRef.current = api;
      fileInputRef.current?.click();
    },
  };

  const handleFileSelected = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;

    const api = pendingApiRef.current;

    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      toast.error("Only JPG, PNG, or GIF images are allowed.");
      return;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      toast.error("Image must be smaller than 8MB.");
      return;
    }

    const toastId = toast.loading("Uploading image...");
    try {
      const formData = new FormData();
      formData.append("chapterImage", file);

      const response = await axiosInstance.post(
        `${API_PATHS.BOOKS.UPLOAD_CHAPTER_IMAGE}/${bookId}`,
        formData,
        { headers: { "Content-Type": "multipart/form-data" } }
      );

      api?.replaceSelection(`![${file.name}](${response.data.path})`);
      toast.success("Image inserted", { id: toastId });
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to upload image"), {
        id: toastId,
      });
    }
  };

  // Fires on mouseup/keyup/select/touchend in the underlying textarea
  // (wired via textareaProps below) — the only reliable way to read
  // selection offsets on a plain <textarea>, since it has no
  // Range/getClientRects API like contenteditable does.
  //
  // mouseup/keyup alone never fire on a touchscreen at all, which is why
  // this toolbar never appeared on mobile no matter how a passage was
  // selected. Two more triggers cover touch, mirroring KenlibsReadPage.jsx's
  // word-explain selection fix:
  // - touchend (below, with a short delay): Android/iOS finalize the
  //   long-press + drag-handle selection UI slightly after touchend fires,
  //   so reading selectionStart/End synchronously inside the touchend
  //   handler itself often sees a stale or still-collapsed selection.
  // - the native 'select' event: fires whenever a <textarea>'s internal
  //   selection changes, including dragging one of the native touch
  //   selection handles to adjust it — touchend alone doesn't catch that,
  //   since adjusting via the handles is handled entirely inside the
  //   browser's own selection UI and never dispatches a further touchend.
  //   This is the <textarea>-native equivalent of contenteditable's
  //   document-level 'selectionchange' (which doesn't fire for a
  //   textarea's own internal text at all). Scoped to touch-capable
  //   devices only: on desktop, 'select' can fire alongside mouseup for
  //   the very same drag-selection, and — carrying no clientX/Y — would
  //   overwrite mouseup's precise cursor-anchored toolbar position with
  //   the less precise fallback below.
  const handleSelectionEvent = (e) => {
    if (activeAction) return; // don't disturb an in-flight edit
    if (e.type === "select" && !isTouchCapable) return;

    const target = e.target;
    const { selectionStart, selectionEnd, value: currentValue } = target;

    if (selectionStart === selectionEnd) {
      setSelection(null);
      setToolbarPos(null);
      return;
    }

    const text = currentValue.slice(selectionStart, selectionEnd);
    if (!text.trim()) {
      setSelection(null);
      setToolbarPos(null);
      return;
    }

    setSelection({ start: selectionStart, end: selectionEnd, text });
    // A genuinely new selection means whatever the Rewrite hint prompt was
    // open for (if it was) no longer applies — back to the plain action list.
    if (isAwaitingRewriteHint) {
      setIsAwaitingRewriteHint(false);
      setRewriteHint("");
    }

    // Mouse selections: anchor near the cursor. Keyboard/touch/select-event
    // selections (no usable clientX/Y) fall back to just below the top of
    // the textarea — less precise, but keeps the toolbar reachable either
    // way, and a per-selection bounding rect isn't available in a plain
    // <textarea> the way it is for a Range-based rich-text selection.
    const rect = target.getBoundingClientRect();
    // Estimated on-screen width of the toolbar — it isn't rendered yet at
    // this point, so this is a conservative measured guess (not exact),
    // clamped against the viewport as a hard bound.
    const TOOLBAR_WIDTH = 400;
    const maxLeft = window.innerWidth - TOOLBAR_WIDTH - 12;
    if (e.type === "mouseup" && e.clientY > 0) {
      const left = Math.min(Math.max(e.clientX - 90, rect.left + 8, 8), maxLeft);
      setToolbarPos({ top: e.clientY + 16, left });
    } else {
      setToolbarPos({ top: rect.top + 12, left: Math.min(rect.left + 12, maxLeft) });
    }
  };

  // See handleSelectionEvent's comment above — Android/iOS finalize the
  // touch selection UI slightly after touchend fires, so this delays the
  // actual check rather than reading a stale/still-collapsed selection
  // synchronously inside the touch handler itself. Captures e.target
  // synchronously (safe — React 19 has no synthetic event pooling to worry
  // about) since the original event won't still be around 250ms later.
  const touchSelectionTimeoutRef = useRef(null);
  const handleTouchSelectionEnd = (e) => {
    const target = e.target;
    if (touchSelectionTimeoutRef.current) clearTimeout(touchSelectionTimeoutRef.current);
    touchSelectionTimeoutRef.current = setTimeout(
      () => handleSelectionEvent({ type: "touchend", target }),
      250
    );
  };

  useEffect(() => {
    return () => {
      if (touchSelectionTimeoutRef.current) clearTimeout(touchSelectionTimeoutRef.current);
    };
  }, []);

  // A toolbar button uses onMouseDown+preventDefault (not onClick alone)
  // so clicking it never blurs the textarea in the first place — simpler
  // and more robust than trying to detect "blur, but it was our button"
  // after the fact. The Rewrite hint input, though, DOES legitimately steal
  // focus from the textarea when it autofocuses (it's a real text input,
  // not a button) — isAwaitingRewriteHint guards against that blur clearing
  // the whole toolbar (hint input included) out from under the user right
  // as it appears.
  const handleBlur = () => {
    if (activeAction || isAwaitingRewriteHint) return;
    setTimeout(() => {
      setSelection(null);
      setToolbarPos(null);
    }, 150);
  };

  // Rewrite alone asks for an optional hint first instead of firing
  // immediately — the other four actions call handleAiEdit directly from
  // the button's onClick, unchanged.
  const handleOpenRewriteHint = () => {
    setRewriteHint("");
    setIsAwaitingRewriteHint(true);
  };

  const handleCancelRewriteHint = () => {
    setIsAwaitingRewriteHint(false);
    setRewriteHint("");
  };

  const handleSubmitRewriteHint = (e) => {
    e.preventDefault();
    const hint = rewriteHint.trim();
    setIsAwaitingRewriteHint(false);
    handleAiEdit("rewrite", hint);
  };

  const handleAiEdit = async (action, hint = "") => {
    if (!selection || activeAction) return;
    if (!navigator.onLine) {
      toast.error("You're offline — AI editing needs a connection.");
      return;
    }

    const { start, end, text: selectedText } = selection;
    const originalValue = value;
    setActiveAction(action);

    const before = originalValue.slice(Math.max(0, start - CONTEXT_CHARS), start);
    const after = originalValue.slice(end, Math.min(originalValue.length, end + CONTEXT_CHARS));
    const surroundingContext = `${before} [...] ${after}`;

    let accumulated = "";
    try {
      const token = localStorage.getItem("token");
      const response = await fetch(`${BASE_URL}${API_PATHS.AI.EDIT_SELECTION}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ selectedText, action, surroundingContext, bookId, hint }),
      });

      if (!response.ok || !response.body) {
        let message = "Failed to edit selection";
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
        const { done, value: chunkValue } = await reader.read();
        if (done) break;
        buffer += decoder.decode(chunkValue, { stream: true });

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
            // Always rebuilt from the ORIGINAL pre-edit value, not the
            // currently-displayed one — each chunk update is a full
            // replacement of [start,end), not a compounding edit.
            onChange(originalValue.slice(0, start) + accumulated + originalValue.slice(end));
          } else if (eventType === "error") {
            throw new Error(data.message || "Edit failed");
          } else if (eventType === "done") {
            accumulated = data.content ?? accumulated;
          }
        }
      }

      onChange(originalValue.slice(0, start) + accumulated + originalValue.slice(end));

      toast(
        (t) => (
          <span className="flex items-center gap-3">
            Text updated.
            <button
              onClick={() => {
                onChange(originalValue);
                toast.dismiss(t.id);
              }}
              className="font-semibold text-accent hover:underline"
            >
              Undo
            </button>
          </span>
        ),
        { duration: 6000 }
      );
    } catch (error) {
      onChange(originalValue); // roll back any partial streamed replacement
      toast.error(getErrorMessage(error, "Failed to edit selection"));
    } finally {
      setActiveAction(null);
      setSelection(null);
      setToolbarPos(null);
    }
  };

  return (
    <div className="h-full flex flex-col" data-color-mode="light">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-100 bg-gray-50/80">
        <Type className="w-4 h-4 text-accent" />
        <span className="text-sm font-medium text-gray-700">Markdown Editor</span>
      </div>

      <input
        type="file"
        ref={fileInputRef}
        accept="image/*"
        onChange={handleFileSelected}
        className="hidden"
      />

      {selection && toolbarPos && (
        <div
          className="fixed z-50 bg-white rounded-2xl shadow-xl border border-gray-200 flex items-center flex-wrap gap-1 p-1.5 max-w-[calc(100vw-24px)]"
          style={{ top: toolbarPos.top, left: toolbarPos.left }}
        >
          {activeAction ? (
            <div className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600">
              <Loader2 className="w-4 h-4 animate-spin text-accent" />
              {ACTION_LABELS[activeAction]}…
            </div>
          ) : isAwaitingRewriteHint ? (
            <form
              onSubmit={handleSubmitRewriteHint}
              className="flex items-center gap-1.5 w-full min-w-[260px]"
            >
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleCancelRewriteHint}
                className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                title="Back"
              >
                <X className="w-3.5 h-3.5" />
              </button>
              <input
                type="text"
                autoFocus
                value={rewriteHint}
                onChange={(e) => setRewriteHint(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") handleCancelRewriteHint();
                }}
                placeholder="How should this be rewritten? (optional)"
                className="flex-1 min-w-0 px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
              />
              <button
                type="submit"
                onMouseDown={(e) => e.preventDefault()}
                className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-white bg-accent hover:bg-accent-hover transition-colors"
                title={rewriteHint.trim() ? "Rewrite with this instruction" : "Rewrite (general)"}
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          ) : (
            EDIT_ACTIONS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => (key === "rewrite" ? handleOpenRewriteHint() : handleAiEdit(key))}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-gray-600 hover:bg-accent-50 hover:text-accent-hover transition-colors"
                title={label}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))
          )}
        </div>
      )}

      <div className="flex-1 min-h-[400px]">
        <MDEditor
          value={value}
          onChange={onChange}
          height="100%"
          preview="edit"
          visibleDragbar={false}
          textareaProps={{
            onMouseUp: handleSelectionEvent,
            onKeyUp: handleSelectionEvent,
            onSelect: handleSelectionEvent,
            onTouchEnd: handleTouchSelectionEnd,
            onBlur: handleBlur,
          }}
          commands={[
            commands.bold,
            commands.italic,
            commands.strikethrough,
            commands.hr,
            commands.title,
            commands.divider,
            commands.quote,
            commands.code,
            commands.link,
            uploadImageCommand,
            commands.unorderedListCommand,
            commands.orderedListCommand,
            commands.checkedListCommand,
          ]}
          extraCommands={[]}
        />
      </div>

      <style>{`
        .w-md-editor {
          border: none !important;
          box-shadow: none !important;
          background: transparent !important;
          height: 100% !important;
        }
        .w-md-editor-toolbar {
          background: #f9fafb !important;
          border-bottom: 1px solid #f3f4f6 !important;
        }
        .w-md-editor-content {
          background: white !important;
        }
      `}</style>
    </div>
  );
};

export default SimpleMDEditor;
