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

test("Covered tiles fill with their tone, and the legend uses the canvas tile classes", () => {
  const vis = readFileSync(new URL("../../lib/runtime-bridge/dag/render/visibility.ts", import.meta.url), "utf8");
  assert.match(vis, /classList\.toggle\("is-covered", visible\)/);
  const css = readFileSync(new URL("../../app/styles/dag/nodes.css", import.meta.url), "utf8");
  assert.match(css, /\.history-node\.is-covered \.dag-tile > rect\[data-node-shape\] \{\s*fill: color-mix\(in srgb, var\(--tone\) 24%/);
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
