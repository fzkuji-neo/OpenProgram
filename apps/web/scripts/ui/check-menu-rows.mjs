// Every action menu (⋯ buttons, right-click menus, the desktop overlay
// menus) builds its rows from one shared row: a Solar icon on the left,
// then the label, then a key badge, the check or the submenu chevron.
// Keys show as key-cap badges in the system's own notation (⌘T on macOS,
// Ctrl+T elsewhere), never as a bare letter or a hard-coded ⌘.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const parts = read("components/ui/menu-parts.tsx");
assert.match(parts, /export function MenuRow\(/);
assert.match(parts, /<SolarIcon name=\{glyph\}/, "row icons are Solar, the folder icons' family");
assert.match(parts, /export type MenuGlyph = SolarIconName;/);
assert.match(parts, /if \(mac\) return `\$\{keys\.alt \? "⌥" : ""\}\$\{keys\.shift \? "⇧" : ""\}\$\{keys\.mod \? "⌘" : ""\}\$\{key\}`;/);
assert.match(parts, /\[keys\.mod && "Ctrl", keys\.alt && "Alt", keys\.shift && "Shift", key\]/);
assert.match(parts, /<kbd className=\{MENU_KEY\}>/, "a key is a badge");
// Trailing column order: key, check, chevron.
assert.match(parts, /\{keys \? <MenuKey keys=\{keys\} \/> : null\}\s*\{checked === undefined \? null : checked \? <MenuCheck \/>[\s\S]*?\{submenu \? <ChevronRight/);
assert.match(read("components/chat/top-bar/menu-styles.ts"), /export const MENU_KEY =[\s\S]*?rounded-\[5px\][\s\S]*?border/);

const MENUS = [
  "components/sidebar/conv-menu.tsx",
  "components/sidebar/project-menu.tsx",
  "components/chat/view-controls.tsx",
  "components/center-tabs/main-menu.tsx",
  "app/menu-overlay/main-menu/page.tsx",
  "components/center-tabs/tab-context-menu.tsx",
  "components/center-tabs/browser-controls.tsx",
  "components/center-tabs/terminal-context-menu.tsx",
  "components/center-tabs/web-tab-pip.tsx",
  "components/center-tabs/browser-control-bar.tsx",
  "components/center-tabs/builtin-tab-pane.tsx",
  "components/center-tabs/review-tab-pane.tsx",
  "components/files/tree-context-menu.tsx",
  "components/files/file-management.tsx",
  "components/functions/ctx-menu.tsx",
  "components/agents/agents-page.tsx",
  "components/right-sidebar/agents-view-menu.tsx",
];
for (const path of MENUS) {
  const source = read(path);
  assert.match(source, /<MenuRow\b/, `${path} builds its rows from MenuRow`);
  assert.doesNotMatch(source, /className=\{SHORTCUT\}/, `${path} shows keys as MenuKey badges`);
  assert.doesNotMatch(source, /["'>]⌘[A-Z,]/, `${path} writes no ⌘ by hand; MenuKeys picks the system notation`);
}

// Desktop overlay rows carry the same glyph and key fields and draw them
// in the same order; a check is never in the icon slot.
const bridge = read("lib/desktop/desktop-bridge-types.ts");
assert.match(bridge, /glyph\?: MenuGlyph;/);
assert.match(bridge, /keys\?: MenuKeys;/);
const overlay = read("app/menu-overlay/context-menu/page.tsx");
assert.match(overlay, /if \(isMenuGlyph\(item\.glyph\)\) return <MenuIcon glyph=\{item\.glyph\} \/>;/);
assert.equal(overlay.match(/<ItemKeys item=\{item\} \/>\s*<ItemCheck item=\{item\} \/>/g)?.length, 2, "flat and nested rows end with key then check");
const tabMenu = read("components/center-tabs/use-tab-menu.ts");
assert.equal(tabMenu.match(/glyph: "/g)?.length, 8, "every tab menu row has its icon");
assert.match(tabMenu, /id: "tabmenu:close",\s*glyph: "close-square",\s*keys: \{ key: "W", mod: true \}/);

// Two-line rows: icon, text, then the check at the end.
const option = read("components/ui/menu-option-content.tsx");
assert.match(option, /\{glyph \? [\s\S]*?<span className="min-w-0 flex-1 text-left">[\s\S]*?\{typeof checked === "boolean" \?/);

// The chat menus' letters work while the menu is open and show as badges.
const conv = read("components/sidebar/conv-menu.tsx");
const view = read("components/chat/view-controls.tsx");
for (const [source, name] of [[conv, "conv-menu"], [view, "view-controls"]]) {
  for (const key of ["R", "P", "C", "A", "D"]) assert.match(source, new RegExp(`keys=\\{\\{ key: "${key}" \\}\\}`), `${name} shows ${key}`);
}
assert.match(conv, /\{ r: onRename, p: onTogglePin, c: onCopyLink, a: onToggleArchive, d: onDelete \}/);
assert.match(view, /onKeyDown=\{onMenuKey\}/);
assert.match(view, /if \(e\.metaKey \|\| e\.ctrlKey \|\| e\.altKey\) return;/);
// The window menu's shortcuts are the shell's own accelerators.
const mainMenu = read("components/center-tabs/main-menu.tsx");
assert.match(mainMenu, /keys=\{\{ key: "T", mod: true \}\}/);
assert.match(mainMenu, /keys=\{\{ key: ",", mod: true \}\}/);
// Terminal copy/paste follow the terminal's keys: Ctrl+Shift off macOS.
assert.match(read("components/center-tabs/terminal-context-menu.tsx"), /keys=\{\{ key: "C", mod: true, shift: !isMacPlatform\(\) \}\}/);
