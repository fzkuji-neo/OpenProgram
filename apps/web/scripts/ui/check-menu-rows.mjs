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
assert.match(parts, /<span className=\{MENU_KEY\}>\s*<svg viewBox="12\.858 4 9\.142 16" className=\{MENU_KEY_TIP\}[\s\S]*?<Kbd className=\{MENU_KEY_PLATE\}>\{formatMenuKeys\(keys\)\}<\/Kbd>/, "a key is a price tag: the Solar tip, then the shadcn Kbd");
assert.match(parts, /const TAG_TIP_PATH =\s*"M12\.858 20H10\.221/, "the tip is Solar's tag-horizontal outline");
// Trailing column order: key, check, chevron.
assert.match(parts, /\{keys \? <MenuKey keys=\{keys\} \/> : null\}\s*\{checked === undefined \? null : checked \? <MenuCheck \/>[\s\S]*?\{submenu \? <ChevronRight/);
const keyStyles = read("components/chat/top-bar/menu-styles.ts");
assert.match(keyStyles, /export const MENU_KEY_TIP = "-mr-\[0\.5px\] block h-\[18px\] w-\[10\.3px\] -scale-x-100 fill-\(--menu-key-bg\)";/);
assert.match(keyStyles, /export const MENU_KEY_PLATE =\s*"box-content h-\[18px\] min-w-\[8px\] rounded-none rounded-r-\[5px\] bg-\(--menu-key-bg\) py-0 pr-\[6px\] pl-\[1px\]/);

const MENUS = [
  "components/sidebar/conv-menu.tsx",
  "components/sidebar/project-menu.tsx",
  "components/chat/pane/view-controls.tsx",
  "components/center-tabs/strip/main-menu.tsx",
  "app/menu-overlay/main-menu/page.tsx",
  "components/center-tabs/tab-actions/tab-context-menu.tsx",
  "components/center-tabs/browser/toolbar/browser-controls.tsx",
  "components/center-tabs/pages/terminal-context-menu.tsx",
  "components/center-tabs/pip/web-tab-pip.tsx",
  "components/center-tabs/browser/toolbar/browser-control-bar.tsx",
  "components/center-tabs/pages/builtin-tab-pane.tsx",
  "components/center-tabs/review/review-tab-pane.tsx",
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
const tabMenu = read("components/center-tabs/tab-actions/use-tab-menu.ts");
assert.equal(tabMenu.match(/glyph: "/g)?.length, 8, "every tab menu row has its icon");
assert.match(tabMenu, /id: "tabmenu:close",\s*glyph: "close-square",\s*keys: \{ key: "W", mod: true \}/);

// Two-line rows: icon, text, then the check at the end.
const option = read("components/ui/menu-option-content.tsx");
assert.match(option, /\{glyph \? [\s\S]*?<span className="min-w-0 flex-1 text-left">[\s\S]*?\{typeof checked === "boolean" \?/);

// The chat menus' letters work while the menu is open and show as badges.
const conv = read("components/sidebar/conv-menu.tsx");
const view = read("components/chat/pane/view-controls.tsx");
for (const [source, name] of [[conv, "conv-menu"], [view, "view-controls"]]) {
  for (const key of ["R", "P", "C", "A", "D"]) assert.match(source, new RegExp(`keys=\\{\\{ key: "${key}" \\}\\}`), `${name} shows ${key}`);
}
assert.match(conv, /\{ r: onRename, p: onTogglePin, c: onCopyLink, a: onToggleArchive, d: onDelete \}/);
assert.match(view, /onKeyDown=\{onMenuKey\}/);
assert.match(view, /if \(e\.metaKey \|\| e\.ctrlKey \|\| e\.altKey\) return;/);
// The window menu's shortcuts are the shell's own accelerators.
const mainMenu = read("components/center-tabs/strip/main-menu.tsx");
assert.match(mainMenu, /keys=\{\{ key: "T", mod: true \}\}/);
assert.match(mainMenu, /keys=\{\{ key: ",", mod: true \}\}/);
// Terminal copy/paste follow the terminal's keys: Ctrl+Shift off macOS.
assert.match(read("components/center-tabs/pages/terminal-context-menu.tsx"), /keys=\{\{ key: "C", mod: true, shift: !isMacPlatform\(\) \}\}/);
// A lit row lights its parts: muted icon, key badge and chevron turn
// bright, and the icon pops like the composer's icons.
const styles = read("components/chat/top-bar/menu-styles.ts");
assert.match(styles, /"menu-row flex min-h-7/);
assert.match(styles, /"menu-row-active bg-accent text-text-bright"/);
assert.match(styles, /"menu-row-key inline-flex/);
assert.match(parts, /"menu-row-icon shrink-0 text-text-muted"/);
assert.match(parts, /"menu-row-chevron size-4 shrink-0 text-text-muted"/);
const chips = read("app/styles/chat/composer/top-bar-chips.css");
assert.match(chips, /\.menu-row-key \{\s*--menu-key-bg: color-mix\(in oklab, var\(--text-bright\) 12%, var\(--popover\)\);/, "a resting tag sits above the menu, not sunk in --muted");
const lit = String.raw`:is\(\.menu-row:hover, \.menu-row\[data-highlighted\], \.menu-row\[data-state="open"\], \.menu-row-active\):not\(\[data-disabled\]\)`;
assert.match(chips, new RegExp(`${lit} \\.menu-row-icon \\{\\s*transform: scale\\(1\\.12\\);`));
assert.match(chips, new RegExp(`${lit} \\.menu-row-key \\{[\\s\\S]*?--menu-key-bg: color-mix\\(in oklab, var\\(--text-bright\\) 22%, var\\(--popover\\)\\);`));
assert.match(chips, new RegExp(`${lit} :is\\(\\.menu-row-icon, \\.menu-row-chevron\\)\\.text-text-muted \\{\\s*color: var\\(--text-bright\\);`));
