import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("collapsed rails name their icons on hover, with no native title", () => {
  const tips = read("components/sidebar/rail-tips.tsx");
  assert.match(tips, /const TARGET = "\.sidebar\.collapsed :is\(\.sidebar-nav-item, \[data-rail-tip\]\), \.sidebar \.sidebar-toggle";/);
  assert.match(tips, /className="hover-tip rail-tip/, "the app's own tip look");
  assert.match(read("components/app-shell.tsx"), /<Sidebar \/>\n\s+<RailTips \/>/);
  const left = read("components/sidebar/sidebar.tsx"), right = read("components/right-sidebar/right-sidebar.tsx");
  assert.match(left, /aria-label=\{open \? text\("Hide sidebar", "隐藏侧边栏"\) : text\("Show sidebar", "显示侧边栏"\)\}/);
  assert.match(right, /aria-label=\{open \? text\("Hide panel", "隐藏面板"\) : text\("Show panel", "显示面板"\)\}/);
  assert.doesNotMatch(right, /title=\{text\("(Project files|Agents and programs in this conversation|Session resources)"/);
  assert.doesNotMatch(left + right, /title=\{t\("(sidebar\.toggle|right\.toggle_panel)"\)\}/);
});

test("inline code in a table cell keeps whole words", () => {
  assert.match(read("app/styles/chat/bubbles.css"), /\.message-content :is\(th, td\) code \{ overflow-wrap: normal; \}/);
});

test("provider detail sections never share a React key", () => {
  // Siblings keyed alike made React leave a second API Base URL block behind.
  const detail = read("components/settings/providers/detail.tsx");
  const keys = [...detail.matchAll(/key=\{`\$\{provider\.id\}:([a-z-]+)`\}/g)].map(m => m[1]);
  assert.deepEqual(keys, ["accounts", "base-url", "check"]);
  assert.doesNotMatch(detail, /key=\{provider\.id\}/);
});

test("the user menu names full screen in the interface language", () => {
  assert.match(read("components/user-menu-footer.tsx"), /text\("Full Screen", "全屏"\)/);
});
