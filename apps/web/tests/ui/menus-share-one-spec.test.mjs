import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Hand-copied menu frames drifted from the shared spec and rendered at
// 7/8 size on the 14px root; every menu now takes the shared classes.
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path) => readFileSync(join(root, path), "utf8");

test("the shared menu panel and the Select popup render at the docs' scale", () => {
  assert.match(read("components/chat/top-bar/menu-styles.ts"), /export const MENU_PANEL =[^;]*?"shadcn-scale /);
  assert.match(read("components/ui/select.tsx"), /"shadcn-scale relative z-\[130\]/);
});

test("menus are Nova's solid popover with a visible highlight, icons unshifted", () => {
  const spec = read("components/chat/top-bar/menu-styles.ts");
  assert.match(spec, /"bg-popover text-popover-foreground shadow-\(--popover-shadow\) ring-1 ring-\(color:--popover-ring\)"/);
  assert.doesNotMatch(spec, /GLASS_MATERIAL/);
  assert.doesNotMatch(spec, /-ms-\[3px\]/);
  assert.match(spec, /hover:bg-accent/);
  assert.match(spec, /data-\[highlighted\]:bg-accent/);
  assert.match(read("app/globals.css"), /--accent: color-mix\(in oklab, var\(--foreground\) 9%, transparent\)/);
});

test("right-click menus are the Nova ContextMenu on the shared recipes", () => {
  const kit = read("components/ui/context-menu.tsx");
  assert.match(kit, /radix-nova/);
  assert.match(kit, /cn\(MENU_PANEL, MENU_MOTION/);
  assert.match(kit, /itemCls\(false, variant === "destructive"\),\n\s+MENU_ITEM_STATES/);
  for (const user of ["components/functions/card/ctx-menu.tsx", "components/center-tabs/pages/terminal-context-menu.tsx"]) {
    assert.match(read(user), /from "@\/components\/ui\/context-menu"/, user);
  }
});

test("footer and tab menus use the shared classes, not their own copies", () => {
  for (const [tsx, css] of [
    ["components/user-menu-footer.tsx", "components/user-menu-footer.module.css"],
    ["components/center-tabs/tab-actions/tab-context-menu.tsx", "components/center-tabs/strip/center-tabs.module.css"],
  ]) {
    const source = read(tsx);
    assert.match(source, /MENU_PANEL/, tsx);
    assert.match(source, /itemCls\(false\)/, tsx);
    const styles = read(css);
    assert.doesNotMatch(styles, /--glass-surface[\s\S]{0,400}border-radius: 1rem/, css);
    assert.doesNotMatch(styles, /padding: 0\.375rem 0\.5rem/, css);
    // An unlayered background on the row class would hide itemCls's hover fill.
    for (const row of [".item {", ".tabMenuItem {"]) {
      const at = styles.indexOf(row);
      if (at !== -1) assert.doesNotMatch(styles.slice(at, styles.indexOf("}", at)), /background/, `${css} ${row}`);
    }
  }
});

test("folder and project pill segments space like the sm Button chips", () => {
  const css = read("app/styles/chat/composer/top-bar-chips.css");
  const at = css.indexOf(".folder-pill-seg {");
  const body = css.slice(at, css.indexOf("}", at));
  assert.match(body, /gap: 0\.25rem/);
  assert.match(body, /padding: 0 0\.625rem/);
  assert.match(css, /\.folder-pill-seg svg \{ width: 0\.875rem; height: 0\.875rem;/);
});
