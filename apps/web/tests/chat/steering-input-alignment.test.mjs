import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../../app/styles/chat/stream-blocks.css", import.meta.url), "utf8");

test("a steered input lines up with the other user bubbles", () => {
  // The stream body is inset by --avatar-gutter on both sides; the steered
  // user bubble cancels exactly that inset, never a fixed pixel offset.
  assert.match(css, /\.chat-stream-body\s*\{[^}]*margin-right:\s*var\(--avatar-gutter\)/);
  const rule = css.match(/\.steering-input\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(rule, /margin:\s*12px calc\(-1 \* var\(--avatar-gutter\)\)/);
  assert.doesNotMatch(rule, /-\d+px/);
});
