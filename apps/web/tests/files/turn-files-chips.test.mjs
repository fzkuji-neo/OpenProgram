import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";
import { parseHTML } from "linkedom";

const webRoot = new URL("../../", import.meta.url);
const webPath = dirname(fileURLToPath(new URL("package.json", webRoot)));
const bundleDir = await mkdtemp(join(webPath, ".turn-files-test-"));
after(() => rm(bundleDir, { recursive: true, force: true }));
const bundlePath = join(bundleDir, "turn-files-chips.mjs");
await build({
  absWorkingDir: webPath,
  stdin: {
    contents: [
      'export { TurnFilesChips } from "./components/chat/messages/turn-files-chips.tsx";',
      'export { useSessionStore } from "./lib/session-store/index.ts";',
      'export { setSocket } from "./lib/runtime-bridge/state.ts";',
      'export { useCenterTabs } from "./lib/tabs/center-tabs-store.ts";',
    ].join("\n"),
    resolveDir: webPath,
    sourcefile: "turn-files-chips-entry.ts",
  },
  bundle: true,
  format: "esm",
  jsx: "automatic",
  outfile: bundlePath,
  packages: "external",
  platform: "node",
  tsconfig: join(webPath, "tsconfig.json"),
});

const parsed = parseHTML(
  '<!doctype html><html><body><div id="root"></div></body></html>',
);
globalThis.window = parsed.window;
globalThis.document = parsed.document;
globalThis.Event = parsed.window.Event;
globalThis.CustomEvent = parsed.window.CustomEvent;
globalThis.localStorage = {
  getItem(key) { return key === "agentic_locale" ? "en" : null; },
  setItem() {},
  removeItem() {},
};
globalThis.WebSocket = { OPEN: 1 };
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia = () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
});
Object.defineProperty(window, "location", {
  value: { pathname: "/chat" },
  configurable: true,
});

globalThis.IntersectionObserver = class {
  constructor(callback) { this.callback = callback; }
  observe() {
    queueMicrotask(() => this.callback([{ isIntersecting: true }]));
  }
  disconnect() {}
};

class FakeSocket {
  readyState = WebSocket.OPEN;
  sent = [];
  listeners = new Map();

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  send(payload) {
    this.sent.push(JSON.parse(payload));
  }

  emit(frame) {
    const event = { data: JSON.stringify(frame) };
    for (const listener of [...(this.listeners.get("message") ?? [])]) listener(event);
  }
}

const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { TurnFilesChips, setSocket, useCenterTabs, useSessionStore } = await import(pathToFileURL(bundlePath));

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function latestReviewRequest(socket) {
  return socket.sent.filter((frame) => frame.action === "review_scope").at(-1);
}

function respond(socket, request, data) {
  socket.emit({
    type: "review_scope_result",
    data: {
      action: "review_scope",
      request_id: request.request_id,
      session_id: request.session_id,
      assistant_msg_id: request.assistant_msg_id,
      scope: "turn",
      ...data,
    },
  });
}

test("legacy file cards hide empty results, retry errors, and ignore stale responses", async () => {
  const socket = new FakeSocket();
  setSocket(socket);
  const host = document.querySelector("#root");
  const root = createRoot(host);
  const props = (id) => ({
    key: id,
    assistantMsgId: id,
    sessionIdOverride: "session-1",
    blocks: [{ type: "tool", tool: "apply_patch", is_error: false }],
  });

  await act(async () => { root.render(createElement(TurnFilesChips, props("empty"))); });
  await flush();
  const emptyRequest = latestReviewRequest(socket);
  assert.ok(emptyRequest);
  await act(async () => { respond(socket, emptyRequest, { files: [], file_count: 0 }); });
  assert.equal(host.querySelector(".turn-files-card"), null);
  assert.equal(host.querySelector(".turn-files-review"), null);

  await act(async () => { root.render(createElement(TurnFilesChips, props("error"))); });
  await flush();
  const errorRequest = latestReviewRequest(socket);
  await act(async () => {
    socket.emit({
      type: "operation_error",
      data: {
        action: "review_scope",
        request_id: errorRequest.request_id,
        code: "temporary",
        message: "temporary failure",
      },
    });
  });
  assert.match(host.textContent, /Could not load file changes/);
  assert.equal(host.querySelector(".turn-files-review"), null);
  const beforeRetry = socket.sent.filter((frame) => frame.action === "review_scope").length;
  await act(async () => {
    host.querySelector(".turn-files-load-error button").dispatchEvent(
      new window.Event("click", { bubbles: true }),
    );
  });
  await flush();
  assert.equal(
    socket.sent.filter((frame) => frame.action === "review_scope").length,
    beforeRetry + 1,
  );

  await act(async () => { root.render(createElement(TurnFilesChips, props("old"))); });
  await flush();
  const oldRequest = latestReviewRequest(socket);
  await act(async () => { root.render(createElement(TurnFilesChips, props("current"))); });
  await flush();
  const currentRequest = latestReviewRequest(socket);
  await act(async () => {
    respond(socket, oldRequest, { error: "late failure" });
  });
  assert.equal(host.querySelector(".turn-files-load-error"), null);
  await act(async () => { respond(socket, currentRequest, { files: [], file_count: 0 }); });
  assert.equal(host.textContent, "");

  await act(async () => { root.unmount(); });
  setSocket(null);
});

test("successful legacy summaries survive card remount without loading or repeated requests", async () => {
 const socket=new FakeSocket();setSocket(socket);const host=document.querySelector("#root"),root=createRoot(host);
 const sid="cached-session",id="cached-message";
 useSessionStore.setState({messageOrder:{[sid]:[id]},messagesById:{[id]:{id,role:"assistant",status:"done",content:""}}});
 const props={assistantMsgId:id,sessionIdOverride:sid,blocks:[{type:"tool",tool:"apply_patch",is_error:false}]};
 await act(async()=>root.render(createElement(TurnFilesChips,props)));await flush();
 await act(async()=>respond(socket,latestReviewRequest(socket),{files:[{path:"/repo/a.ts",rel:"a.ts",op:"modify",added:2,removed:1}],file_count:1}));
 assert.match(host.textContent,/a.ts/);
 const order=useSessionStore.getState().messageOrder[sid];let scans=0;
 order.includes=function(...args){scans++;return Array.prototype.includes.apply(this,args);};
 await act(async()=>{for(let i=0;i<100;i++)useSessionStore.setState(s=>({welcomeVisible:!s.welcomeVisible}));});
 assert.equal(scans,0,"unrelated store updates must not rescan unchanged message ownership");
 delete order.includes;
 await act(async()=>root.render(null));
 useSessionStore.getState().setMessages(sid,[{id,role:"assistant",status:"done",content:"Reloaded"}]);
 const count=socket.sent.filter(f=>f.action==="review_scope").length;
 await act(async()=>root.render(createElement(TurnFilesChips,props)));
 assert.match(host.textContent,/a.ts/,"cached summary renders immediately");await flush();
 assert.equal(socket.sent.filter(f=>f.action==="review_scope").length,count);
 await act(async()=>root.unmount());setSocket(null);
});

test("a bounded summary counting more files than it lists never hides the rest", async () => {
  // Regression: "12 files changed" listed 3 rows with no "Show more" control.
  const socket = new FakeSocket();
  setSocket(socket);
  const host = document.querySelector("#root");
  const root = createRoot(host);
  const reviewCalls = [];
  const originalOpenReviewTab = useCenterTabs.getState().openReviewTab;
  useCenterTabs.setState({ openReviewTab: (...args) => { reviewCalls.push(args); } });
  const row = (name) => ({
    path: `/repo/src/${name}`, op: "modify", added: 10, removed: 0,
  });
  const names = [
    "a.ts", "b.tsx", "c.md", "d.json", "e.py", "f.css",
    "g.ts", "h.ts", "i.ts", "j.ts", "k.ts", "l.ts",
  ];
  const summary = {
    version: 2, files: names.slice(0, 3).map(row), file_count: 12,
    added: 120, removed: 0,
  };
  const rowTexts = () => [...host.querySelectorAll(".turn-files-row:not(.turn-files-overflow)")]
    .map((element) => element.textContent);

  await act(async () => {
    root.render(createElement(TurnFilesChips, {
      assistantMsgId: "bounded",
      sessionIdOverride: "bounded-session",
      summary,
    }));
  });
  assert.match(host.textContent, /12 files changed/);
  assert.equal(rowTexts().length, 3);
  const overflow = host.querySelector(".turn-files-overflow");
  assert.ok(overflow, "header count above listed rows must render an overflow row");
  assert.match(overflow.textContent, /and 9 more files — open Review/);
  await act(async () => {
    overflow.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
  assert.deepEqual(reviewCalls.at(-1), ["bounded-session", "bounded", "turn"]);

  // The incomplete summary asks review_scope for the full card list.
  await flush();
  const request = latestReviewRequest(socket);
  assert.ok(request, "a bounded summary loads the full list");
  assert.equal(request.assistant_msg_id, "bounded");
  await act(async () => {
    respond(socket, request, {
      files: names.map(row).map((file) => ({ ...file, rel: file.path.slice(6) })),
      file_count: 12, added: 120, removed: 0,
    });
  });
  assert.equal(host.querySelector(".turn-files-overflow"), null);
  const more = host.querySelector(".turn-files-more");
  assert.match(more.textContent, /Show 9 more files/);
  await act(async () => {
    more.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
  assert.equal(rowTexts().length, 12);
  assert.match(host.textContent, /12 files changed/);

  // Rows carry the Files panel's per-type icons, not one generic glyph.
  const icons = [...host.querySelectorAll(".turn-files-file-icon svg")]
    .map((element) => element.getAttribute("data-file-icon"));
  assert.equal(icons.length, 12);
  assert.equal(icons[0], "typescript");
  assert.ok(new Set(icons).size >= 4, `expected distinct file-type icons, got ${icons}`);

  await act(async () => root.unmount());
  useCenterTabs.setState({ openReviewTab: originalOpenReviewTab });
  setSocket(null);
});
