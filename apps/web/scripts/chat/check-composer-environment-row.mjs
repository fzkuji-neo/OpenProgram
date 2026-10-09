import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const source = (path) => readFileSync(new URL(path, root), "utf8");

const composer = source("components/chat/composer/index.tsx");
const composerCss = source("components/chat/composer/composer.module.css");
const environmentRow = source(
  "components/chat/composer/environment-row/environment-row.tsx",
);
const compactHook = source(
  "components/chat/composer/environment-row/use-compact-environment-row.ts",
);
const environmentCss = source(
  "components/chat/composer/environment-row/environment-row.module.css",
);

assert.match(composer, /<EnvironmentRow/);
assert.doesNotMatch(composer, /function useCompactEnvironmentRow/);
assert.doesNotMatch(composer, /envChipsRef/);
assert.doesNotMatch(composer, /<StatusChip|<SurfaceChip|<ProjectBadge|<WorkingDirChips|<GoalChip/);
assert.doesNotMatch(composerCss, /\.envChips|\.surfaceChip|\.trailingControls/);

assert.match(environmentRow, /function EnvironmentRow/);
assert.match(environmentRow, /useCompactEnvironmentRow/);
assert.match(environmentRow, /<ConnectionStatusChip/);
assert.match(environmentRow, /<WebSurfaceChip/);
assert.match(environmentRow, /<WebPreviewChip/);
assert.match(environmentRow, /<ProjectBadge/);
assert.match(environmentRow, /<WorkingDirChips/);
assert.match(environmentRow, /<GoalChip/);
assert.match(environmentRow, /trailingControls/);
assert.doesNotMatch(environmentRow, /dagHudSlot|DAG/i);
assert.match(environmentRow, /data-environment-row/);

assert.match(compactHook, /new ResizeObserver\(measure\)/);
assert.match(compactHook, /new MutationObserver/);
// Need = last chip's right edge, not scrollWidth: the right-aligned web
// chip's auto margin makes scrollWidth always equal clientWidth, so a
// squeezed row could never expand again.
assert.doesNotMatch(compactHook, /row\.scrollWidth/);
assert.match(compactHook, /getBoundingClientRect\(\)\.right|box\.right/);
assert.match(environmentCss, /\.envChips\[data-measuring\] > \.surfaceChip[^{]*\{\s*margin-left:\s*0 !important/);
assert.match(compactHook, /row\.clientWidth/);
assert.match(compactHook, /row\.dataset\.compact = "true"/);
assert.match(compactHook, /delete row\.dataset\.compact/);
assert.match(compactHook, /row\.dataset\.squeeze = String\(next\)/);
assert.match(compactHook, /row\.dataset\.measuring = "true"/);
assert.match(readFileSync(new URL("../../app/styles/chat/top-bar-chips.css", import.meta.url), "utf8"), /\.runtime-badge\.folder-pill \{[^}]*align-items: stretch/);
assert.match(environmentCss, /\.envChips\[data-squeeze\][^{]*\.git-seg-label\)[^{]*\{\s*max-width:\s*12ch/);
assert.match(environmentCss, /\.envChips\[data-squeeze="2"\] :global\(\.git-seg-label\)/);
assert.match(environmentCss, /\.envChips\[data-compact="true"\] :global\(\.git-seg-dot\)\s*\{[^}]*width:\s*8px[^}]*opacity:\s*1/);
assert.match(environmentCss, /\.envChips\[data-measuring\][\s\S]*transition:\s*none !important/);

assert.doesNotMatch(environmentCss, /@container/);
assert.doesNotMatch(environmentCss, /flex-shrink:\s*1/);
assert.match(environmentCss, /\.status-badge \.badge-short/);
assert.match(environmentCss, /\.surfaceChipLabel/);
assert.match(environmentCss, /\.project-badge \.badge-short/);
assert.match(environmentCss, /\.workdir-badge \.badge-short/);
assert.match(environmentCss, /\.dag-hud-chip > span/);
assert.match(environmentCss, /\.dag-hud-zoom/);
assert.match(environmentCss, /transition:[\s\S]*max-width 170ms ease[\s\S]*opacity 130ms ease/);
assert.match(environmentCss, /\.envChips\[data-compact="true"\][\s\S]*max-width:\s*0/);
assert.match(environmentCss, /\.envChips\[data-compact="true"\][\s\S]*opacity:\s*0/);
assert.match(environmentCss, /button\.dag-hud-chip[\s\S]*min-width:\s*24px/);
const compactCss = environmentCss.slice(
  environmentCss.indexOf('.envChips[data-compact="true"]'),
  environmentCss.indexOf(".trailingControls"),
);
assert.doesNotMatch(compactCss, /display:\s*none/);

console.log("composer environment-row checks passed");
