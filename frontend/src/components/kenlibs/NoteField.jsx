import { NOTE_MAX_LENGTH } from "../../utils/annotationUi";

// A highlight's note. Plain text: shown with React's normal text escaping,
// never as HTML. Saving is the parent's job (debounced through
// useAnnotations), so this just reports changes.
const NoteField = ({ id, value, onChange, autoFocus = false, rows = 3 }) => (
  <div>
    <label htmlFor={id} className="sr-only">
      Note
    </label>
    <textarea
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value.slice(0, NOTE_MAX_LENGTH))}
      maxLength={NOTE_MAX_LENGTH}
      rows={rows}
      autoFocus={autoFocus}
      placeholder="Add a note…"
      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500 resize-y"
    />
    <p className="text-right text-[11px] tabular-nums text-gray-400">
      {value.length}/{NOTE_MAX_LENGTH}
    </p>
  </div>
);

export default NoteField;
