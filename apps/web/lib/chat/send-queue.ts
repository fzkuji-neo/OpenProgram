"use client";

/**
 * Client-side send queue — "type while it runs".
 *
 * A message typed while the session's turn is still running is parked
 * here instead of being dropped (the backend rejects a concurrent
 * `chat` with `code:"run_active"`). The entries render as dimmed
 * "queued" bubbles above the composer and drain one at a time: when
 * a session's running task clears, the head entry is sent as an
 * ordinary turn.
 *
 * Text rows survive a reload, a closed window and an App restart until they
 * are sent (queue-storage.ts); rows with attachments stay in memory.
 * Each queue belongs to one conversation.
 */

import { create } from "zustand";
import { adoptOrphanedQueues, saveQueues } from "./queue-storage";
import { hasPendingFirstAck } from "./pending-user-text";
import type { ChatAttachment } from "@/components/chat/composer/submit/send-chat-message";
import { queuedMessagePayload, snapshotQueuedAttachments, type QueuedAttachments } from "./queued-attachments";
import type { ExecutionCommand } from "@/lib/execution/execution-debugger";

// ponytail: `send-chat-message` imports back into this module (it records the
// per-session turn settings), so the send function is reached through a
// registered callback rather than a static import. One indirection beats
// an import cycle between a store and the socket writer.
import { useSessionStore } from "@/lib/session-store";

type SendFn = (args: {
  text: string;
  sessionId: string | null;
  thinking: string;
  toolsEnabled: boolean;
  toolsProfile?: string;
  webSearchEnabled: boolean;
  serviceTier?: string;
  background?: boolean;
  attachments?: ChatAttachment[];
  hasAttachments?: boolean;
  onReject?: () => void;
}) => boolean;

let sendImpl: SendFn | null = null;

/** Wired once by `send-chat-message` on module load. */
export function registerChatSender(fn: SendFn): void {
  sendImpl = fn;
}

export interface QueuedMessage extends QueuedAttachments {
  /** Prevent automatic dispatch while the user edits this draft. */
  editing?: boolean;
  deliveryError?: boolean;
  id: string;
  text: string;
  /** Turn settings captured at type-time, replayed verbatim on send. */
  thinking: string;
  toolsEnabled: boolean;
  toolsProfile?: string;
  webSearchEnabled: boolean;
  serviceTier?: string;
  background: boolean;
  queuedAt: number;
  /** A steer request is in flight; drain must wait for its acknowledgement. */
  injecting?: boolean;
  /** Retained verbatim until its durable acknowledgement is known. */
  steerCommand?: ExecutionCommand;
  steerError?: "unconfirmed" | "unavailable" | "too_long" | "retry" | "cancelled" | "ended";
}

/** What the composer hands over; the store stamps id + queuedAt. */
export type QueueDraft = Omit<QueuedMessage, "id" | "queuedAt">;

interface SendQueueState {
  /** sessionId → entries, in send order. */
  queues: Record<string, QueuedMessage[]>;
  enqueue: (sessionId: string, draft: QueueDraft) => string;
  remove: (sessionId: string, id: string) => void;
  beginEdit: (sessionId: string, id: string) => boolean;
  endEdit: (sessionId: string, id: string) => void;
  updateDraft: (sessionId: string, id: string, draft: QueuedAttachments & { text: string }) => boolean;
  retryDraft: (sessionId: string, id: string) => void;
  removeDraft: (sessionId: string, id: string) => boolean;
  /** Remove every row the user can remove (not one being edited or whose
   *  steer delivery is in flight) in one write, so clearing never drains a
   *  row that was about to be removed. Returns how many were removed. */
  clearDrafts: (sessionId: string) => number;
  /** Put rows in the order of `ids` (a drag in the queue card). Rows that
   *  left the queue meanwhile are skipped; rows not named keep their place
   *  after the named ones. Rows being delivered or edited never move. */
  reorder: (sessionId: string, ids: readonly string[]) => void;
  setInjecting: (sessionId: string, id: string, injecting: boolean) => void;
  setSteering: (sessionId: string, id: string, patch: Partial<Pick<QueuedMessage, "injecting" | "steerCommand" | "steerError">>) => void;
  /** Send the head entry if the session is idle. No-op otherwise. */
  drain: (sessionId: string) => void;
}

const EMPTY: QueuedMessage[] = [];

// A queued message outranks an automatic Goal continuation, but the server
// cannot see this queue. Tell it when a conversation's queue fills or is
// emptied without sending; a drain's send is the server's own signal.
const draining = new Set<string>();
function hintGoalQueue(before: Record<string, QueuedMessage[]>, after: Record<string, QueuedMessage[]>): void {
  for (const sessionId of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const waiting = Boolean(after[sessionId]?.length);
    if (waiting === Boolean(before[sessionId]?.length) || (!waiting && draining.has(sessionId))) continue;
    void import("@/lib/net/api")
      .then(({ api }) => api.setGoalQueueWaiting(sessionId, waiting))
      .catch(() => {});
  }
}

let seq = 0;

export const useSendQueue = create<SendQueueState>((set, get) => ({
  queues: {},

  enqueue: (sessionId, draft) => {
    const id = `q${++seq}_${Date.now().toString(36)}`;
    set((s) => ({
      queues: {
        ...s.queues,
        [sessionId]: [
          ...(s.queues[sessionId] ?? EMPTY),
          { ...draft, ...snapshotQueuedAttachments(draft), id, queuedAt: Date.now() },
        ],
      },
    }));
    return id;
  },

  reorder: (sessionId, ids) =>
    set((s) => {
      const cur = s.queues[sessionId];
      if (!cur) return {};
      const pinned = (row: QueuedMessage) => Boolean(row.injecting || row.steerCommand || row.editing);
      const byId = new Map(cur.map((row) => [row.id, row]));
      const moved = ids.map((id) => byId.get(id)).filter((row): row is QueuedMessage => !!row && !pinned(row));
      const movedIds = new Set(moved.map((row) => row.id));
      // Pinned rows hold their index; the movable rows fill the other slots.
      const rest = cur.filter((row) => !pinned(row) && !movedIds.has(row.id));
      const order = [...moved, ...rest];
      const next = cur.map((row) => (pinned(row) ? row : order.shift()!));
      if (next.every((row, i) => row === cur[i])) return {};
      return { queues: { ...s.queues, [sessionId]: next } };
    }),

  remove: (sessionId, id) =>
    set((s) => {
      const cur = s.queues[sessionId];
      if (!cur) return {};
      const next = cur.filter((q) => q.id !== id);
      const queues = { ...s.queues };
      if (next.length > 0) queues[sessionId] = next;
      else delete queues[sessionId];
      return { queues };
    }),

  beginEdit: (sessionId, id) => {
    const row = get().queues[sessionId]?.find(item => item.id === id);
    if (!row || row.editing || row.injecting || row.steerCommand) return false;
    set(s => ({ queues: { ...s.queues, [sessionId]: s.queues[sessionId].map(item => item.id === id ? {...item, editing:true} : item) } }));
    return true;
  },
  endEdit: (sessionId, id) => {
    const rows = get().queues[sessionId];
    if (!rows?.some(item => item.id === id && item.editing)) return;
    set(s => ({ queues: { ...s.queues, [sessionId]: rows.map(item => item.id === id ? {...item, editing:false} : item) } }));
  },
  updateDraft: (sessionId, id, draft) => {
    const rows = get().queues[sessionId];
    const row = rows?.find(item => item.id === id);
    if (!row || !row.editing || row.injecting || row.steerCommand) return false;
    if (!draft.text.trim() && !draft.images?.length && !draft.docs?.length) return false;
    set(s => ({ queues: { ...s.queues, [sessionId]: rows.map(item => item.id === id
      ? {...item, text:draft.text, ...snapshotQueuedAttachments(draft), editing:false, deliveryError:false, steerError:undefined} : item) } }));
    return true;
  },
  retryDraft: (sessionId, id) => {
    const rows = get().queues[sessionId];
    const row = rows?.find(item => item.id === id);
    if (!row || row.editing || row.injecting || row.steerCommand) return;
    set(s => ({ queues: { ...s.queues, [sessionId]: rows.map(item => item.id === id ? {...item, deliveryError:false, steerError:undefined} : item) } }));
    get().drain(sessionId);
  },
  removeDraft: (sessionId, id) => {
    const row = get().queues[sessionId]?.find(item => item.id === id);
    if (!row || row.injecting || row.steerCommand || row.editing) return false;
    get().remove(sessionId, id);
    get().drain(sessionId);
    return true;
  },

  clearDrafts: (sessionId) => {
    const rows = get().queues[sessionId] ?? EMPTY;
    const kept = rows.filter(row => row.injecting || row.steerCommand || row.editing);
    const removed = rows.length - kept.length;
    if (!removed) return 0;
    set(s => {
      const queues = { ...s.queues };
      if (kept.length) queues[sessionId] = kept;
      else delete queues[sessionId];
      return { queues };
    });
    return removed;
  },

  setInjecting: (sessionId, id, injecting) =>
    set((s) => {
      const cur = s.queues[sessionId];
      if (!cur?.some((message) => message.id === id)) return {};
      return {
        queues: {
          ...s.queues,
          [sessionId]: cur.map((message) =>
            message.id === id ? { ...message, injecting } : message
          ),
        },
      };
    }),

  setSteering: (sessionId, id, patch) => set((s) => {
    const entries = s.queues[sessionId];
    if (!entries?.some(item => item.id === id)) return {};
    return { queues: { ...s.queues, [sessionId]: entries.map(item => item.id === id ? { ...item, ...patch } : item) } };
  }),

  drain: (sessionId) => {
    const head = (get().queues[sessionId] ?? EMPTY)[0];
    if (!head || !sendImpl) return;
    if (["cancelled", "ended"].includes(head.steerError ?? "") || head.deliveryError || head.editing || head.injecting || head.steerCommand) return;
    // Still busy — the next running-task clear will call us again.
    if (useSessionStore.getState().runningTasks[sessionId]) return;
    // The previous send has not been acknowledged yet. sendChatMessage would
    // treat this one as a repeat of it and drop it, so wait: the ACK starts
    // that turn, and its clear drains again.
    if (hasPendingFirstAck(sessionId)) return;
    // The server clears its waiting hint when this turn is admitted.
    draining.add(sessionId);
    // Pop BEFORE sending: sendChatMessage re-enters the store (running
    // task, pending text) and a failed write re-queues at the head
    // below, so there is no window where the entry is both queued and
    // in flight.
    get().remove(sessionId, head.id);
    draining.delete(sessionId);
    const payload = queuedMessagePayload(head);
    const restore = (deliveryError = false) => set((s) => {
      const rows = s.queues[sessionId] ?? EMPTY;
      if (rows.some(item => item.id === head.id)) return {};
      return { queues: { ...s.queues, [sessionId]: [{...head, deliveryError}, ...rows] } };
    });
    const ok = sendImpl({
      ...payload,
      // Text-only run_active uses requeueRejected; other pre-ACK failures
      // invoke this callback and require an explicit retry.
      onReject: () => restore(true),
      sessionId,
      thinking: head.thinking,
      toolsEnabled: head.toolsEnabled,
      toolsProfile: head.toolsProfile ?? "__agent__",
      webSearchEnabled: head.webSearchEnabled,
      serviceTier: head.serviceTier,
      background: head.background,
    });
    if (ok) return;
    // Socket closed mid-drain: retain the complete payload at the head.
    restore();
  },
}));

// Every write, the store's own actions and the helpers below alike, is saved
// and tells the server whether a queue waits.
useSendQueue.subscribe((state, previous) => {
  if (state.queues === previous.queues) return;
  saveQueues(state.queues);
  hintGoalQueue(previous.queues, state.queues);
});

// Rows a reload or restart left behind join this window's queues, and their
// sessions are asked for their run state: the reply confirms restored steering
// receipts and drains an idle session. Before the socket opens, its open
// handler asks for every session with a queue.
if (typeof window !== "undefined") {
  void adoptOrphanedQueues().then((adopted) => {
    const sessions = Object.keys(adopted);
    if (!sessions.length) return;
    useSendQueue.setState((s) => {
      const queues = { ...s.queues };
      for (const sid of sessions) {
        const ids = new Set((queues[sid] ?? EMPTY).map((row) => row.id));
        queues[sid] = [...(queues[sid] ?? EMPTY), ...adopted[sid].filter((row) => !ids.has(row.id))];
      }
      return { queues };
    });
    void import("@/lib/runtime-bridge/state").then(({ getSocket }) => {
      const socket = getSocket();
      if (socket?.readyState !== WebSocket.OPEN) return;
      for (const sid of sessions) socket.send(JSON.stringify({ action: "get_run_state", session_id: sid }));
    });
  });
}

/** Move one entry to the front without cancelling an execution. */
export function promoteToHead(sessionId: string, id: string): void {
  useSendQueue.setState((s) => {
    const cur = s.queues[sessionId];
    if (!cur) return {};
    const target = cur.find((q) => q.id === id);
    if (!target || cur[0]?.id === id) return {};
    return {
      queues: {
        ...s.queues,
        [sessionId]: [target, ...cur.filter((q) => q.id !== id)],
      },
    };
  });
}

/** Imperative enqueue for the composer (which is not a store consumer).
 *  Callers must supply the attachment snapshots when files are present. */
export function enqueueMessage(
  sessionId: string,
  draft: QueueDraft,
  attachmentCount = 0,
): string | null {
  if (attachmentCount > (draft.images?.length ?? 0) + (draft.docs?.length ?? 0)) return null;
  return useSendQueue.getState().enqueue(sessionId, draft);
}

/** Non-reactive read for imperative call sites. */
export function queueFor(sessionId: string): QueuedMessage[] {
  return useSendQueue.getState().queues[sessionId] ?? EMPTY;
}

/** Reconcile one retained queue after a WebSocket reconnect has loaded the
 *  server's authoritative session state. Active sessions wait for their real
 *  running_task_clear, so the slot takes the ids of the turn the server named:
 *  a clear only idles a slot it names. Idle sessions may retry the head
 *  immediately. */
export function reconcileAfterSessionLoad(
  sessionId: string,
  runActive: boolean,
  runTask?: { msg_id?: string; execution_id?: string } | null,
): void {
  // Confirm restored receipts only after authoritative session hydration.
  if (queueFor(sessionId).some(row => row.steerCommand)) {
    void import("./steer-message").then(({steerQueuedMessage}) => {
      for (const row of queueFor(sessionId)) {
        if (row.steerCommand) void steerQueuedMessage(sessionId, row.id);
      }
    });
  }
  const sessions = useSessionStore.getState();
  if (runActive) {
    // 只在没有真实 task 时占位；已有 execution_id 的不覆盖（否则停止键
    // 只能发无 id 的 stop，服务端可能解析不到 execution）。
    const existing = sessions.runningTasks[sessionId];
    if (!existing || (!existing.msg_id && !existing.execution_id)) {
      sessions.setRunningTaskFor(sessionId, {
        session_id: sessionId,
        msg_id: runTask?.msg_id || "",
        ...(runTask?.execution_id ? { execution_id: runTask.execution_id } : {}),
      });
    }
    return;
  }
  const wasRunning = Boolean(sessions.runningTasks[sessionId]);
  sessions.setRunningTaskFor(sessionId, null);
  if (!wasRunning) {
    queueMicrotask(() => useSendQueue.getState().drain(sessionId));
  }
}

const RUN_STATE_RECHECK_MS = 1500;
const runStateRechecks = new Set<string>();

/** A running slot with neither id (an active run reported without them, a
 *  legacy setRunning(true)) matches no running_task_clear, so the session
 *  would look busy for good. The session store calls this for every such
 *  write: ask the server again until the reply names the turn or reports
 *  the session idle. A just-sent message holds the same slot until its ack
 *  and is left alone. */
export function recheckRunState(sessionId: string): void {
  if (runStateRechecks.has(sessionId)) return;
  runStateRechecks.add(sessionId);
  setTimeout(() => {
    runStateRechecks.delete(sessionId);
    const task = useSessionStore.getState().runningTasks[sessionId];
    if (!task || task.msg_id || task.execution_id || hasPendingFirstAck(sessionId)) return;
    void import("@/lib/runtime-bridge/state").then(({ getSocket }) => {
      const socket = getSocket();
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ action: "get_run_state", session_id: sessionId }));
      } else recheckRunState(sessionId);
    });
  }, RUN_STATE_RECHECK_MS);
}

/** Turn settings of the last outgoing send per session, so a rejected
 *  frame can be re-queued with the settings it was sent under — the
 *  WS error frame only echoes `retry_query`, not the knobs. */
const lastSettings: Record<string, Omit<QueueDraft, "text">> = {};

export function rememberSendSettings(
  sessionId: string,
  settings: Omit<QueueDraft, "text">,
): void {
  lastSettings[sessionId] = settings;
}

/** Re-queue a message the backend rejected with `run_active`, at the
 *  FRONT (it was typed before everything still waiting). The race this
 *  covers: the client believed the session was idle, the backend knew
 *  better. Silent recovery — no error bubble, no lost text. */
export function requeueRejected(sessionId: string, text: string): void {
  const settings = lastSettings[sessionId] ?? {
    thinking: "medium",
    toolsEnabled: true,
    toolsProfile: "__agent__",
    webSearchEnabled: false,
    background: false,
  };
  useSendQueue.setState((s) => ({
    queues: {
      ...s.queues,
      [sessionId]: [
        { ...settings, id: `q${++seq}_retry`, text, queuedAt: Date.now() },
        ...(s.queues[sessionId] ?? EMPTY),
      ],
    },
  }));
}

/** Stop holds every steering attempt, including pre-admission snapshot reads.
 * Posted commands remain intact until their receipt establishes delivery. */
export function holdSteeringForStop(sessionId: string): void {
  const queue = useSendQueue.getState();
  for (const row of queueFor(sessionId)) {
    if (row.injecting || row.steerCommand) queue.setSteering(sessionId, row.id, {steerError:"cancelled"});
  }
}
