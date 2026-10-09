import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const controls = fs.readFileSync(
  path.join(webRoot, "components/chat/composer/controls/controls-cluster.tsx"),
  "utf8",
);
const pieces = fs.readFileSync(
  path.join(webRoot, "components/chat/composer/controls/menu-pieces.tsx"),
  "utf8",
);
const css = fs.readFileSync(
  path.join(webRoot, "components/chat/composer/composer.module.css"),
  "utf8",
);

// ── One menu grammar ────────────────────────────────────────────────
// The options (+) menu is the shared radix dropdown on the shared menu
// tokens — no second menu library, no module CSS of its own.
assert.doesNotMatch(controls, /@base-ui-components/, "the options menu must not use Base UI");
assert.match(
  controls,
  /from "@\/components\/ui\/dropdown-menu"/,
  "the options menu must be built on the radix dropdown wrappers",
);
assert.match(
  controls,
  /<DropdownMenuContent[\s\S]*?className=\{cn\(MENU_PANEL,/,
  "the options panel must wear MENU_PANEL",
);
assert.match(
  controls,
  /<DropdownMenuSeparator className=\{MENU_SEPARATOR\} \/>/,
  "separators must be the shared full-bleed MENU_SEPARATOR",
);
assert.match(
  pieces,
  /<DropdownMenuItem[\s\S]*?className=\{cn\(itemCls\(false\), MENU_ITEM_STATES, className\)\}/,
  "options rows must be radix items on the shared itemCls + radix states",
);
assert.match(
  pieces,
  /<span className=\{CHECK_SLOT_PAD\} \/>/,
  "unselected rows must reserve the check column (grammar A)",
);
assert.doesNotMatch(
  css,
  /\.plusMenu/,
  "no .plusMenu* module rules may remain — the panel and rows come from menu-styles",
);

// ── Tool-profile submenu ───────────────────────────────────────────
assert.match(
  controls,
  /<DropdownMenuSub\s+open=\{profileMenuOpen\}\s+onOpenChange=\{setProfileMenuOpen\}>/,
  "Tool Profile must be a radix submenu with React-controlled open state",
);
assert.match(
  controls,
  /<PlusMenuRow[\s\S]*?Use Agent configuration[\s\S]*?switchProfile\("__agent__"\)/,
  "The submenu must default to the current Agent's persistent configuration",
);
const composer = fs.readFileSync(
  path.join(webRoot, "components/chat/composer/index.tsx"),
  "utf8",
);
const toolProfilesHook = fs.readFileSync(
  path.join(webRoot, "components/chat/composer/controls/use-tool-profiles.ts"),
  "utf8",
);
assert.match(toolProfilesHook, /const DEFAULT_PROFILE = "__agent__"/);
assert.match(toolProfilesHook, /settings\.toolsProfile/);
assert.doesNotMatch(
  composer,
  /api\/tool-profiles\/activate/,
  "A session preset must not mutate the global active profile",
);
assert.match(
  controls,
  /<DropdownMenuSubTrigger[\s\S]*?onPointerMove=\{\(e\) => e\.preventDefault\(\)\}/,
  "Tool Profile must open by click, not hover (radix opens sub-menus on pointer rest)",
);
assert.match(
  controls,
  /<DropdownMenuSubContent[\s\S]*?onFocusOutside=\{\(e\) => e\.preventDefault\(\)\}/,
  "Pointer travel over sibling rows must not close Tool Profile",
);
assert.match(
  controls,
  /onPointerDownOutside=\{[\s\S]*?data-tool-profile-trigger[\s\S]*?setProfileMenuOpen\(false\)/,
  "A press anywhere but the gear must close Tool Profile",
);
assert.match(
  controls,
  /role="none"[\s\S]{0,120}<PlusMenuRow[\s\S]*?\/>\s*<DropdownMenuSub\b[^>]*>\s*<DropdownMenuSubTrigger/,
  "Tools and its profile gear must be sibling menuitems (never nested)",
);
assert.doesNotMatch(
  controls,
  /<DropdownMenuSubTrigger[\s\S]{0,600}<PlusMenuRow/,
  "Tool Profile must not nest one menuitem inside another",
);
assert.match(
  controls,
  /toggleTools\(\);\s*setProfileMenuOpen\(false\)/,
  "Activating Tools must close an open profile menu",
);
assert.match(
  controls,
  /h-\[22px\] w-\[22px\]/,
  "The gear must keep its 22px button size",
);
assert.match(
  controls,
  /<ToolProfileIcon size=\{14\} \/>/,
  "The gear must keep its 14px icon",
);
assert.match(
  controls,
  /right-\[32px\]/,
  "The gear sits immediately before the reserved 14px check column (10 + 14 + 8)",
);
assert.match(
  controls,
  /trailing=\{<span className="w-\[22px\] shrink-0" aria-hidden="true" \/>\}/,
  "The Tools row must reserve the gear's width before its check column",
);
assert.match(
  controls,
  /if\s*\(!o\)\s*setProfileMenuOpen\(false\)/,
  "Closing the parent menu must close Tool Profile",
);
assert.match(
  controls,
  /<DropdownMenuContent[\s\S]*?z-\[200\]/,
  "The options menu keeps its z-index of 200",
);
assert.match(
  controls,
  /<DropdownMenuSubContent[\s\S]*?z-\[201\]/,
  "Tool Profile must render above the parent menu",
);
assert.doesNotMatch(
  controls,
  /menuPosition|profileMenuBackdrop/,
  "Tool Profile must not use composer-local fixed positioning",
);
assert.doesNotMatch(
  css,
  /\.profileMenuBackdrop\s*\{/,
  "Tool Profile must not create a composer-local stacking context",
);

console.log("composer tool-profile menu check passed");
