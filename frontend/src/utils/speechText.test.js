// Run with `npm test` (Node's built-in test runner).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSpeechBlocks } from "./speechText.js";

const CHAPTER = [
  "# Getting started",
  "![A chart of savings](https://res.cloudinary.com/demo/chart.png)",
  "Ada saved every month.",
  "---",
  "She opened an account.",
].join("\n\n");

test("images and rules are rendered (renderBlocks) but never spoken or numbered", () => {
  const { blocks, renderBlocks } = buildSpeechBlocks(CHAPTER);
  assert.deepEqual(
    renderBlocks.map((b) => [b.blockIndex, b.markdown.slice(0, 12)]),
    [
      [0, "# Getting st"],
      [null, "![A chart of"],
      [1, "Ada saved ev"],
      [null, "---"],
      [2, "She opened a"],
    ]
  );
  assert.equal(blocks.length, 3);
});

test("Listen Mode's block numbering is exactly what it was before images were rendered", () => {
  const { blocks, spokenText } = buildSpeechBlocks(CHAPTER);
  assert.deepEqual(
    blocks.map((b) => b.markdown),
    ["# Getting started", "Ada saved every month.", "She opened an account."]
  );
  assert.equal(spokenText, "Getting started Ada saved every month. She opened an account.");
  // Each spoken block's range still points at its own words.
  assert.equal(spokenText.slice(blocks[1].start, blocks[1].end), "Ada saved every month.");
});
