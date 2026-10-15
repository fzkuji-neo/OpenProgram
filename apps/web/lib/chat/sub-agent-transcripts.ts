/**
 * Sub-agent transcripts.
 *
 * A sub-agent (an `agent` spawn, or a later `send_message` to it) runs as a
 * Job whose turns are a branch of the SAME session, so its live frames carry
 * the conversation's session id. The server stamps each of them with
 * `job_id`; they are kept here, under a chat key of their own, and shown by
 * the turn's Sub-agents card. The conversation's transcript never sees them.
 *
 * Job turns use the admission ids `<job_id>_user` / `<job_id>_user_reply`
 * (openprogram/agent/job/runner/admission.py), so a follow-up Job names the
 * agent it continues through its `parent_msg_id`.
 */
import { convToChatMsgs } from "@/lib/chat/conv-mapper";
import type { JobStatusDetail } from "@/lib/net/ws-events";
import { wsRequest } from "@/lib/net/ws-request";
import { useSessionStore } from "@/lib/session-store";

const JOB_REPLY_SUFFIX = "_user_reply";

/** Job → the Job whose branch it continues (a follow-up message). */
const continues = new Map<string, string>();
/** Job → the prompt shown above its first reply until the transcript loads. */
const prompts = new Map<string, string>();

/** The store key holding one sub-agent's turns, keyed by its first Job
 *  (older spawns without a Job id use their branch head). */
export function subAgentChatKey(sessionId: string, agentKey: string): string {
  return `${sessionId}#sub-agent:${agentKey}`;
}

/** The first Job of the agent this Job belongs to. */
export function agentJobFor(jobId: string): string {
  let current = jobId;
  const seen = new Set<string>();
  while (continues.has(current) && !seen.has(current)) {
    seen.add(current);
    current = continues.get(current)!;
  }
  return current;
}

export function rememberJobPrompt(jobId: string | undefined, prompt: string | undefined): void {
  if (jobId && prompt && !prompts.has(jobId)) prompts.set(jobId, prompt);
}

/** Record which agent a Job continues, before its first frame arrives. */
export function noteJobStatus(detail: JobStatusDetail): void {
  const jobId = detail.job_id;
  if (!jobId) return;
  const parent = detail.parent_msg_id || "";
  if (parent.endsWith(JOB_REPLY_SUFFIX)) {
    const parentJob = parent.slice(0, -JOB_REPLY_SUFFIX.length);
    if (parentJob && parentJob !== jobId) continues.set(jobId, parentJob);
  }
  rememberJobPrompt(jobId, detail.resource?.prompt_summary ?? undefined);
}

/** Put the Job's prompt row in place before its reply starts streaming. */
export function ensureSubAgentPrompt(key: string, jobId: string, userMsgId: string): void {
  const store = useSessionStore.getState();
  if (store.messagesById[userMsgId]) return;
  store.appendMessage(key, {
    id: userMsgId,
    role: "user",
    content: prompts.get(jobId) ?? "",
    status: "done",
  });
}

interface TranscriptReply {
  session_id?: string;
  job_id?: string;
  head_id?: string;
  messages?: unknown[];
  error?: string;
}

/**
 * Load an agent's whole branch (every turn sent to it) without moving the
 * session head. Live rows already on screen keep their newer progress.
 * Resolves to the branch tip (the agent's newest reply), or null.
 */
export async function loadSubAgentTranscript(
  sessionId: string,
  agentKey: string,
  source: { jobId?: string; headId?: string },
): Promise<string | null> {
  const data = await wsRequest<TranscriptReply>(
    "load_sub_agent_transcript",
    { session_id: sessionId, job_id: source.jobId ?? "", head_id: source.headId ?? "" },
    "sub_agent_transcript",
    { requestId: true },
    8000,
  );
  if (!data || data.error || !Array.isArray(data.messages)) return null;
  const messages = convToChatMsgs(data.messages as Parameters<typeof convToChatMsgs>[0]);
  if (!messages.length) return null;
  const tip = data.head_id || null;
  // A turn that started after the server read the branch stays at the end.
  const key = subAgentChatKey(sessionId, agentKey);
  const store = useSessionStore.getState();
  const loaded = new Set(messages.map((message) => message.id));
  const newer = (store.messageOrder[key] ?? [])
    .filter((id) => !loaded.has(id))
    .map((id) => store.messagesById[id])
    .filter((message) => message !== undefined);
  store.setMessages(key, [...messages, ...newer]);
  return tip;
}

/** `[task from …]` / `[message from …]` receipt line that send_message puts
 *  before a message to an existing agent (send_message/delivery.py). */
const RECEIPT = /^\[(task|message) from [^\]\n]+\][^\n]*\n+/;

/** The words the caller wrote, and whether it sent them as a plain message
 *  rather than a task. */
export function promptBody(content: string): { text: string; message: boolean } {
  const receipt = RECEIPT.exec(content);
  if (!receipt) return { text: content, message: false };
  return { text: content.slice(receipt[0].length), message: receipt[1] === "message" };
}
