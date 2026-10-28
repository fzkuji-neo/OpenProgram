/**
 * A sub-agent (a Job in the same session) streams frames stamped with
 * job_id. They build that agent's own transcript for the turn's
 * Sub-agents card and never touch the conversation's rows or bookkeeping.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const base = new URL(`../../${specifier.slice(2)}`, import.meta.url).href;
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

const values = new Map();
globalThis.window = {
  addEventListener: () => {},
  dispatchEvent: () => {},
  location: { pathname: "/chat" },
};
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
};
globalThis.requestAnimationFrame = undefined;

const { useSessionStore } = await import("../../lib/session-store/index.ts");
const { applyChatWsMessage } = await import("../../lib/net/ws/chat-stream.ts");
const { noteJobStatus, promptBody, subAgentChatKey } = await import(
  "../../lib/chat/transcript/sub-agent-transcripts.ts"
);
const { setPendingUserText, getPendingUserText, clearPendingUserText } = await import(
  "../../lib/chat/send/pending-user-text.ts"
);
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const SID = "s_sub";
const frame = (data) => applyChatWsMessage({ type: "chat_response", data: { session_id: SID, ...data } });

test("a sub-agent's stream builds its own transcript, not the conversation's", () => {
  const store = useSessionStore.getState();
  store.setMessages(SID, [
    { id: "u1", role: "user", content: "survey this", status: "done" },
    { id: "u1_reply", role: "assistant", content: "", status: "streaming" },
  ]);
  setPendingUserText(SID, "queued words");
  // The spawn card names the Job and carries its prompt.
  frame({ type: "stream_event", msg_id: "u1", event: {
    type: "sub_agent", card_id: "card1", content: "",
    attach: { session_id: SID, label: "History", status: "running", job_id: "j_a", prompt: "Read the papers" },
  } });
  frame({ type: "stream_event", msg_id: "j_a_user", job_id: "j_a", event: { type: "text", text: "Found " } });
  frame({ type: "stream_event", msg_id: "j_a_user", job_id: "j_a", event: { type: "tool_use", tool: "web_fetch", tool_call_id: "c1", input: "{}" } });
  frame({ type: "stream_event", msg_id: "j_a_user", job_id: "j_a", event: { type: "text", text: "12 papers." } });
  frame({ type: "error", msg_id: "j_a_user", job_id: "j_a", content: "[error] ConnectError", reason: "transport" });

  const s = useSessionStore.getState();
  assert.deepEqual(s.messageOrder[SID], ["u1", "u1_reply"], "the conversation gains no rows");
  const key = subAgentChatKey(SID, "j_a");
  assert.deepEqual(s.messageOrder[key], ["j_a_user", "j_a_user_reply"]);
  assert.equal(s.messagesById.j_a_user.content, "Read the papers");
  const reply = s.messagesById.j_a_user_reply;
  assert.equal(reply.content, "Found 12 papers.");
  assert.equal(reply.status, "error");
  assert.deepEqual(reply.blocks.map((b) => b.type), ["text", "tool", "text"]);
  assert.equal(getPendingUserText(SID), "queued words", "a sub-agent's error is not a rejection of the user's turn");
  assert.equal(s.messagesById.u1_reply.status, "streaming");
  clearPendingUserText(SID);
});

test("a later message to an agent joins that agent's transcript", () => {
  noteJobStatus({ job_id: "j_b", session_id: SID, status: "queued", parent_msg_id: "j_a_user_reply",
    resource: { job_id: "j_b", status: "queued", prompt_summary: "[message from s:x] To reply, use send_message.\n\nAdd edges" } });
  frame({ type: "stream_event", msg_id: "j_b_user", job_id: "j_b", event: { type: "text", text: "Done." } });
  frame({ type: "result", msg_id: "j_b_user", job_id: "j_b", content: "Done." });
  const s = useSessionStore.getState();
  assert.deepEqual(s.messageOrder[subAgentChatKey(SID, "j_a")],
    ["j_a_user", "j_a_user_reply", "j_b_user", "j_b_user_reply"]);
  assert.equal(s.messagesById.j_b_user_reply.status, "done");
  assert.equal(s.messageOrder[subAgentChatKey(SID, "j_b")], undefined);
  assert.deepEqual(promptBody(s.messagesById.j_b_user.content), { text: "Add edges", message: true });
});

test("the conversation's bookkeeping ignores sub-agent frames", () => {
  const handlers = read("lib/runtime-bridge/session/chat-handlers.ts");
  assert.match(handlers, /export function wsHandleChatResponse\(data: ChatResponseData\): void \{\n(\s*\/\/.*\n)+\s*if \(data\.job_id\) return;/);
  const ws = read("lib/net/ws/use-ws.ts");
  assert.match(ws, /case "job_status": \{\n\s*noteJobStatus\(/);
});

test("each turn with spawns shows the Sub-agents card", () => {
  const bubble = read("components/chat/messages/bubbles/assistant-bubble.tsx");
  assert.match(bubble, /<SubAgentsCard cards=\{subAgentCards\} sessionId=\{bubbleSessionId\} \/>/);
  assert.match(bubble, /const subAgentCards = \[\.\.\.attachFifo\];/, "copied before the timeline consumes the queue");
  const card = read("components/chat/messages/cards/sub-agents-card.tsx");
  assert.match(card, /role="tablist"/);
  assert.match(card, /role="tab"\n\s+className="sub-agents-tab-select"/);
  assert.match(card, /<AssistantBubble msg=\{msg\} sessionIdOverride=\{sessionId\} embedded \/>/);
  // The jump goes to the agent's newest reply from its loaded branch; the
  // spawn card's head is only a fallback (Job spawns written before it).
  assert.match(card, /const target = tips\[agent\.key\]\n\s+\|\| await loadSubAgentTranscript\(sessionId, agent\.key, \{ jobId: agent\.jobId, headId: agent\.headId \}\)\n\s+\|\| agent\.headId;/);
  assert.match(card, /head_msg_id: target/);
  // Each tab carries its own round ↗ beside the name, not a header button.
  assert.match(card, /className="sub-agents-tab-select"[\s\S]*?className="sub-agents-tab-go"[\s\S]*?onClick=\{\(\) => void goTo\(agent\)\}/);
  assert.doesNotMatch(card, /Go to agent", "进入子代理"/);
  assert.doesNotMatch(card, /\btitle=/, "tips use data-tip, never a native title");
});

test("on a sub-agent branch the way back comes from the load, not the graph", () => {
  // A bounded load ships graph: [], so the banner and the Spawned-from card
  // read the server's spawned_branch and return to the conversation's
  // newest turn rather than to the spawning reply.
  const banner = readFileSync(new URL("../../components/chat/messages/cards/agent-branch-banner.tsx", import.meta.url), "utf8");
  assert.match(banner, /const spawned = conv\?\.spawned_branch;\n\s+if \(spawned !== undefined\) \{\n\s+if \(!spawned\) return null;/);
  assert.match(banner, /backTarget: spawned\.back_target,/);
  const card = readFileSync(new URL("../../components/chat/messages/cards/spawned-from-card.tsx", import.meta.url), "utf8");
  assert.match(card, /const target = spawned\?\.root_id === msg\.id && spawned\.back_target\n\s+\? spawned\.back_target\n\s+: sf\.callerId;/);
  assert.doesNotMatch(card, /\btitle=\{/);
});
