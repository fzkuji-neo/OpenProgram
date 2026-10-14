import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { canPreview, hunkRange, lineCommentText, reviewHunks, reviewRows } from "../../components/center-tabs/review-diff-rows.ts";

const newFile = [
  "--- a/A4_Promo/note.md",
  "+++ b/A4_Promo/note.md",
  "@@ -0,0 +1,3 @@",
  "+# Title",
  "+",
  "+A long line that the pane wraps instead of cutting off",
].join("\n");

test("Review drops the file headers the pane header already shows", () => {
  const rows = reviewRows(newFile);
  assert.deepEqual(rows.map((row) => row.kind), ["hunk", "add", "add", "add"]);
  assert.deepEqual(rows.slice(1).map((row) => row.newNo), ["1", "2", "3"]);
});

test("A hunk reads as the line range it covers", () => {
  assert.deepEqual(hunkRange("@@ -0,0 +1,232 @@"), { from: 1, to: 232, context: "" });
  assert.deepEqual(hunkRange("@@ -10,4 +12,6 @@ def handler():"), { from: 12, to: 17, context: "def handler():" });
  // A deleted file has no new lines; count the old side.
  assert.deepEqual(hunkRange("@@ -1,5 +0,0 @@"), { from: 1, to: 5, context: "" });
  assert.deepEqual(hunkRange("@@ -3 +3 @@"), { from: 3, to: 3, context: "" });
  assert.equal(hunkRange("not a hunk"), null);
});

test("A missing newline note stays; renames and modes are dropped", () => {
  const rows = reviewRows([
    "diff --git a/x.py b/x.py",
    "index 1..2 100644",
    "@@ -1 +1 @@",
    "-a",
    "+b",
    "\\ No newline at end of file",
  ].join("\n"));
  assert.deepEqual(rows.map((row) => row.kind), ["hunk", "del", "add", "meta"]);
});

test("Documents and images offer a rendered preview; deleted files do not", () => {
  assert.equal(canPreview({ path: "/w/A4_Promo/宣传稿.md", op: "add" }), true);
  assert.equal(canPreview({ path: "/w/figure.png", op: "modify" }), true);
  assert.equal(canPreview({ path: "/w/paper.pdf", op: "modify" }), true);
  assert.equal(canPreview({ path: "/w/app.py", op: "modify" }), false);
  assert.equal(canPreview({ path: "/w/old.md", op: "delete" }), false);
});

test("Narrow panes fold the file list into the header switcher", () => {
  const css = readFileSync(new URL("../../components/center-tabs/review-tab-pane.module.css", import.meta.url), "utf8");
  assert.match(css, /\.page\{container:review\/inline-size/);
  assert.match(css, /\.files\{display:none/);
  assert.match(css, /@container review \(min-width: 900px\)\{[^}]*\.body\{grid-template-columns:260px minmax\(0,1fr\)\}\s*\.files\{display:block\}\s*\.switcher\{display:none\}/);
});

test("Pages in the centre card take the chat's warm white in beige-light", () => {
  const css = readFileSync(new URL("../../app/styles/themes/beige-light.css", import.meta.url), "utf8");
  const block = css.match(/\[data-theme="beige-light"\] \.page-col,\s*\[data-theme="beige-light"\] \[data-page-surface\] \{([^}]*)\}/);
  assert.ok(block, "scoped page surface block");
  assert.match(block[1], /--bg-secondary: #fbfaf8;/);
  assert.match(block[1], /--bg-tertiary: #f3f1ec;/);
  for (const token of ["--card", "--secondary", "--muted"]) assert.match(block[1], new RegExp(`${token}: var\\(`));
  const shell = readFileSync(new URL("../../components/app-shell.tsx", import.meta.url), "utf8");
  assert.match(shell, /data-page-surface=\{pane\.kind === "peer" \? undefined : ""\}/);
});

test("Review asks again when the socket reconnects and shows load states in narrow panes", () => {
  const pane = readFileSync(new URL("../../components/center-tabs/review-tab-pane.tsx", import.meta.url), "utf8");
  assert.match(pane, /addEventListener\("op:browser-connection", reconnect\)/);
  assert.match(pane, /\{!selected \? \([\s\S]*?scopeState\.loading[\s\S]*?scopeState\.error/);
});

test("a Review pane mounting again shows what it last loaded and refreshes quietly", async () => {
  const pane = readFileSync(new URL("../../components/center-tabs/review-tab-pane.tsx", import.meta.url), "utf8");
  assert.match(pane, /const \[memory\] = useState\(\(\) => remembered\.get\(memoryKey\)\);/);
  assert.match(pane, /useState<ScopeState>\(\(\) => memory\?\.scopeState \?\? \{/, "it starts from the remembered files");
  assert.match(pane, /if \(quiet\.current\.scope\) quiet\.current\.scope = false;\n    else setScopeState/, "the first reload keeps them on screen");
  assert.match(pane, /if \(!same\) setDiffState\(\{ loading: true, path: selectedPath \}\);/, "the same file's diff stays up while it reloads");
  assert.match(pane, /if \(remembered\.size > MEMORY_LIMIT\)/, "the memory is bounded");
});

test("Each hunk carries its old and new sides for a revert", () => {
  const hunks = reviewHunks([
    "--- a/x.py",
    "+++ b/x.py",
    "@@ -1,3 +1,3 @@ def f():",
    " keep",
    "-old",
    "+new",
    " tail",
    "@@ -10,2 +10,1 @@",
    " ctx",
    "-gone",
  ].join("\n"), "modify");
  assert.deepEqual(hunks, [
    { new_start: 1, old_lines: ["keep", "old", "tail"], new_lines: ["keep", "new", "tail"], revertible: true },
    { new_start: 10, old_lines: ["ctx", "gone"], new_lines: ["ctx"], revertible: true },
  ]);
});

test("Cut, staged, newline-less and whole-file hunks cannot be reverted", () => {
  // The page ends before the hunk's counted lines do.
  assert.equal(reviewHunks("@@ -1,3 +1,3 @@\n a\n-b", "modify")[0].revertible, false);
  // A continuation page starts with a synthetic header and no counts that fit.
  assert.equal(reviewHunks("@@ -5 +5 @@\n a\n b", "modify")[0].revertible, false);
  const staged = reviewHunks([
    "--- a/x.py [base-to-index]", "+++ b/x.py [base-to-index]", "@@ -1 +1 @@", "-a", "+b",
    "--- a/x.py [index-to-worktree]", "+++ b/x.py [index-to-worktree]", "@@ -1 +1 @@", "-b", "+c",
  ].join("\n"), "modify");
  assert.deepEqual(staged.map((hunk) => hunk.revertible), [false, true]);
  assert.equal(reviewHunks("@@ -1 +1 @@\n-a\n+b\n\\ No newline at end of file", "modify")[0].revertible, false);
  assert.equal(reviewHunks("@@ -0,0 +1 @@\n+new", "add")[0].revertible, false);
});

test("A line comment names the file and line and quotes the code", () => {
  assert.equal(
    lineCommentText("src/x.py", { kind: "add", text: "+return 1", oldNo: "", newNo: "12" }, "  why 1? "),
    "`src/x.py` line 12:\n> return 1\nwhy 1?",
  );
  assert.equal(
    lineCommentText("src/x.py", { kind: "del", text: "-x = 2", oldNo: "7", newNo: "" }, "keep this"),
    "`src/x.py` line 7 (removed):\n> x = 2\nkeep this",
  );
});
