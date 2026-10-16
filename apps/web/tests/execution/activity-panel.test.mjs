import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { parseHTML } from "linkedom";

const webRoot = new URL("../../", import.meta.url);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/execution/use-execution-debugger") return { url: "data:text/javascript,export const useExecutionDebugger = () => globalThis.activityController", shortCircuit: true };
    if (specifier === "@/lib/execution/use-managed-processes") return { url: "data:text/javascript,export const useManagedProcesses = () => globalThis.activityProcesses", shortCircuit: true };
    if (specifier === "./debugger-panel") return { url: "data:text/javascript,export const DebuggerPanel = () => 'DEBUGGER'", shortCircuit: true };
    if (specifier === "@/lib/chat/sub-agent-transcripts") return { url: "data:text/javascript,export const loadSubAgentTranscript = async () => globalThis.agentTip ?? null", shortCircuit: true };
    if (specifier === "@/lib/runtime-bridge/session-load") return { url: "data:text/javascript,export const sendRuntimeCommand = (p) => { (globalThis.sentCommands ||= []).push(p); }", shortCircuit: true };
    if (specifier === "@/lib/runtime-bridge/state") return { url: "data:text/javascript,export const getSocket = () => globalThis.approvalSocket", shortCircuit: true };
    if (specifier.endsWith(".module.css")) {
      return { url: "data:text/javascript,export default {}", shortCircuit: true };
    }
    const base = specifier.startsWith("@/")
      ? new URL(specifier.slice(2), webRoot).href
      : specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)
        ? new URL(specifier, context.parentURL).href : null;
    if (base) {
      for (const suffix of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
        if (existsSync(fileURLToPath(base + suffix))) {
          return { url: base + suffix, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".tsx")) {
      return {
        format: "module", shortCircuit: true,
        source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
          compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
        }).outputText,
      };
    }
    return nextLoad(url, context);
  },
});
const { window } = parseHTML("<!doctype html><html><body></body></html>");
globalThis.window = window;
globalThis.document = window.document;
globalThis.Event = window.Event;
globalThis.CustomEvent = window.CustomEvent;
// Text assertions select a browser preference, independent of the host OS.
globalThis.localStorage = { getItem(key) { return key === "agentic_locale" ? "en" : null; }, setItem() {}, removeItem() {} };
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(0), 0);
globalThis.cancelAnimationFrame = clearTimeout;
window.location = { pathname: "/chat", hash: "", search: "" };
window.history = { replaceState() {}, pushState() {} };
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { RunningPanel } = await import("../../components/right-sidebar/running-panel.tsx");
const DAY = 86400;
const now = Math.floor(Date.now() / 1000);
const run = (id, status, started_at, extra = {}) => ({ execution_id: id, job_id: id, session_id: "session", status, started_at, updated_at: started_at, parent_execution_id: null, effect_summary: {}, task_label: id, capabilities: { pause: false, step: false, steer: false, retry: false, fork: false }, status_version: 1, active_child_ids: [], ...extra });
async function mounted(executions, check, processes = [], stateOverrides = {}, processOverrides = {}) {
  const selected = [];
  globalThis.activityController = { executions, branches: [], connection: { state: "connected" }, fetchedAt: 1, selectExecution(id) { selected.push(id); },
    command: async (command) => { (globalThis.commands ||= []).push(command); return { status: "accepted", command_id: command.command_id }; }, ...stateOverrides };
  globalThis.activityProcesses = { items: processes, calls: [], stale: false, loaded: true, refresh() {}, ...processOverrides };
  globalThis.commands = []; globalThis.sentCommands = [];
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(RunningPanel, { active: true, sessionId: "session" })));
    const click = async text => {
      const button = [...host.querySelectorAll("button, [role=button]")].find(b => b.textContent.includes(text));
      assert.ok(button, text);
      await act(async () => button.click());
    };
    await check(host, click, selected);
  } finally { await act(async () => root.unmount()); host.remove(); }
}

const agentCall = { id: "c1", execution_id: "turn", name: "agent", description: "Fix page close",
  prompt: "Inspect the close branch and fix it", command: "", started_at: now - 3 * DAY, status: "unknown" };
const spawned = run("j_fix", "reconciliation_required", now - 3 * DAY + 2, { parent_execution_id: "turn",
  display: { kind: "job_agent", label: "Fix_page_close", assistant_message_id: "j_fix_user_reply" }, effect_summary: { provider_response_incomplete: true } });

test("the overview reads: what needs you, what is running, what ran before", async () => {
  await mounted([
    run("turn", "reconciliation_required", now - 3 * DAY, { task_label: "check and fix it" }), spawned,
    run("live", "running", now - 120, { task_label: "fill the form" }),
    run("done", "completed", now - 60, { task_label: "what happened" }),
  ], async host => {
    const text = host.textContent;
    assert.match(text, /Needs you1.*Fix page close.*Sub-agent result unconfirmed/s);
    assert.match(text, /Running1.*fill the form.*Running/s);
    assert.match(text, /Earlier2.*Today.*what happened.*Completed/s);
    // One concrete issue, not the conversation, and no branch layer.
    assert.equal(text.split("Fix page close").length - 1, 1);
    assert.doesNotMatch(text, /Execution history|Branch 1/);
    // No group folds.
    assert.equal(host.querySelectorAll("[aria-expanded]").length, 0);
  }, [], {}, { calls: [agentCall] });
});

test("an unconfirmed agent call opens a page with its task and what can be done", async () => {
  globalThis.agentTip = "j_fix_tip";
  await mounted([run("turn", "reconciliation_required", now - 3 * DAY, { task_label: "check and fix it" }), spawned], async (host, click) => {
    await click("Fix page close");
    const text = host.textContent;
    assert.match(text, /Sub-agent ·/);
    assert.match(text, /Result unconfirmed/);
    assert.match(text, /whether it finished is not known/);
    assert.match(text, /Task given to it.*Inspect the close branch/s);
    assert.match(text, /From.*check and fix it/s);
    await click("Open its conversation");
    assert.deepEqual(globalThis.sentCommands.map(c => c.action), ["checkout_branch", "load_session"]);
    assert.equal(globalThis.sentCommands[0].head_msg_id, "j_fix_tip");
    await click("End this run");
    assert.equal(globalThis.commands[0].action, "execution.cancel");
    assert.equal(globalThis.commands[0].execution_id, "turn");
    // Back goes up one level, to the overview.
    await click("Activity");
    assert.match(host.textContent, /Needs you1/);
  }, [], {}, { calls: [agentCall] });
  delete globalThis.agentTip;
});

test("a run page shows its issue first, then what it did, then technical details", async () => {
  await mounted([run("turn", "reconciliation_required", now - 3 * DAY, { task_label: "check and fix it" }), spawned,
    run("j_other", "completed", now - 3 * DAY + 50, { parent_execution_id: "turn", display: { kind: "job_agent", label: "Write_docs" } })],
  async (host, click, selected) => {
    await click("check and fix it");
    const text = host.textContent;
    assert.match(text, /Run ·.*check and fix it.*1 to handle/s);
    assert.match(text, /Sub-agent "Fix page close": result unconfirmed.*What this run did.*Fix page close.*Write docs.*Technical details/s);
    // The sub-agent the agent call started is reached through the call, not listed twice.
    assert.doesNotMatch(text, /Fix_page_close/);
    await click("Write docs");
    assert.match(host.textContent, /← check and fix it/);
    await click("Technical details");
    assert.deepEqual(selected, ["j_other"]);
    assert.match(host.textContent, /DEBUGGER/);
  }, [], {}, { calls: [agentCall] });
});

test("earlier runs are grouped by day and paged", async () => {
  const runs = Array.from({ length: 25 }, (_, i) => run(`r${i}`, "completed", now - i * 60 - (i > 2 ? 2 * DAY : 0)));
  await mounted(runs, async (host, click) => {
    assert.match(host.textContent, /Earlier25/);
    assert.match(host.textContent, /Today.*r0/s);
    assert.equal(host.querySelectorAll("button").length, 21, "20 runs and the paging button");
    await click("Show 5 earlier");
    assert.doesNotMatch(host.textContent, /Show \d+ earlier/);
  });
});

test("ongoing shell calls and background programs appear without opening a run", async () => {
  await mounted([], async (host, click) => {
    assert.match(host.textContent, /Running2/);
    assert.match(host.textContent, /bash/);
    assert.doesNotMatch(host.textContent, /Tasks and their programs will appear|will appear here/);
    await click("bash");
    assert.match(host.textContent, /Command.*sleep 30/s);
  }, [{ id: "proc", command: "python worker.py", status: "running", started_at: now, backend_id: "local" }], {},
  { calls: [{ id: "call", name: "bash", command: "sleep 30", started_at: now - 5, status: "running" }] });
});

test("run titles read as the words a person wrote, not attachment markup or resume prompts", async () => {
  await mounted([
    run("a", "completed", now - 10, { task_label: '[attachment: IMG_0177.JPG (jpg, 987 KB) @json "/Users/x/attachments/IMG_0177.JPG" ' }),
    run("b", "completed", now - 20, { task_label: '[attachment: Inv.pdf (pdf, 112 KB) @json "/Users/x/Inv.pdf"] what about this?' }),
    run("c", "completed", now - 30, { task_label: "Continue the interrupted task using saved conversation history. Inspect actual state" }),
  ], async host => {
    const text = host.textContent;
    assert.match(text, /Attachment IMG_0177\.JPG/);
    assert.match(text, /what about this\?/);
    assert.match(text, /Continue the interrupted task(?! using)/);
    assert.doesNotMatch(text, /\[attachment:|@json/);
  });
});

test("calls do not flash as unowned before the executions are read", async () => {
  await mounted([], async host => {
    assert.doesNotMatch(host.textContent, /Needs you|Fix page close/);
  }, [], { fetchedAt: null }, { calls: [agentCall] });
});

test("Activity never flashes an error for loading, reconnection, or another conversation's failure", async () => {
  for (const connection of [{state:"reconnecting"}, {state:"gap"}, {state:"stale"}, {state:"stale",message:"previous failure",errorSessionId:"other"}]) {
    await mounted([], async host => {
      assert.doesNotMatch(host.textContent, /statuses are unavailable|Could not load activity/);
    }, [], {connection,fetchedAt:null}, {loaded:true});
  }
});
test("Activity reports continuing read failures without replacing saved records", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const processFailed of [false,true]) await mounted([], async host => {
    await act(async () => { t.mock.timers.tick(5000); });
    assert.match(host.textContent, /Updating status.*Showing saved records/);
  }, [], {connection: processFailed ? {state:"connected"} : {state:"stale",message:"request failed",errorSessionId:"session"}}, {stale:processFailed});
});

test("Activity rows use a bare coloured glyph and a status dot, and lift on hover", async () => {
  const css = readFileSync(new URL("../../components/right-sidebar/running-panel.module.css", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../../components/right-sidebar/running-panel.tsx", import.meta.url), "utf8");
  const rule = (name) => (new RegExp(`\\.${name} \\{([^}]*)\\}`).exec(css) || [])[1] || "";
  for (const name of ["glyph", "prose", "code"]) {
    assert.doesNotMatch(rule(name), /background|border:|box-shadow/, `${name} draws no surface`);
  }
  assert.match(css, /\.row:hover \{ background: var\(--bg-input\); box-shadow: var\(--composer-shadow-focus\);/);
  assert.match(panel, /<SolarIcon name=\{name\} size=\{16\} motionPreset="none" \/>/);
  assert.match(panel, /className=\{`indicator-dot sm \$\{DOT\[tone\]\}`\}/);
  assert.doesNotMatch(panel, /<details|collapsible=\{true\}|collapsible\b(?!=\{false\})/, "nothing expands in place or folds");
});
