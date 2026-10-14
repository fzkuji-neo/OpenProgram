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

test("The four canvas tools are registered, hand first, each with its key", () => {
  assert.deepEqual(sel.dagTools().map((t) => [t.id, t.key, t.drag]), [
    ["hand", "h", "pan"],
    ["pointer", "v", "pan"],
    ["marquee", "m", "marquee"],
    ["lasso", "l", "lasso"],
  ]);
  assert.equal(sel.activeTool().id, "hand");
  assert.equal(sel.activeTool().selects, false);
});

test("A new tool is one registration away", () => {
  sel.registerTool({ id: "note", key: "n", selects: false, drag: "pan" });
  assert.ok(sel.dagTools().some((t) => t.id === "note"));
  sel.setTool("note");
  assert.equal(sel.activeTool().id, "note");
  sel.setTool("hand");
});

const box = { left: 10, top: 10, right: 20, bottom: 20 };

test("A marquee selects what it touches, not only what it encloses", () => {
  assert.ok(sel.rectTouchesBox({ left: 18, top: 0, right: 40, bottom: 12 }, box));
  assert.ok(!sel.rectTouchesBox({ left: 21, top: 0, right: 40, bottom: 40 }, box));
});

test("A lasso selects a node it encloses, crosses or passes through", () => {
  const around = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 30 }, { x: 0, y: 30 }];
  assert.ok(sel.lassoTouchesBox(around, box));
  const through = [{ x: 0, y: 15 }, { x: 40, y: 15 }];
  assert.ok(sel.lassoTouchesBox(through, box));
  const near = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 5 }];
  assert.ok(!sel.lassoTouchesBox(near, box));
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

test("Select tools take the click; folding and fork & edit stay with the hand", () => {
  const nodes = readFileSync(new URL("../../lib/runtime-bridge/dag/interaction/nodes.ts", import.meta.url), "utf8");
  const click = nodes.indexOf("if (activeTool().selects) {");
  assert.ok(click > 0 && click < nodes.indexOf("toggleThreadOpen(id)"));
  assert.match(nodes, /addEventListener\("dblclick"[\s\S]{0,200}activeTool\(\)\.selects/);
});

test("The delete and undo replies reach the canvas", () => {
  const ws = readFileSync(new URL("../../lib/net/use-ws.ts", import.meta.url), "utf8");
  assert.match(ws, /case "nodes_deleted":\s*case "nodes_restored":[\s\S]{0,400}"op:dag-nodes"/);
});
