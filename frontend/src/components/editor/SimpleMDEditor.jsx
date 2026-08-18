import { useRef, useState } from "react";
import {
  Type,
  Image as ImageIcon,
  Scissors,
  Wand2,
  SpellCheck,
  PenLine,
  Loader2,
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
  { key: "fix-grammar", label: "Fix Grammar", icon: SpellCheck },
  { key: "continue", label: "Continue", icon: PenLine },
];

const ACTION_LABELS = EDIT_ACTIONS.reduce((acc, a) => ({ ...acc, [a.key]: a.label }), {});

const SimpleMDEditor = ({ value, onChange, bookId }) => {
  const fileInputRef = useRef(null);
  const pendingApiRef = useRef(null);

  // Inline AI editing: `selection` is the last non-empty text selection
  // captured from the underlying textarea ({start, end, text} char offsets
  // into `value`); `toolbarPos` is where to float the action toolbar.
  const [selection, setSelection] = useState(null);
  const [toolbarPos, setToolbarPos] = useState(null);
  const [activeAction, setActiveAction] = useState(null);

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

  // Fires on mouseup/keyup in the underlying textarea (wired via
  // textareaProps below) — the only reliable way to read selection offsets
  // on a plain <textarea>, since it has no Range/getClientRects API like
  // contenteditable does.
  const handleSelectionEvent = (e) => {
    if (activeAction) return; // don't disturb an in-flight edit
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

    // Mouse selections: anchor near the cursor. Keyboard selections (no
    // usable clientX/Y) fall back to just below the top of the textarea —
    // less precise, but keeps the toolbar reachable either way.
    const rect = target.getBoundingClientRect();
    // Estimated on-screen width of the 4-button toolbar — it isn't
    // rendered yet at this point, so this is a conservative measured
    // guess (not exact), clamped against the viewport as a hard bound.
    const TOOLBAR_WIDTH = 340;
    const maxLeft = window.innerWidth - TOOLBAR_WIDTH - 12;
    if (e.type === "mouseup" && e.clientY > 0) {
      const left = Math.min(Math.max(e.clientX - 90, rect.left + 8, 8), maxLeft);
      setToolbarPos({ top: e.clientY + 16, left });
    } else {
      setToolbarPos({ top: rect.top + 12, left: Math.min(rect.left + 12, maxLeft) });
    }
  };

  // A toolbar button uses onMouseDown+preventDefault (not onClick alone)
  // so clicking it never blurs the textarea in the first place — simpler
  // and more robust than trying to detect "blur, but it was our button"
  // after the fact.
  const handleBlur = () => {
    if (activeAction) return;
    setTimeout(() => {
      setSelection(null);
      setToolbarPos(null);
    }, 150);
  };

  const handleAiEdit = async (action) => {
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
        body: JSON.stringify({ selectedText, action, surroundingContext, bookId }),
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
          ) : (
            EDIT_ACTIONS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleAiEdit(key)}
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
