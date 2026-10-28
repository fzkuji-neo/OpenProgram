import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// The official shadcn components all come from one style, radix-nova (the
// docs site's). The kit drifted through Luma and Rhea; these pins catch a
// part that slides back to another style's recipe.
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path) => readFileSync(join(root, path), "utf8");

test("every components/ui part names radix-nova, none another style", () => {
  for (const part of ["command", "popover", "tooltip", "tabs", "kbd", "scroll-area", "sidebar", "dialog", "alert-dialog", "breadcrumb"]) {
    const source = read(`components/ui/${part}.tsx`);
    assert.match(source, /radix-nova/, part);
    assert.doesNotMatch(source, /radix-(rhea|luma)/, part);
  }
});

test("popups, tips and tabs carry Nova's recipes", () => {
  const popover = read("components/ui/popover.tsx");
  assert.match(popover, /rounded-lg bg-popover p-2\.5 text-sm text-popover-foreground shadow-\(--popover-shadow\) ring-1 ring-\(color:--popover-ring\)/);
  assert.doesNotMatch(popover, /GLASS_SURFACE/);
  const tooltip = read("components/ui/tooltip.tsx");
  assert.match(tooltip, /rounded-md bg-foreground px-3 py-1\.5 text-xs text-background/);
  assert.match(tooltip, /<TooltipPrimitive\.Arrow/);
  assert.match(read("app/styles/base.css"), /--surface-tooltip: var\(--foreground\);\n\s+--text-on-tooltip: var\(--background\);/);
  assert.match(read("components/ui/tabs.tsx"), /line: "gap-1 bg-transparent"/);
  assert.match(read("components/agents/agents-page.tsx"), /<TabsList variant="line"/);
  assert.match(read("components/ui/kbd.tsx"), /rounded-sm bg-muted px-1 font-sans text-xs font-medium text-muted-foreground/);
  const command = read("components/ui/command.tsx");
  assert.match(command, /from "@\/components\/ui\/dialog"/);
  assert.match(command, /in-data-\[slot=dialog-content\]:rounded-lg!/);
});

test("the rails, the centre card and split panes share Nova's floating corner", () => {
  assert.match(read("components/ui/sidebar.tsx"), /overflow-hidden rounded-lg bg-sidebar shadow-raised/);
  assert.match(read("app/styles/base.css"), /\.app \.center-col \{[^}]*border-radius: var\(--radius-lg\);/);
  assert.match(read("components/center-tabs/canvas/canvas-controls.module.css"), /\.pane \{[^}]*border-radius: var\(--radius-lg\);/);
  assert.match(read("components/center-tabs/canvas/canvas-overview.tsx"), /PANE_RADIUS = 12;/);
});
