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
    if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier) && context.parentURL) {
      const base = new URL(specifier, context.parentURL).href;
      for (const url of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
        if (existsSync(fileURLToPath(url))) return { url, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
});

const sel = await import("../../lib/runtime-bridge/dag/interaction/selection.ts");
const { deletionTargets } = await import("../../lib/runtime-bridge/dag/interaction/node-delete.ts");

test("One mouse, no tools: the rail holds the camera and the key sheet", () => {
  assert.equal(sel.dagTools, undefined);
  assert.equal(sel.registerTool, undefined);
  const rail = readFileSync(new URL("../../components/chat/dag-tools.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(rail, /Lasso|MousePointer2|setTool/);
  assert.match(rail, /focusAgent\(\)[\s\S]*fitCanvas\(\)[\s\S]*setKeySheet/);
});

test("The wheel zooms, a right drag pans, a left drag draws a box", () => {
  const canvas = readFileSync(new URL("../../lib/runtime-bridge/dag/interaction/canvas.ts", import.meta.url), "utf8");
  const wheel = canvas.slice(canvas.indexOf('"wheel"'), canvas.indexOf('"pointerdown"'));
  assert.match(wheel, /zoomAt\(/);
  assert.doesNotMatch(wheel, /setView\(/);
  assert.match(canvas, /const pans = e\.button === 2 \|\| e\.button === 1;/);
  assert.match(canvas, /if \(!pans\) \{[\s\S]{0,80}new SelectionBand/);
  // A right click that never moved still opens the node's menu.
  assert.match(canvas, /menuAt && !moved[\s\S]{0,120}new MouseEvent\("contextmenu"/);
});

test("The selection bar sits top left, clear of the perspective controls", () => {
  const css = readFileSync(new URL("../../app/styles/dag/tools.css", import.meta.url), "utf8");
  assert.match(css, /\.dag-select-bar \{[^}]*top: 8px;[^}]*left: 12px;/);
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
  const nodes = readFileSync(new URL("../../lib/runtime-bridge/dag/interaction/nodes.ts", import.meta.url), "utf8");
  const click = nodes.indexOf("if (e.shiftKey || e.metaKey) {");
  assert.ok(click > 0 && click < nodes.indexOf("showNodeMenu(gn, g)"));
  assert.doesNotMatch(nodes, /activeTool/);
  assert.ok(nodes.indexOf('select([id], "replace");') > click);
  assert.match(nodes, /addEventListener\("dblclick"[\s\S]{0,200}e\.shiftKey \|\| e\.metaKey/);
});

test("The delete and undo replies reach the canvas", () => {
  const ws = readFileSync(new URL("../../lib/net/use-ws.ts", import.meta.url), "utf8");
  assert.match(ws, /case "nodes_deleted":\s*case "nodes_restored":[\s\S]{0,400}"op:dag-nodes"/);
});
