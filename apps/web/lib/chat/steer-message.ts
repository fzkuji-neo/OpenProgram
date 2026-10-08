"use client";

import { ExecutionApiError, getExecutionSnapshot, postExecutionCommand } from "@/lib/net/execution-client";
import { useSessionStore } from "@/lib/session-store";
import { queuedHasAttachments } from "@/lib/chat/queued-attachments";
import { queueFor, useSendQueue } from "@/lib/chat/send-queue";
import type { CommandResult, ExecutionCommand } from "@/lib/execution/execution-debugger";

type Confirmation = { timer?: ReturnType<typeof setTimeout>; delay: number };
const confirmations = new Map<string, Confirmation>();
const confirmationKey = (sessionId: string, messageId: string) => `${sessionId}\0${messageId}`;

function clearConfirmation(key: string): void {
  const pending = confirmations.get(key);
  if (pending?.timer !== undefined) clearTimeout(pending.timer);
  confirmations.delete(key);
}

function confirmLater(sessionId: string, messageId: string, transportFailed: boolean): void {
  const key = confirmationKey(sessionId, messageId);
  const prior = confirmations.get(key);
  if (prior?.timer !== undefined) clearTimeout(prior.timer);
  const delay = transportFailed ? Math.min((prior?.delay ?? 750) * 2, 30000) : 1500;
  const pending: Confirmation = { delay };
  pending.timer = setTimeout(() => {
    pending.timer = undefined;
    void steerQueuedMessage(sessionId, messageId);
  }, delay);
  confirmations.set(key, pending);
}

/** The queue is the fallback; this path never cancels an execution. */
export async function steerQueuedMessage(sessionId: string, messageId: string): Promise<boolean> {
  const entry = queueFor(sessionId).find(item => item.id === messageId);
  const key = confirmationKey(sessionId, messageId);
  if (!entry) { clearConfirmation(key); return false; }
  if (entry.deliveryError || entry.editing || queuedHasAttachments(entry) || entry.injecting) return false;
  const pending = confirmations.get(key);
  if (pending?.timer !== undefined) {
    clearTimeout(pending.timer);
    pending.timer = undefined;
  }
  const queue = useSendQueue.getState();
  queue.setSteering(sessionId, messageId, { injecting: true,
    ...(entry.steerCommand ? {} : { steerError: undefined }) });
  // Identity belongs to this user intent, not to a later version retry.
  const targetId = entry.steerCommand?.execution_id ?? useSessionStore.getState().runningTasks[sessionId]?.execution_id;
  const stopped = () => queueFor(sessionId).find(row => row.id === messageId)?.steerError === "cancelled";
  let command: ExecutionCommand | undefined = entry.steerCommand;
  try {
    if (Array.from(entry.text).length > 4096) {
      queue.setSteering(sessionId, messageId, { steerError: "too_long" });
      return false;
    }
    // One retry is allowed only after a definitive version-conflict receipt.
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!command) {
        if (stopped()) return false;
        const task = useSessionStore.getState().runningTasks[sessionId];
        if (targetId && task?.execution_id !== targetId) {
          queue.setSteering(sessionId, messageId, {steerError:"ended"});
          return false;
        }
        if (!task) return false;
        if (!task.execution_id) {
          queue.setSteering(sessionId, messageId, { steerError: "retry" });
          return false;
        }
        const snapshot = await getExecutionSnapshot(task.execution_id, AbortSignal.timeout(15000), sessionId);
        if (stopped()) return false;
        if (useSessionStore.getState().runningTasks[sessionId]?.execution_id !== targetId) {
          queue.setSteering(sessionId, messageId, {steerError:"ended"});
          return false;
        }
        if (!queueFor(sessionId).some(item => item.id === messageId)
          || snapshot.session_id !== sessionId || snapshot.execution_id !== task.execution_id
          || !snapshot.capabilities?.steer || !["running", "paused", "pausing"].includes(snapshot.status)) {
          queue.setSteering(sessionId, messageId, { steerError: snapshot.status === "cancelled" || snapshot.status === "cancelling" ? "cancelled" : "unavailable" });
          return false;
        }
        command = {
          type: "execution.command", action: "execution.steer", command_id: crypto.randomUUID(),
          execution_id: snapshot.execution_id, expected_version: snapshot.status_version,
          payload: { message: entry.text },
        };
        queue.setSteering(sessionId, messageId, { steerCommand: command });
      }
      let result: CommandResult;
      try { result = await postExecutionCommand(command, AbortSignal.timeout(15000)); }
      catch (error) {
        if (error instanceof ExecutionApiError && error.command?.command_id === command.command_id
          && error.command.status === "rejected") result = error.command;
        else if (!entry.steerCommand && error instanceof ExecutionApiError && error.status >= 400 && error.status < 500
          && ![408, 409].includes(error.status)) {
          queue.setSteering(sessionId, messageId, { steerCommand: undefined, steerError: stopped() ? "cancelled" : "unavailable" });
          return false;
        } else throw error;
      }
      if (result.command_id !== command.command_id) throw new Error("Unconfirmed command acknowledgement");
      if (result.status === "applied") {
        clearConfirmation(key);
        queue.remove(sessionId, messageId);
        return true;
      }
      if (["accepted", "applying"].includes(result.status)) {
        if (!stopped()) queue.setSteering(sessionId, messageId, {steerError: undefined});
        // The server owns this command, but delivery is not complete until the
        // instruction has been persisted in the conversation. Replay is idempotent.
        confirmLater(sessionId, messageId, false);
        return false;
      }
      if (result.status !== "rejected") throw new Error("Unconfirmed command outcome");
      clearConfirmation(key);
      queue.setSteering(sessionId, messageId, { steerCommand: undefined });
      command = undefined;
      if (stopped() || result.rejection_code === "superseded_by_cancel") {
        queue.setSteering(sessionId, messageId, { steerError: "cancelled" });
        return false;
      }
      if (result.rejection_code === "stale_version" && attempt === 0) continue;
      queue.setSteering(sessionId, messageId, { steerError: "unavailable" });
      return false;
    }
    return false;
  } catch {
    if (!stopped()) queue.setSteering(sessionId, messageId, { steerError: command ? "unconfirmed" : "retry" });
    if (command) confirmLater(sessionId, messageId, true);
    return false;
  } finally {
    queue.setInjecting(sessionId, messageId, false);
    queue.drain(sessionId);
  }
}
