// Step flow for deleting a book (components/dashboard/DeleteBookDialog.jsx).
// Pure, so `npm test` covers it. The server enforces the same rules
// (backend utils/bookDeletion.js); this only decides what to show.
//   Draft, nobody bought it:      warning → type the title
//   Published, or readers own it: warning → buyers / "Unpublish instead" → type the title
// `impact` is GET /api/books/:id/delete-impact.

export const STEP_WARNING = "warning";
export const STEP_BUYERS = "buyers";
export const STEP_TYPE_TITLE = "type-title";

const normalTitle = (title) => String(title ?? "").trim().toLowerCase();

// Trimmed, case-insensitive, never empty (same rule as the server).
export const titlesMatch = (typed, title) => normalTitle(typed) !== "" && normalTitle(typed) === normalTitle(title);

export const needsBuyerStep = (impact) => impact?.status === "published" || (impact?.buyers?.total || 0) > 0;

export const deleteSteps = (impact) => (needsBuyerStep(impact) ? [STEP_WARNING, STEP_BUYERS, STEP_TYPE_TITLE] : [STEP_WARNING, STEP_TYPE_TITLE]);

export const initialDeleteState = { step: 0, typed: "" };

// Moves through the steps. "continue" never goes past the last step, and
// the last step only ever deletes from the dialog's own Delete button.
export const deleteFlowReducer = (impact) => (state, action) => {
  const steps = deleteSteps(impact);
  switch (action.type) {
    case "continue":
      return state.step < steps.length - 1 ? { ...state, step: state.step + 1 } : state;
    case "type":
      return { ...state, typed: String(action.value ?? "") };
    case "reset":
      return initialDeleteState;
    default:
      return state;
  }
};

export const currentStep = (impact, state) => deleteSteps(impact)[state.step];

// The final Delete button is enabled only on the last step with the exact title.
export const canDelete = (impact, state) => currentStep(impact, state) === STEP_TYPE_TITLE && titlesMatch(state.typed, impact?.title);

// Body for DELETE /api/books/:id. The flags are sent only once the steps
// that show them have been passed.
export const deletePayload = (impact, state) => {
  const body = { confirmTitle: state.typed.trim() };
  if (needsBuyerStep(impact)) {
    if (impact.status === "published") body.confirmPublished = true;
    body.acknowledgeBuyers = true;
  }
  return body;
};

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// "2 readers bought it (1 through a bundle), 1 request pending"
export const buyersSummary = (impact) => {
  const { total = 0, viaBundles = 0 } = impact?.buyers || {};
  const parts = [`${plural(total, "reader", "readers")} bought it${viaBundles ? ` (${viaBundles} through ${viaBundles === 1 ? "a bundle" : "bundles"})` : ""}`];
  if (impact?.pendingCount) parts.push(`${plural(impact.pendingCount, "purchase request", "purchase requests")} pending`);
  return parts.join(", ");
};
