import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseHTML } from "linkedom";

import {
  branchTagsSignature,
  contextRangeUnchanged,
  coveragePaintSignature,
  dagInputSignature,
  geometryInputSignature,
  hasAuthoritativeLayout,
  readHistoryEmitGate,
  shouldEmitHistorySvg,
} from "../../lib/runtime-bridge/dag/paint-gate.ts";

const WEB_ROOT = new URL("../../", import.meta.url);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const base = new URL(specifier.slice(2), WEB_ROOT).href;
      const file = `${base}.ts`;
      const url = existsSync(fileURLToPath(file)) ? file : `${base}/index.ts`;
      return { url, shortCircuit: true };
    }
    if (specifier.startsWith(".") && !/\.[a-z]+$/.test(specifier)) {
      const base = new URL(specifier, context.parentURL).href;
      const file = `${base}.ts`;
      const url = existsSync(fileURLToPath(file)) ? file : `${base}/index.ts`;
      return { url, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

test("DAG production TypeScript modules stay below 500 lines", () => {
  const root = fileURLToPath(new URL("../../lib/runtime-bridge/dag", import.meta.url));
  const files = [];
  const visit = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = `${dir}/${name}`;
      if (statSync(path).isDirectory()) visit(path);
      else if (name.endsWith(".ts")) files.push(path);
    }
  };
  visit(root);
  const oversized = files.flatMap((path) => {
    const lines = readFileSync(path, "utf8").split("\n").length;
    return lines > 500 ? [`${path.slice(root.length + 1)}: ${lines}`] : [];
  });
  assert.deepEqual(oversized, []);
});

test("DAG root contains only public entry and core pipeline modules", () => {
  const root = fileURLToPath(new URL("../../lib/runtime-bridge/dag", import.meta.url));
  const rootModules = readdirSync(root)
    .filter((name) => name.endsWith(".ts"))
    .sort();
  assert.deepEqual(rootModules, [
    "index.ts",
    "paint-gate.ts",
    "pipeline.ts",
    "types.ts",
  ]);
});

test("Program internals are folded into the Program thread by default", async () => {
  const { buildThreadModel } = await import(
    "../../lib/runtime-bridge/dag/passes/thread.ts"
  );
  const graph = [
    { id: "ROOT", role: "user", display: "root", _lane: 0, created_at: 0 },
    { id: "program", role: "tool", function: "gui_agent", caller: "",
      predecessor: "ROOT", _lane: 0, created_at: 1 },
    { id: "internal-reply", role: "assistant", caller: "program",
      predecessor: "", _lane: 0, created_at: 2 },
    { id: "internal-step", role: "tool", function: "inspect",
      caller: "internal-reply", predecessor: "", _lane: 0, created_at: 3 },
  ];

  const model = buildThreadModel(graph, "program");

  assert.deepEqual(model.visible.map((node) => node.id), ["ROOT", "program"]);
  assert.deepEqual(
    model.events.program.map((event) => event.id),
    ["internal-reply", "internal-step"],
  );
});

test("Program LLM leaves stay folded even when predecessor is stamped", async () => {
  const { buildThreadModel, isChainNode } = await import(
    "../../lib/runtime-bridge/dag/passes/thread.ts"
  );
  const graph = [
    { id: "ROOT", role: "user", display: "root", _lane: 0, created_at: 0 },
    { id: "program", role: "tool", function: "gui_agent", caller: "",
      predecessor: "ROOT", _lane: 0, created_at: 1 },
    { id: "internal-reply", role: "assistant", caller: "program",
      predecessor: "program", _lane: 0, created_at: 2 },
    { id: "internal-step", role: "tool", function: "inspect",
      caller: "internal-reply", predecessor: "internal-reply",
      _lane: 0, created_at: 3 },
  ];
  const byId = Object.fromEntries(graph.map((node) => [node.id, node]));

  assert.equal(isChainNode(byId["internal-reply"], byId), false);
  const model = buildThreadModel(graph, "program");
  assert.deepEqual(model.visible.map((node) => node.id), ["ROOT", "program"]);
  assert.deepEqual(
    model.events.program.map((event) => event.id),
    ["internal-reply", "internal-step"],
  );
});

test("Program overview projection preserves semantic edges and real forks", async () => {
  const { projectTopPrograms } = await import(
    "../../lib/runtime-bridge/dag/passes/project-programs.ts"
  );
  const graph = [
    { id: "ROOT", role: "user", display: "root", _lane: 0, _tier: 0 },
    { id: "prior", role: "assistant", predecessor: "ROOT", _lane: 0, _tier: 2 },
    { id: "program", role: "tool", function: "gui_agent", caller: "",
      predecessor: "prior", _lane: 6, _tier: 4 },
    { id: "retry", role: "tool", function: "gui_agent", caller: "",
      predecessor: "prior", retry_of: "program", _lane: 8, _tier: 1 },
    { id: "fork", role: "user", predecessor: "prior", _lane: 10, _tier: 1 },
    { id: "fork-reply", role: "assistant", predecessor: "fork",
      _lane: 10, _tier: 2 },
  ];

  const projected = projectTopPrograms(graph);
  const byId = Object.fromEntries(projected.map((node) => [node.id, node]));

  assert.equal(byId.program._overview_parent, "ROOT");
  assert.equal(byId.program._lane, 0);
  assert.equal(byId.program._tier, 1);
  assert.equal(byId.program.predecessor, "prior");
  assert.equal(byId.retry._overview_parent, undefined);
  assert.equal(byId.retry._lane, 8);
  assert.equal(byId.fork._overview_parent, undefined);
  assert.equal(byId.fork._lane, 10);
  assert.equal(byId["fork-reply"].predecessor, "fork");
});

test("cyclic spawn ownership cannot overflow thread or HEAD traversal", async () => {
  const { buildThreadModel } = await import(
    "../../lib/runtime-bridge/dag/passes/thread.ts"
  );
  const { setThreadOpen } = await import(
    "../../lib/runtime-bridge/dag/store/globals.ts"
  );
  const graph = [
    { id: "ROOT", role: "user", display: "root", _lane: 0 },
    { id: "a", role: "user", source: "agent_spawn", predecessor: null,
      caller: "b", _lane: 1 },
    { id: "b", role: "user", source: "agent_spawn", predecessor: null,
      caller: "a", _lane: 2 },
  ];
  setThreadOpen({ a: true, b: true });

  const model = buildThreadModel(graph, "a");

  assert.equal(model.isOpen("a"), false);
  assert.equal(model.isOpen("b"), false);
});

test("equal legacy timestamps attach a clean spawn to the latest Program", async () => {
  const { buildThreadModel } = await import(
    "../../lib/runtime-bridge/dag/passes/thread.ts"
  );
  const graph = [
    { id: "ROOT", role: "user", display: "root", _lane: 0, timestamp: 0 },
    { id: "user", role: "user", predecessor: "ROOT", caller: "ROOT",
      _lane: 0, timestamp: 100 },
    { id: "program", role: "tool", function: "gui_agent", predecessor: "ROOT",
      caller: "", _lane: 0, timestamp: 100 },
    { id: "spawn", role: "user", source: "agent_spawn", predecessor: "ROOT",
      caller: "ROOT", _lane: 2, timestamp: 100 },
  ];

  const model = buildThreadModel(graph, "program");

  assert.equal(model.spawnOwnerOf.spawn, "program");
});

function inputSig(over = {}) {
  return dagInputSignature({
    graph: [{ id: "a", role: "user", predecessor: null, status: "" }],
    headId: "a",
    threadOpen: {},
    summaryExpanded: {},
    locale: "en",
    contextSet: null,
    coverageSet: null,
    sessionId: "s1",
    branchTags: "",
    highlightMode: "viewport",
    ...over,
  });
}

test("coverage compare is a no-op when node_ids / aged / spilled match", () => {
  const prevIds = { a: true, b: true };
  const prevCov = { a: { aged: false, spilled: true }, b: { aged: true, spilled: false } };
  const ids = ["b", "a"];
  const coverage = [
    { node_id: "a", in_context: true, aged: false, spilled: true },
    { node_id: "b", in_context: true, aged: true, spilled: false },
  ];
  assert.equal(contextRangeUnchanged(prevIds, prevCov, ids, coverage), true);
});

test("coverage compare sees membership or aged / spilled change", () => {
  const prevIds = { a: true };
  const prevCov = { a: { aged: false, spilled: false } };
  assert.equal(contextRangeUnchanged(prevIds, prevCov, ["a", "b"], null), false);
  assert.equal(
    contextRangeUnchanged(
      prevIds,
      prevCov,
      ["a"],
      [{ node_id: "a", in_context: true, aged: true, spilled: false }],
    ),
    false,
  );
  assert.equal(
    contextRangeUnchanged(
      prevIds,
      prevCov,
      ["a"],
      [{ node_id: "a", in_context: true, aged: false, spilled: true }],
    ),
    false,
  );
});

test("empty range matches a cleared store", () => {
  assert.equal(contextRangeUnchanged(null, null, null), true);
  assert.equal(contextRangeUnchanged(null, null, []), true);
  assert.equal(contextRangeUnchanged({ a: true }, null, []), false);
  assert.equal(contextRangeUnchanged(null, null, ["a"]), false);
});

test("hidden panel or non-DAG view skips SVG emit", () => {
  assert.equal(shouldEmitHistorySvg("flex", "dag"), true);
  assert.equal(shouldEmitHistorySvg("none", "dag"), false);
  assert.equal(shouldEmitHistorySvg("flex", "session"), false);
  assert.equal(shouldEmitHistorySvg(null, "dag"), false);
});

test("ancestor display:none is treated as hidden", () => {
  const pane = {
    style: { display: "none" },
    getAttribute: (n) => (n === "data-center-view" ? "dag" : null),
    closest(sel) {
      return sel === "[data-center-view]" ? this : null;
    },
    parentElement: null,
  };
  const panel = {
    style: { display: "flex" },
    closest(sel) {
      return sel === "[data-center-view]" ? pane : null;
    },
    parentElement: pane,
  };
  const doc = { getElementById: (id) => (id === "historyPanel" ? panel : null) };
  assert.deepEqual(readHistoryEmitGate(doc), {
    panelDisplay: "none",
    centerView: "dag",
  });
});

test("un-hiding the chat host flushes a pending DAG emit", () => {
  const shell = readFileSync(
    new URL("../../components/app-shell.tsx", import.meta.url),
    "utf8",
  );
  assert.match(shell, /enterExclusiveCoverageMode\(\)/);
  assert.match(
    shell,
    /if \(showChat && sessionPaneIndex >= 0 && activeTabDagView\)/,
  );
});

test("prefetch queue is not keyed on pathname", () => {
  const shell = readFileSync(
    new URL("../../components/app-shell.tsx", import.meta.url),
    "utf8",
  );
  assert.match(shell, /pathnameRef\.current = pathname/);
  assert.match(shell, /route !== pathnameRef\.current/);
  assert.match(shell, /\}, \[router\]\);/);
  assert.doesNotMatch(shell, /\}, \[pathname, router\]\);/);
});

test("input signature is stable when graph and view state match", () => {
  assert.equal(inputSig(), inputSig());
  assert.equal(
    coveragePaintSignature({ a: true }, { a: { aged: true, spilled: false } }),
    coveragePaintSignature({ a: true }, { a: { aged: true, spilled: false } }),
  );
});

test("preview-only graph change does not bust the input signature", () => {
  const a = inputSig({
    graph: [{ id: "a", role: "user", status: "running", preview: "hi" }],
  });
  const b = inputSig({
    graph: [{ id: "a", role: "user", status: "running", preview: "hi there" }],
  });
  assert.equal(a, b);
});

test("thread open, coverage, locale, or status change busts the signature", () => {
  const base = inputSig();
  assert.notEqual(inputSig({ threadOpen: { a: true } }), base);
  assert.notEqual(inputSig({ summaryExpanded: { cap: true } }), base);
  assert.notEqual(inputSig({ locale: "zh" }), base);
  assert.notEqual(
    inputSig({
      contextSet: { a: true },
      coverageSet: { a: { aged: true, spilled: false } },
    }),
    base,
  );
  assert.notEqual(
    inputSig({ graph: [{ id: "a", role: "user", status: "done" }] }),
    base,
  );
  assert.notEqual(inputSig({ headId: "b" }), base);
  assert.notEqual(
    inputSig({ branchTags: branchTagsSignature([{ head_msg_id: "a", name: "main", active: true }]) }),
    base,
  );
  assert.notEqual(
    inputSig({
      graph: [
        { id: "b", role: "assistant", status: "" },
        { id: "a", role: "user", status: "" },
      ],
    }),
    inputSig({
      graph: [
        { id: "a", role: "user", status: "" },
        { id: "b", role: "assistant", status: "" },
      ],
    }),
  );
});

test("cross-session spawn marker change busts the paint signature", () => {
  const base = inputSig();
  assert.notEqual(
    inputSig({
      graph: [{ id: "a", role: "user", status: "", spawn_remote: true }],
    }),
    base,
  );
  assert.notEqual(
    inputSig({
      graph: [{ id: "a", role: "user", status: "", spawn_out: true }],
    }),
    base,
  );
});

test("pipeline compares the input signature before expensive passes or SVG", () => {
  const src = readFileSync(
    new URL("../../lib/runtime-bridge/dag/pipeline.ts", import.meta.url),
    "utf8",
  );
  const renderSrc = src.slice(src.indexOf("export function render("));
  const gate = renderSrc.indexOf("const sig = _inputSignature(graphIn, headIdIn)");
  const skip = renderSrc.search(/if \(sig === _lastSignature\)[\s\S]{0,80}return/);
  const emitGate = renderSrc.indexOf("if (!historySvgEmitAllowed())");
  const patch = renderSrc.indexOf("tryStatusPatch(");
  const merge = renderSrc.indexOf("const merged = _mergeRuns");
  const fold = renderSrc.indexOf("_foldSummaries");
  const thread = renderSrc.indexOf("buildThreadModel(");
  const svg = renderSrc.indexOf('_svg("svg"');
  const replace = renderSrc.indexOf("replaceChildren");
  const attach = renderSrc.indexOf("attachCanvas");
  assert.ok(gate >= 0 && skip >= 0 && emitGate >= 0 && patch >= 0);
  assert.ok(gate < merge && skip < merge && emitGate < merge && patch < merge);
  assert.ok(skip < fold && skip < thread && skip < svg && skip < replace);
  assert.ok(patch < svg && patch < replace && patch < attach);
  assert.match(renderSrc, /if \(tryStatusPatch\([^)]*\)\) return/);
});

test("geometry signature ignores status and is_error", () => {
  const node = { id: "a", role: "user", predecessor: null, _depth: 1, _lane: 0 };
  const a = inputSig({ graph: [{ ...node, status: "running", is_error: false }] });
  const b = inputSig({ graph: [{ ...node, status: "done", is_error: true }] });
  assert.notEqual(a, b);
  assert.equal(
    geometryInputSignature({
      graph: [{ ...node, status: "running", is_error: false }],
      headId: "a",
      threadOpen: {},
      summaryExpanded: {},
      locale: "en",
      contextSet: null,
      coverageSet: null,
      sessionId: "s1",
      branchTags: "",
      highlightMode: "viewport",
    }),
    geometryInputSignature({
      graph: [{ ...node, status: "done", is_error: true }],
      headId: "a",
      threadOpen: {},
      summaryExpanded: {},
      locale: "en",
      contextSet: null,
      coverageSet: null,
      sessionId: "s1",
      branchTags: "",
      highlightMode: "viewport",
    }),
  );
});

test("adding a node or opening a thread breaks the geometry signature", () => {
  const node = { id: "a", role: "user", status: "running", _depth: 1, _lane: 0 };
  const base = geometryInputSignature({
    graph: [node],
    headId: "a",
    threadOpen: {},
    summaryExpanded: {},
    locale: "en",
    contextSet: null,
    coverageSet: null,
    sessionId: "s1",
    branchTags: "",
    highlightMode: "viewport",
  });
  assert.notEqual(
    geometryInputSignature({
      graph: [node, { id: "b", role: "assistant", predecessor: "a", _depth: 2, _lane: 0 }],
      headId: "b",
      threadOpen: {},
      summaryExpanded: {},
      locale: "en",
      contextSet: null,
      coverageSet: null,
      sessionId: "s1",
      branchTags: "",
      highlightMode: "viewport",
    }),
    base,
  );
  assert.notEqual(
    geometryInputSignature({
      graph: [node],
      headId: "a",
      threadOpen: { a: true },
      summaryExpanded: {},
      locale: "en",
      contextSet: null,
      coverageSet: null,
      sessionId: "s1",
      branchTags: "",
      highlightMode: "viewport",
    }),
    base,
  );
});

test("missing depth or lane is not an authoritative layout", () => {
  assert.equal(hasAuthoritativeLayout([{ id: "a", _depth: 1, _lane: 0 }]), true);
  assert.equal(hasAuthoritativeLayout([{ id: "a", _lane: 0 }]), false);
  assert.equal(hasAuthoritativeLayout([{ id: "a", _depth: 1 }]), false);
  assert.equal(
    hasAuthoritativeLayout([{ id: "a", _depth: 1, _lane: 0 }, { id: "b", _lane: 0 }]),
    false,
  );
});

test("status-only patch keeps the SVG root and does not replaceChildren", async () => {
  const { document } = parseHTML(`<!doctype html><html><body>
    <div class="history-body">
      <svg class="history-svg"><g class="history-world"><g class="history-nodes">
        <g class="history-node" data-msg-id="a" transform="translate(30,30)">
          <g class="dag-tile t-shell"><rect data-node-shape="1"></rect></g>
        </g>
      </g></g></svg>
    </div>
  </body></html>`);
  globalThis.document = document;
  const { patchHistoryStatus } = await import(
    "../../lib/runtime-bridge/dag/render/nodes.ts"
  );
  const host = document.querySelector(".history-body");
  const svg = host.querySelector("svg.history-svg");
  let replaced = 0;
  const orig = host.replaceChildren.bind(host);
  host.replaceChildren = (...args) => {
    replaced += 1;
    return orig(...args);
  };
  const ok = patchHistoryStatus(host, [
    { id: "a", status: "running", _depth: 1, _lane: 0 },
  ]);
  assert.equal(ok, true);
  assert.equal(replaced, 0);
  assert.equal(host.querySelector("svg.history-svg"), svg);
  assert.ok(host.querySelector(".history-node").classList.contains("is-running"));
  // A working node gets its agent: the dot and the bubble saying what it does.
  assert.ok(host.querySelector("g.dag-agents .dag-agent-token"));
  assert.ok(host.querySelector("g.dag-agents .dag-agent-bubble"));
  const again = patchHistoryStatus(host, [
    { id: "a", status: "error", is_error: true, _depth: 1, _lane: 0 },
  ]);
  assert.equal(again, true);
  assert.equal(replaced, 0);
  assert.equal(host.querySelector("svg.history-svg"), svg);
  assert.equal(host.querySelector("[data-status-bang]").textContent, "!");
  assert.ok(host.querySelector(".history-node").classList.contains("is-error"));
  assert.equal(host.querySelector("g.dag-agents .dag-agent-bubble"), null);
});

test("each working agent stands on its own step and only belts into work run", async () => {
  const { document } = parseHTML(`<!doctype html><html><body>
    <div class="history-body">
      <svg class="history-svg"><g class="history-world">
        <g class="dag-belts">
          <line class="dag-belt-goods" data-to="u" data-live="self"></line>
          <line class="dag-belt-goods" data-to="a" data-live="self"></line>
          <line class="dag-belt-goods" data-to="sp" data-live="busy"></line>
          <line class="dag-belt-goods" data-to="done" data-live="busy"></line>
        </g>
        <g class="history-nodes">
          <g class="history-node" data-msg-id="u" transform="translate(30,30)">
            <g class="dag-tile t-user"><rect data-node-shape="1"></rect></g></g>
          <g class="history-node" data-msg-id="a" transform="translate(30,70)">
            <g class="dag-tile t-llm"><rect data-node-shape="1"></rect></g></g>
          <g class="history-node" data-msg-id="sp" data-spawn-name="researcher" transform="translate(70,110)">
            <g class="dag-tile t-agent"><rect data-node-shape="1"></rect></g></g>
          <g class="history-node" data-msg-id="done" transform="translate(70,150)">
            <g class="dag-tile t-shell"><rect data-node-shape="1"></rect></g></g>
        </g>
      </g></svg>
    </div>
  </body></html>`);
  globalThis.document = document;
  const { patchHistoryStatus } = await import(
    "../../lib/runtime-bridge/dag/render/nodes.ts"
  );
  const host = document.querySelector(".history-body");
  const ok = patchHistoryStatus(host, [
    { id: "u", role: "user", predecessor: "ROOT", status: "done", _lane: 0 },
    { id: "a", role: "assistant", predecessor: "u", status: "running", _lane: 0, created_at: 1 },
    // A call folded into the turn's count: the bubble still names it.
    { id: "edit", role: "tool", function: "edit", caller: "a", status: "running", _lane: 0, created_at: 2,
      input: JSON.stringify({ path: "b.ts" }) },
    { id: "sp", role: "user", source: "agent_spawn", predecessor: "", caller: "a", status: "done", _lane: 1 },
    { id: "sp-a", role: "assistant", predecessor: "sp", status: "running", _lane: 1, created_at: 3 },
    { id: "done", role: "tool", function: "bash", caller: "a", status: "done", _lane: 0 },
  ]);
  assert.equal(ok, true);
  const bubbles = Array.from(host.querySelectorAll("g.dag-agents .dag-agent-bubble text"))
    .map((t) => t.textContent);
  assert.equal(host.querySelectorAll("g.dag-agents .dag-agent-token").length, 2);
  assert.ok(bubbles.some((t) => t.startsWith("Main agent") && t.includes("b.ts")), bubbles.join(" | "));
  assert.ok(bubbles.some((t) => t.startsWith("researcher")), bubbles.join(" | "));
  const live = Array.from(host.querySelectorAll(".dag-belt-goods.is-live"))
    .map((l) => l.getAttribute("data-to"));
  assert.deepEqual(live, ["a", "sp"]);
});

test("branches_list does not repaint tags before a payload graph", () => {
  const src = readFileSync(
    new URL("../../lib/runtime-bridge/conversations.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    src,
    /if \(Array\.isArray\(payload\.graph\) &&[^\n]+\) \{[\s\S]*?renderHistoryGraph[\s\S]*?\} else \{\s*repaintBranchTags\(\);/,
  );
  assert.doesNotMatch(src, /repaintBranchTags\(\);\s*renderBranchesPanel/);
});

test("a caption steps past a fork line running down where it would start", async () => {
  const { document } = parseHTML(`<!doctype html><html><body>
    <svg><g class="history-world">
      <g class="history-edges">
        <path d="M 70 70 Q 90 70 90 90 L 90 182 Q 90 190 98 190 L 150 190"></path>
      </g>
      <g class="history-nodes">
        <g class="history-node" data-msg-id="t1" transform="translate(70,110)"></g>
        <g class="history-node" data-msg-id="t2" transform="translate(70,230)"></g>
      </g>
      <g class="dag-agents"></g>
    </g></svg>
  </body></html>`);
  globalThis.document = document;
  const call = (id) => ({ id, role: "tool", function: "bash", input: "npm test", caller: "a" });
  for (const id of ["t1", "t2"]) {
    document.querySelector(`[data-msg-id="${id}"]`)._nodeData = call(id);
  }
  const { drawCaptions } = await import("../../lib/runtime-bridge/dag/render/captions.ts");
  const world = document.querySelector(".history-world");
  drawCaptions(world, world.querySelector(".history-nodes"));
  const x = (id) => Number(world.querySelector(`.dag-caption[data-for="${id}"]`).getAttribute("x"));
  // The fork line runs down x=90 past t1's row: the caption starts past it.
  assert.equal(x("t1"), 96);
  // Below the line's end the caption keeps its place beside the tile.
  assert.equal(x("t2"), 90);
});

test("a message's caption reads an attachment as words, not its raw marker", async () => {
  const { tileFor } = await import("../../lib/runtime-bridge/dag/render/tiles.ts");
  const said = (preview) => tileFor({ id: "u", role: "user", preview }).did;
  assert.equal(said('[attachment: a.png (png, 12 KB) @json "/x/a.png"] look at this'), "look at this");
  assert.equal(said('[attachment: Screenshot 1.png (png, 467 KB) @json "/User…'), "Attached Screenshot 1.png");
  assert.equal(said("plain words"), "plain words");
});

test("open threads on different rows share the column beside their anchors", async () => {
  const { computeGeometry } = await import("../../lib/runtime-bridge/dag/layout/geometry.ts");
  const turn = (id, role, predecessor, depth) =>
    ({ id, role, predecessor, _lane: 0, _tier: 0, _depth: depth });
  const byId = {
    u1: turn("u1", "user", "ROOT", 0),
    a1: turn("a1", "assistant", "u1", 1),
    u2: turn("u2", "user", "a1", 2),
    a2: turn("a2", "assistant", "u2", 3),
    t1: { id: "t1", role: "tool", function: "bash", caller: "a1", _lane: 0 },
    t2: { id: "t2", role: "tool", function: "bash", caller: "a2", _lane: 0 },
  };
  const thread = {
    events: { a1: [{ id: "t1", kind: "call" }], a2: [{ id: "t2", kind: "call" }] },
    isOpen: (id) => id === "a1" || id === "a2",
  };
  const geom = computeGeometry(byId, thread);
  assert.equal(geom.threadColOf.a1, 1);
  assert.equal(geom.threadColOf.a2, 1);
  assert.equal(geom.pos.t1.x, geom.pos.t2.x);
});

test("the minimap stays put whatever the view; M turns it off", async () => {
  const { document } = parseHTML(`<!doctype html><html><body><div id="historyPanel">
    <div class="history-body"><svg><g class="history-world"><g class="history-nodes">
      <g class="history-node" transform="translate(0,0)"><g class="dag-tile t-user"></g></g>
      <g class="history-node" transform="translate(0,1000)"><g class="dag-tile t-llm"></g></g>
    </g></g></svg></div>
  </div></body></html>`);
  globalThis.document = document;
  globalThis.window ??= { devicePixelRatio: 1 };
  globalThis.getComputedStyle = () => ({ color: "#123", getPropertyValue: () => "" });
  const { paintMinimap, toggleMinimap } = await import("../../lib/runtime-bridge/dag/interaction/minimap.ts");
  const host = document.querySelector(".history-body");
  const world = document.querySelector(".history-world");
  const jumps = [];
  const jump = (x, y) => jumps.push([x, y]);
  paintMinimap(host, world, { tx: 100, ty: 100, scale: 0.4, w: 800, h: 600 }, jump);
  const map = document.querySelector("#historyPanel > canvas.dag-minimap");
  assert.ok(map, "the map lives beside the graph, outside the host");
  // Whole graph on screen or not, the map is there.
  assert.ok(!map.classList.contains("is-hidden"));
  paintMinimap(host, world, { tx: 100, ty: 100, scale: 1, w: 800, h: 600 }, jump);
  assert.ok(!map.classList.contains("is-hidden"));
  toggleMinimap();
  assert.ok(map.classList.contains("is-hidden"));
  toggleMinimap();
  assert.ok(!map.classList.contains("is-hidden"));
  // Repainting reuses the one canvas.
  assert.equal(document.querySelectorAll("canvas.dag-minimap").length, 1);
});

test("a branch's tag stays under its own tip, not a sibling's in the same lane", async () => {
  const { document } = parseHTML(`<!doctype html><html><body><svg id="s"></svg></body></html>`);
  globalThis.document = document;
  const { drawBadges } = await import("../../lib/runtime-bridge/dag/render/badges.ts");
  const { runtimeState } = await import("../../lib/runtime-bridge/state.ts");
  // u1 → r1 → u2 → r2 (HEAD) on lane 0; a scheduled job's reply jr
  // hangs off r1 on the same lane and is a branch of its own.
  const nodes = {
    u1: { id: "u1", role: "user", predecessor: "ROOT", _lane: 0 },
    r1: { id: "r1", role: "assistant", predecessor: "u1", _lane: 0 },
    ju: { id: "ju", role: "user", caller: "r1", preview: "nightly digest", _lane: 0 },
    jr: { id: "jr", role: "assistant", predecessor: "ju", _lane: 0 },
    u2: { id: "u2", role: "user", predecessor: "r1", preview: "go on", _lane: 0 },
    r2: { id: "r2", role: "assistant", predecessor: "u2", _lane: 0 },
  };
  const at = { u1: [70, 70], r1: [110, 110], jr: [150, 150], u2: [70, 150], r2: [110, 190] };
  const tree = { byId: Object.fromEntries(Object.entries(nodes).filter(([id]) => at[id])) };
  runtimeState._branchesByConv.s = [
    { head_msg_id: "r2", name: "main", is_named: true, active: true },
    { head_msg_id: "jr", name: "jr", active: false },
  ];
  const svg = document.getElementById("s");
  try {
    drawBadges(svg, tree, (n) => ({ x: at[n.id][0], y: at[n.id][1] }), {}, "s", nodes);
  } finally { delete runtimeState._branchesByConv.s; }
  const tags = [...svg.querySelectorAll(".history-branch-tag")].map((t) => t.getAttribute("transform"));
  assert.equal(tags.length, 2);
  const x = (t) => Number(/translate\(([-\d.]+)/.exec(t)[1]);
  const y = (t) => Number(/,([-\d.]+)\)/.exec(t)[1]);
  // Each name sits on its own tip's row, just right of the tile.
  assert.deepEqual([x(tags[1]), y(tags[1])], [170, 150]);
  assert.deepEqual([x(tags[0]), y(tags[0])], [130, 190]);
});

test("the road to HEAD wears HEAD's colour; the branch left behind keeps its own", async () => {
  const { _stampPathLanes } = await import("../../lib/runtime-bridge/dag/layout/assign-lanes.ts");
  const { _branchColor } = await import("../../lib/runtime-bridge/dag/render/shapes.ts");
  const nodes = [
    { id: "ROOT", display: "root", _lane: 0 },
    { id: "u1", role: "user", predecessor: "ROOT", _lane: 0 },
    { id: "a1", role: "assistant", predecessor: "u1", _lane: 0 },
    { id: "t1", role: "tool", function: "bash", caller: "a1", _lane: 0 },
    { id: "u2", role: "user", predecessor: "a1", _lane: 0 },
    { id: "u2b", role: "user", predecessor: "a1", _lane: 1 },
    { id: "a2b", role: "assistant", predecessor: "u2b", _lane: 1 },
  ];
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  _stampPathLanes(byId, "a2b");
  const green = _branchColor(byId.a2b);
  for (const id of ["ROOT", "u1", "a1", "t1", "u2b"]) assert.equal(_branchColor(byId[id]), green, id);
  assert.notEqual(_branchColor(byId.u2), green);
  // Back on the first branch, the shared turns go back to its colour.
  _stampPathLanes(byId, "u2");
  assert.equal(_branchColor(byId.u1), _branchColor(byId.u2));
  assert.notEqual(_branchColor(byId.u2b), _branchColor(byId.u2));
});
