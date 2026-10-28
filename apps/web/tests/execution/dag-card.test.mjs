import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

const WEB_ROOT = new URL("../../", import.meta.url);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const base = new URL(specifier.slice(2), WEB_ROOT).href;
      const file = `${base}.ts`;
      const url = existsSync(fileURLToPath(file)) ? file : `${base}/index.ts`;
      return { url, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { tooltipRows } = await import("../../lib/runtime-bridge/dag/interaction/tooltip-content.ts");
const keys = (rows) => rows.map((r) => r.key);

test("A turn cancelled before it said anything shows its state, not a 1-token guess", () => {
  const rows = tooltipRows({ id: "r1", role: "assistant", status: "cancelled", preview: "" }, null, false);
  assert.ok(!keys(rows).some((k) => k.startsWith("tokens")));
  assert.deepEqual(rows.find((r) => r.key === "status"), { kind: "kv", key: "status", value: "cancelled" });
});

test("A finished node carries no status row", () => {
  const rows = tooltipRows({ id: "r1", role: "assistant", status: "completed", preview: "hi" }, null, false);
  assert.ok(!keys(rows).includes("status"));
});

test("The detail card shows the whole id", () => {
  const id = "2d3eea30_reply_t_call_00_OIw2W4iJXNBX9lbQlVR65676";
  const rows = tooltipRows({ id, role: "tool", name: "bash" }, null, true);
  assert.equal(rows.find((r) => r.key === "id").value, id);
});

test("Every key sits in one fixed column so the values line up", () => {
  const css = readFileSync(new URL("../../app/styles/dag/tooltip.css", import.meta.url), "utf8");
  assert.match(css, /\.history-tooltip-kv-key \{[^}]*flex: none;[^}]*width: 84px;/);
});

test("Every node is one tinted round chip; states restyle the chip, never frame it", () => {
  const vis = readFileSync(new URL("../../lib/runtime-bridge/dag/render/visibility.ts", import.meta.url), "utf8");
  assert.match(vis, /classList\.toggle\("is-covered", visible\)/);
  const tiles = readFileSync(new URL("../../lib/runtime-bridge/dag/render/tiles.ts", import.meta.url), "utf8");
  assert.match(tiles, /_svg\("circle", \{ r: TILE_R, "data-node-shape": "1"/);
  assert.doesNotMatch(tiles, /raised/);
  const css = readFileSync(new URL("../../app/styles/dag/nodes.css", import.meta.url), "utf8");
  // The chip: a tint of its colour mixed into the canvas, so it stays opaque.
  assert.match(css, /\.dag-tile > \[data-node-shape\] \{\s*fill: color-mix\(in srgb, var\(--tone\) 18%, var\(--bg-primary, #191918\)\);/);
  // Selected: the chip fills solid, the icon turns to the canvas colour.
  assert.match(css, /\.history-node\.is-selected \.dag-tile > \[data-node-shape\] \{ fill: var\(--tone\); \}/);
  assert.ok(css.indexOf("is-selected .dag-tile >") > css.indexOf("is-head .dag-tile >"), "selected wins over HEAD");
  const sel = readFileSync(new URL("../../lib/runtime-bridge/dag/interaction/selection.ts", import.meta.url), "utf8");
  assert.match(sel, /g\.classList\.toggle\("is-selected", on\)/);
  assert.doesNotMatch(sel, /dag-select-ring/);
  assert.doesNotMatch(css, /dag-agent-bubble rect/);
  const legend = readFileSync(new URL("../../components/chat/dag-view.tsx", import.meta.url), "utf8");
  assert.match(legend, /className=\{`dag-tile t-\$\{tone\} dag-legend-tile`\}/);
});

test("A session opens readable and framed on HEAD; only the Fit button shows everything", () => {
  const canvas = readFileSync(new URL("../../lib/runtime-bridge/dag/interaction/canvas.ts", import.meta.url), "utf8");
  assert.match(canvas, /const OPEN_MIN_SCALE = 0\.8;/);
  assert.match(canvas, /requestAnimationFrame\(\(\) => fitCanvas\(true\)\)/);
  const view = readFileSync(new URL("../../components/chat/dag-view.tsx", import.meta.url), "utf8");
  assert.match(view, /onClick=\{\(\) => fitCanvas\(\)\}/);
});

test("The fold count steps past an error or cross-session mark on the shoulder", () => {
  const nodes = readFileSync(new URL("../../lib/runtime-bridge/dag/render/nodes.ts", import.meta.url), "utf8");
  assert.match(nodes, /querySelector\("\[data-status-bang\], \[data-corner-mark\]"\)/);
  assert.match(nodes, /String\(TILE_R \+ \(marked \? 10 : 3\)\)/);
  assert.match(nodes, /"data-corner-mark": "1"/);
});
