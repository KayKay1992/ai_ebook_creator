// Run with `npm test` (Node's built-in test runner).
import { test } from "node:test";
import assert from "node:assert/strict";
import { toggleHandler } from "./dropdownToggle.js";

// A stand-in for React's useState setter.
const state = (initial) => {
  let value = initial;
  return { get: () => value, set: (next) => (value = typeof next === "function" ? next(value) : next) };
};

test("a click toggles the menu and stops propagation", () => {
  const open = state(false);
  const onToggle = toggleHandler(open.set);
  let stopped = 0;
  const click = { stopPropagation: () => stopped++ };
  onToggle(click);
  assert.equal(open.get(), true);
  assert.equal(stopped, 1);
  onToggle(click);
  assert.equal(open.get(), false);
});

test("called without an event (a menu item closing the menu) it still toggles, without throwing", () => {
  const open = state(true);
  const onToggle = toggleHandler(open.set);
  assert.doesNotThrow(() => onToggle());
  assert.equal(open.get(), false);
  // An object that isn't a DOM event (e.g. from a programmatic call).
  assert.doesNotThrow(() => onToggle({}));
  assert.equal(open.get(), true);
});
