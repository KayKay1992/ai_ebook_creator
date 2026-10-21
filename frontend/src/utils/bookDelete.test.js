// Run with `npm test` (Node's built-in test runner).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STEP_BUYERS,
  STEP_TYPE_TITLE,
  STEP_WARNING,
  buyersSummary,
  canDelete,
  currentStep,
  deleteFlowReducer,
  deletePayload,
  deleteSteps,
  initialDeleteState,
  titlesMatch,
} from "./bookDelete.js";

const draft = { title: "The Harmattan Letters", status: "draft", chapterCount: 2, buyers: { total: 0, direct: 0, viaBundles: 0 }, pendingCount: 0, bundles: [] };
const published = { ...draft, status: "published", buyers: { total: 2, direct: 1, viaBundles: 1 }, pendingCount: 1, bundles: [{ title: "Starter Pack" }] };

const run = (impact, actions) => actions.reduce(deleteFlowReducer(impact), initialDeleteState);

test("exact-title gating: trimmed, case-insensitive, never empty", () => {
  assert.equal(titlesMatch("  the harmattan LETTERS ", "The Harmattan Letters"), true);
  assert.equal(titlesMatch("The Harmattan", "The Harmattan Letters"), false);
  assert.equal(titlesMatch("", ""), false);
  assert.equal(titlesMatch(undefined, "x"), false);
});

test("a draft takes two steps; Delete is only enabled on the last one with the exact title", () => {
  assert.deepEqual(deleteSteps(draft), [STEP_WARNING, STEP_TYPE_TITLE]);
  let s = run(draft, []);
  assert.equal(currentStep(draft, s), STEP_WARNING);
  // Typing the title early (it isn't shown, but just in case) doesn't enable anything.
  s = run(draft, [{ type: "type", value: "The Harmattan Letters" }]);
  assert.equal(canDelete(draft, s), false);
  s = run(draft, [{ type: "continue" }]);
  assert.equal(currentStep(draft, s), STEP_TYPE_TITLE);
  assert.equal(canDelete(draft, s), false);
  s = deleteFlowReducer(draft)(s, { type: "type", value: "the harmattan letter" });
  assert.equal(canDelete(draft, s), false);
  s = deleteFlowReducer(draft)(s, { type: "type", value: " the harmattan letters " });
  assert.equal(canDelete(draft, s), true);
  // "continue" can't go past the last step.
  assert.equal(deleteFlowReducer(draft)(s, { type: "continue" }), s);
  assert.deepEqual(deletePayload(draft, s), { confirmTitle: "the harmattan letters" });
  // Cancel/close resets.
  assert.deepEqual(deleteFlowReducer(draft)(s, { type: "reset" }), initialDeleteState);
});

test("a published book takes three steps and sends both flags", () => {
  assert.deepEqual(deleteSteps(published), [STEP_WARNING, STEP_BUYERS, STEP_TYPE_TITLE]);
  let s = run(published, [{ type: "continue" }]);
  assert.equal(currentStep(published, s), STEP_BUYERS);
  assert.equal(canDelete(published, s), false);
  s = run(published, [{ type: "continue" }, { type: "continue" }, { type: "type", value: "THE HARMATTAN LETTERS" }]);
  assert.equal(canDelete(published, s), true);
  assert.deepEqual(deletePayload(published, s), { confirmTitle: "THE HARMATTAN LETTERS", confirmPublished: true, acknowledgeBuyers: true });
});

test("an unpublished book that readers own still gets the buyers step", () => {
  const owned = { ...draft, buyers: { total: 1, direct: 1, viaBundles: 0 } };
  assert.deepEqual(deleteSteps(owned), [STEP_WARNING, STEP_BUYERS, STEP_TYPE_TITLE]);
  const s = run(owned, [{ type: "continue" }, { type: "continue" }, { type: "type", value: owned.title }]);
  assert.deepEqual(deletePayload(owned, s), { confirmTitle: owned.title, acknowledgeBuyers: true });
});

test("buyer summary", () => {
  assert.equal(buyersSummary(published), "2 readers bought it (1 through a bundle), 1 purchase request pending");
  assert.equal(buyersSummary(draft), "0 readers bought it");
});
