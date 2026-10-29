import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

const WEB_ROOT = new URL("../..", import.meta.url);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const base = new URL(specifier.slice(2), WEB_ROOT).href;
      const file = `${base}.ts`;
      const url = existsSync(fileURLToPath(file)) ? file : `${base}/index.ts`;
      return { url, shortCircuit: true };
    }
    if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier) && context.parentURL) {
      const base = new URL(specifier, context.parentURL).href;
      for (const url of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
        if (existsSync(fileURLToPath(url))) return { url, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
});

const sel = await import("../../lib/runtime-bridge/dag/interaction/selection/selection.ts");
const { deletionTargets } = await import("../../lib/runtime-bridge/dag/interaction/selection/node-delete.ts");

test("One mouse, no tools, and no left rail", () => {
  assert.equal(sel.dagTools, undefined);
  assert.equal(sel.registerTool, undefined);
  const tools = readFileSync(new URL("../../components/chat/dag/dag-tools.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(tools, /Lasso|MousePointer2|setTool|DagToolRail|focusAgent/);
});

test("Every view control is one column of Solar glyphs in the top-right corner", () => {
  const view = readFileSync(new URL("../../components/chat/dag/dag-view.tsx", import.meta.url), "utf8");
  const column = view.slice(view.indexOf("function DagZoomColumn"), view.indexOf("export function DagView"));
  assert.match(column, /zoomStep\(1\)[\s\S]*dag-zoom-readout[\s\S]*zoomStep\(-1\)[\s\S]*setCanvasFullscreen\(!full\)[\s\S]*focusAgent\(\)[\s\S]*<DagLegend \/>[\s\S]*toggleMinimap\(\)[\s\S]*setKeySheet/);
  assert.doesNotMatch(view, /lucide-react/);
  // A frame, not the outward arrows that read as full screen.
  assert.doesNotMatch(view, /Maximize2|createPortal|dagHudSlot/);
  const css = readFileSync(new URL("../../app/styles/dag/panels/tools.css", import.meta.url), "utf8");
  assert.match(css, /\.dag-zoom-column \{[^}]*right: 12px;[^}]*top: 86px;/);
  assert.match(css, /\.dag-minimap \{[^}]*right: 56px;[^}]*top: 12px;/);
  assert.match(css, /\.dag-key-sheet \{[^}]*right: 56px;[^}]*top: 12px;/);
  // The sheet takes the legend's spot under a shown minimap, and the two take turns.
  assert.match(css, /canvas\.dag-minimap:not\(\.is-hidden\)\) \.dag-key-sheet \{[^}]*top: calc\(12px \+ 160px \+ 8px\)/);
  assert.match(view, /if \(sheetOpen\) setOpen\(false\)/);
  assert.match(view, /if \(!open\) setKeySheet\(false\)/);
  // The map, the legend and the sheet are one width.
  const map = readFileSync(new URL("../../lib/runtime-bridge/dag/interaction/view/minimap.ts", import.meta.url), "utf8");
  const legend = readFileSync(new URL("../../app/styles/dag/panels/legend.css", import.meta.url), "utf8");
  assert.match(map, /const W = 280;/);
  assert.match(legend, /\.dag-legend-body \{[^}]*width: 280px;/);
  assert.match(css, /\.dag-key-sheet \{[^}]*width: 280px;/);
  assert.doesNotMatch(css, /\.dag-view > \.dag-tool-rail/);
});

test("Full screen hides the sidebars and the tab strip; Esc, leaving the graph or a reload ends it", async () => {
  const fs = await import("../../lib/runtime-bridge/dag/interaction/view/fullscreen.ts");
  let calls = 0;
  const off = fs.subscribeCanvasFullscreen(() => calls++);
  fs.setCanvasFullscreen(true);
  assert.equal(fs.canvasFullscreen(), true);
  fs.setCanvasFullscreen(true);
  fs.setCanvasFullscreen(false);
  assert.equal(calls, 2);
  off();
  const css = readFileSync(new URL("../../app/styles/dag/panels/tools.css", import.meta.url), "utf8");
  assert.match(css, /html\[data-canvas-fullscreen\] #sidebar,[\s\S]*#rightSidebar[\s\S]*\[data-center-tab-strip\] \{\s*display: none/);
  const strip = readFileSync(new URL("../../components/center-tabs/strip/center-tab-strip.tsx", import.meta.url), "utf8");
  assert.match(strip, /data-center-tab-strip=""/);
  const keys = readFileSync(new URL("../../lib/runtime-bridge/dag/interaction/selection/keys.ts", import.meta.url), "utf8");
  assert.match(keys, /clearSelection\(\);[\s\S]{0,60}\}[\s\S]{0,40}if \(canvasFullscreen\(\)\)[\s\S]{0,60}setCanvasFullscreen\(false\)/);
  const view = readFileSync(new URL("../../components/chat/dag/dag-view.tsx", import.meta.url), "utf8");
  assert.match(view, /else setCanvasFullscreen\(false\);/);
  // Without the sidebars the pane keeps its 7px gap to the window's sides.
  assert.match(css, /html\[data-canvas-fullscreen\] \.center-col \{\s*margin-inline: 7px;/);
});

test("The zoom buttons and keys glide; the wheel and pinch stay immediate", () => {
  const canvas = readFileSync(new URL("../../lib/runtime-bridge/dag/interaction/view/canvas.ts", import.meta.url), "utf8");
  const step = canvas.slice(canvas.indexOf("export function zoomStep"), canvas.indexOf("/** Where the camera can go"));
  assert.match(step, /const base = _glideScale \?\? _viewScale;[\s\S]*glideZoom\(/);
  assert.match(step, /export function resetZoom[\s\S]*glideZoom\([^)]*, 1\)/);
  assert.match(canvas, /function zoomAt\([^)]*\): void \{\s*_glide\?\.stop\(\);/);
  assert.match(canvas, /const s = from \* Math\.pow\(to \/ from, k\);/);
});

test("A mouse wheel zooms, two fingers pan, a right drag pans, a left drag draws a box", async () => {
  const canvas = readFileSync(new URL("../../lib/runtime-bridge/dag/interaction/view/gestures.ts", import.meta.url), "utf8");
  const wheel = canvas.slice(canvas.indexOf('"wheel"'), canvas.indexOf('"pointerdown"'));
  assert.match(wheel, /const kind = wheelKind\(e\);[\s\S]*kind === "pan"[\s\S]*setView\([\s\S]*camera\.zoomAt\(/);
  const { wheelKind } = await import("../../lib/runtime-bridge/dag/interaction/view/wheel.ts");
  const ev = (o) => ({ deltaMode: 0, deltaX: 0, deltaY: 0, ctrlKey: false, metaKey: false, ...o });
  // A mouse notch on macOS Chromium: wheelDeltaY 120, deltaY about -4.
  assert.equal(wheelKind(ev({ timeStamp: 1000, deltaY: -4, wheelDeltaY: 120 })), "zoom");
  assert.equal(wheelKind(ev({ timeStamp: 2000, deltaY: 100, wheelDeltaY: -120 })), "zoom");
  // Two fingers: wheelDeltaY is exactly -3 × deltaY, and the inertial
  // tail keeps panning even when a single event looks like a wheel.
  assert.equal(wheelKind(ev({ timeStamp: 3000, deltaY: 7, wheelDeltaY: -21 })), "pan");
  assert.equal(wheelKind(ev({ timeStamp: 3016, deltaY: 1, wheelDeltaY: 120 })), "pan");
  assert.equal(wheelKind(ev({ timeStamp: 4000, deltaX: 3, deltaY: 0 })), "pan");
  assert.equal(wheelKind(ev({ timeStamp: 5000, deltaY: 3, ctrlKey: true })), "pinch");
  // Line-mode deltas only come from a wheel.
  assert.equal(wheelKind(ev({ timeStamp: 6000, deltaMode: 1, deltaY: 3 })), "zoom");
  assert.match(canvas, /const pans = e\.button === 2 \|\| e\.button === 1;/);
  assert.match(canvas, /if \(!pans\) \{[\s\S]{0,80}new SelectionBand/);
  // A right click that never moved still opens the node's menu.
  assert.match(canvas, /menuAt && !moved[\s\S]{0,120}new MouseEvent\("contextmenu"/);
});

test("The selection bar sits top left, clear of the perspective controls", () => {
  const css = readFileSync(new URL("../../app/styles/dag/panels/tools.css", import.meta.url), "utf8");
  assert.match(css, /\.dag-select-bar \{[^}]*top: 12px;[^}]*left: 12px;/);
});

const box = { left: 10, top: 10, right: 20, bottom: 20 };

test("A marquee selects what it touches, not only what it encloses", () => {
  assert.ok(sel.rectTouchesBox({ left: 18, top: 0, right: 40, bottom: 12 }, box));
  assert.ok(!sel.rectTouchesBox({ left: 21, top: 0, right: 40, bottom: 40 }, box));
});

test("Deleting a spawn square deletes the call that opened it; structure is skipped", () => {
  const graph = [
    { id: "root", display: "root" },
    { id: "u1", role: "user", predecessor: "root" },
    { id: "a1", role: "assistant", predecessor: "u1" },
    { id: "c1", role: "code", caller: "a1" },
    { id: "sp", role: "user", source: "agent_spawn", caller: "c1" },
    { id: "sum", role: "assistant", covers_ids: ["u1"] },
  ];
  const out = deletionTargets(["sp", "root", "sum", "u1"], graph, null);
  assert.deepEqual(out.ids.sort(), ["c1", "u1"]);
  assert.equal(out.skipped, 2);
});

test("A followup reply merged into a glyph goes with it", () => {
  const graph = [
    { id: "a1", role: "assistant" },
    { id: "f1", role: "assistant", source: "job_followup", predecessor: "a1" },
    { id: "u2", role: "user", predecessor: "f1" },
  ];
  const anchorOf = (id) => (id === "f1" ? "a1" : id);
  assert.deepEqual(deletionTargets(["a1"], graph, anchorOf).ids.sort(), ["a1", "f1"]);
});

test("A click selects the node, then runs its own action; Shift/⌘ only toggles", () => {
  const nodes = readFileSync(new URL("../../lib/runtime-bridge/dag/interaction/node/nodes.ts", import.meta.url), "utf8");
  const click = nodes.indexOf("if (e.shiftKey || e.metaKey) {");
  assert.ok(click > 0 && click < nodes.indexOf("showNodeMenu(gn, g)"));
  assert.doesNotMatch(nodes, /activeTool/);
  assert.ok(nodes.indexOf('select([id], "replace");') > click);
  assert.match(nodes, /addEventListener\("dblclick"[\s\S]{0,200}e\.shiftKey \|\| e\.metaKey/);
});

test("The delete and undo replies reach the canvas", () => {
  const ws = readFileSync(new URL("../../lib/net/ws/use-ws.ts", import.meta.url), "utf8");
  assert.match(ws, /case "nodes_deleted":\s*case "nodes_restored":[\s\S]{0,400}"op:dag-nodes"/);
});
