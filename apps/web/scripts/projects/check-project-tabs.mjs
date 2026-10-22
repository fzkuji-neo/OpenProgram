// The project detail's four tabs (Chats, Memory, Settings, Info) share one
// layout: head and tabs stay put, the panel fills the rest, and each tab
// scrolls inside it. Settings and Info are built from the Settings page's
// blocks, so their rows, buttons and inputs match Settings exactly.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const page = read("components/projects/projects-page.tsx");
const css = read("components/projects/projects-page.module.css");

// One layout for every tab, not one for Chats/Memory and another for the rest.
assert.match(page, /selected \? styles\.contentFill : undefined/);
assert.match(page, /role="tabpanel"[\s\S]*?className=\{styles\.panelFill\}/);
assert.doesNotMatch(page, /tab === "chats" \|\| tab === "memory"/, "every tab uses the same panel");
assert.match(page, /const TAB_SCROLL = "shadcn-scale [^"]*overflow-y-auto/);
assert.match(css, /\.tabs\s*\{[^}]*margin:\s*8px -24px 0;/s);
for (const gone of [".tabBody", ".sectionTitle", ".fields", ".field "]) {
  assert.ok(!css.includes(`${gone}{`) && !css.includes(`${gone} {`), `${gone} is gone; Settings and Info use SettingsSection`);
}

// Settings and Info: the Settings page's SettingsSection / SettingsRow, Nova controls, no inline styles.
const sections = {
  "components/projects/projects-page.tsx": ["SettingsSection", "SettingsRow"],
  "components/projects/project-config-section.tsx": ["SettingsSection", "SettingsRow", "SimpleSelect"],
  "components/projects/permissions-section.tsx": ["SettingsSection", "SettingsRow", "ManageIconButton", "<Button variant=\"outline\""],
  "components/projects/computer-use-apps-section.tsx": ["SettingsSection", "ManageIconButton", "<Badge"],
};
for (const [file, parts] of Object.entries(sections)) {
  const source = read(file);
  for (const part of parts) assert.ok(source.includes(part), `${file} must use ${part}`);
  assert.ok(!/style=\{\{/.test(source), `${file} carries inline styles; use the shared blocks`);
  // The section tabs themselves keep the Agents tab-bar metrics (role="tab").
  assert.ok(!/<button\b(?![^>]*role="tab")/.test(source), `${file} has a raw <button>; use ui/button`);
}
assert.ok(!/<dl\b/.test(page), "Info is a SettingsSection, not a definition list");

console.log("project tabs: ok");
