import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(
  new URL("../../components/chat/composer/environment-row/environment-row.module.css", import.meta.url),
  "utf8",
);

test("an empty trailing slot takes no gap after the right-aligned web chips", () => {
  // The slot hosts the DAG HUD portal and is usually empty; while visible it
  // added a 6px row gap that pushed the web chip off the input box edge.
  assert.match(css, /\.trailingControls:not\(:has\(> :not\(:empty\)\)\)\s*\{\s*display:\s*none;\s*\}/);
});
