import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { centerTabStripEntries, placeDockedTabs } from "../../lib/tabs/center-tab-groups.ts";

const ids = (tabs) => tabs.map((tab) => tab.id);
const tabs = ["a", "b", "c", "d"].map((id) => ({ id }));

test("A merged split keeps the slot of the window it joined", () => {
  // b dropped on the left of d: the split's first pane is b.
  const ordered = placeDockedTabs(tabs, ["b"], "d");
  assert.deepEqual(ids(ordered), ["a", "c", "b", "d"]);
  const entries = centerTabStripEntries({ tabIds: ids(ordered), groups: [{ id: "g", memberIds: ["b", "d"], visibleIds: ["b", "d"], focusedId: "b" }] });
  assert.deepEqual(entries.map((e) => e.id), ["tab:a", "tab:c", "group:g"]);
});

test("Docking leaves the order alone when the anchor itself moves or is missing", () => {
  assert.deepEqual(ids(placeDockedTabs(tabs, ["d"], "d")), ["a", "b", "c", "d"]);
  assert.deepEqual(ids(placeDockedTabs(tabs, ["b"], "zz")), ["a", "b", "c", "d"]);
  assert.deepEqual(ids(placeDockedTabs(tabs, ["d", "a"], "b")), ["d", "a", "b", "c"]);
});

test("A tab dragged out of the strip closes its slot and reopens it on return", () => {
  const drag = readFileSync(new URL("../../components/center-tabs/use-tab-pointer-drag.ts", import.meta.url), "utf8");
  assert.match(drag, /drag\.element\.style\.visibility = "hidden";[\s\S]*?drag\.element\.setAttribute\("data-drag-out", "true"\);/);
  assert.match(drag, /\/\/ Back over the strip[^\n]*\n\s*drag\.element\.removeAttribute\("data-drag-out"\);/);
  assert.match(drag, /restorePointerDragElement\(element, false, true\);/, "a merge drop keeps the slot closed while it commits");
  assert.match(drag, /restorePointerDragElement\(element, true, true\);/, "so does a move to another window");
  const css = readFileSync(new URL("../../components/center-tabs/center-tabs.module.css", import.meta.url), "utf8");
  assert.match(css, /\.tab\[data-drag-out="true"\][\s\S]*?\{\s*flex-basis: 0;\s*width: 0;\s*min-width: 0;\s*max-width: 0;/);
  assert.match(css, /\.tab\[data-pointer-drag="true"\],\n\.compoundTab\[data-pointer-drag="true"\] \{\n[^}]*flex-basis 160ms ease/, "the slot closes and reopens smoothly during the drag");
  assert.match(css, /\.tab\[data-slot-reopen="true"\][\s\S]*?transform 160ms ease;/, "and after it");
  assert.doesNotMatch(css, /\.tab\[data-pointer-drag="true"\][^{]*\{[^}]*transition: none/, "no later drag rule switches the slot transition off");
});

test("A split tab's name rises in when the pane it names changes", () => {
  const items = readFileSync(new URL("../../components/center-tabs/tab-items.tsx", import.meta.url), "utf8");
  assert.match(items, /const shownId = useRef<string \| null>\(fresh \? null : canonicalTab\?\.id \?\? null\);/);
  assert.match(items, /for \(const el of \[name\.previousElementSibling, name\]\)/);
  const strip = readFileSync(new URL("../../components/center-tabs/center-tab-strip.tsx", import.meta.url), "utf8");
  assert.match(strip, /fresh=\{freshGroupIds\.has\(entry\.group\.id\)\}/);
});
