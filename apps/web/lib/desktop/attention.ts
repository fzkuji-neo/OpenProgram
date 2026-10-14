// Desktop notifications and keep-awake, renderer side.
//
// The worker's frames name what just happened: a turn ended, the agent
// asked a question or wants approval, or it waits for system access. This
// module turns those into notification requests for the desktop shell and
// reports whether any session is running. The shell decides whether to show
// a notification (once per key, only while no app window has focus) and
// holds the system awake (desktop/attention-service.js). Outside the
// desktop shell every call is a no-op.
import { desktopBridge } from "@/lib/desktop/bridge-api";
import { translateText } from "@/lib/i18n";
import { useSessionStore } from "@/lib/session-store";
import { displayTitle } from "@/components/sidebar/sessions-list/helpers";

export type AttentionKind = "done" | "failed" | "needs_input" | "system_access";

export interface AttentionEvent {
  kind: AttentionKind;
  sessionId: string;
  /** Stable per occurrence: the same event replayed by another frame keeps its key. */
  key: string;
  /** What the agent asked, for needs_input. */
  detail?: string;
}

const MAX_SEEN = 500;
const seen = new Set<string>();

function sessionTitle(sessionId: string): string {
  const conv = useSessionStore.getState().conversations[sessionId];
  return (conv && displayTitle(conv)) || "OpenProgram";
}

function bodyFor(event: AttentionEvent): string {
  switch (event.kind) {
    case "done":
      return translateText("Finished", "已完成");
    case "failed":
      return translateText("Stopped with an error", "出错停止");
    case "needs_input": {
      const asked = (event.detail || "").trim();
      return asked
        ? `${translateText("Needs your input: ", "需要你的回复：")}${asked}`
        : translateText("Needs your input", "需要你的回复");
    }
    case "system_access":
      return translateText("Waiting for system access", "等待系统权限");
  }
}

/** Ask the shell to notify about `event`. Repeats of a key are dropped here and in the shell. */
export function reportAttention(event: AttentionEvent): void {
  const attention = desktopBridge()?.attention;
  if (!attention || !event.sessionId || !event.key || seen.has(event.key)) return;
  if (seen.size >= MAX_SEEN) seen.clear();
  seen.add(event.key);
  attention.notify({
    key: event.key,
    title: sessionTitle(event.sessionId),
    body: bodyFor(event),
    sessionId: event.sessionId,
  });
}

/** Terminal execution statuses that deserve a notification, by kind. */
export function attentionKindForExecutionStatus(status: unknown): AttentionKind | null {
  if (status === "completed") return "done";
  if (status === "failed") return "failed";
  // cancelled is the user's own Stop; interrupted is a restart or takeover.
  return null;
}

// Executions this window has seen as a session's running task. Only those
// notify when they end: a replayed old status or a child execution never
// was one. Recorded from the store, so it does not matter whether the
// running-task clear or the terminal status frame arrives first.
const MAX_WATCHED = 200;
const watched = new Set<string>();

function watchRunningTasks(tasks: Record<string, { execution_id?: string }>): void {
  for (const task of Object.values(tasks)) {
    if (!task?.execution_id || watched.has(task.execution_id)) continue;
    if (watched.size >= MAX_WATCHED) watched.delete(watched.values().next().value as string);
    watched.add(task.execution_id);
  }
}

/** Called for every execution status frame. */
export function reportExecutionStatus(executionId: string, sessionId: string, status: unknown): void {
  if (!watched.has(executionId)) return;
  const kind = attentionKindForExecutionStatus(status);
  if (status === "completed" || status === "failed" || status === "cancelled" || status === "interrupted") {
    watched.delete(executionId);
  }
  if (kind) reportAttention({ kind, sessionId, key: `execution:${executionId}:${String(status)}` });
}

/**
 * Report whether any session in this window's store is running, and open
 * the session a clicked notification names. Returns the cleanup.
 */
export function startAttentionBridge(openSession: (sessionId: string) => void): () => void {
  const attention = desktopBridge()?.attention;
  if (!attention) return () => {};
  let busy = Object.keys(useSessionStore.getState().runningTasks).length > 0;
  watchRunningTasks(useSessionStore.getState().runningTasks);
  attention.reportBusy(busy);
  const unsubscribeStore = useSessionStore.subscribe((state) => {
    watchRunningTasks(state.runningTasks);
    const next = Object.keys(state.runningTasks).length > 0;
    if (next === busy) return;
    busy = next;
    attention.reportBusy(busy);
  });
  const unsubscribeOpen = attention.onOpenSession((sessionId) => {
    if (typeof sessionId === "string" && sessionId) openSession(sessionId);
  });
  return () => {
    unsubscribeStore();
    unsubscribeOpen();
    attention.reportBusy(false);
  };
}
