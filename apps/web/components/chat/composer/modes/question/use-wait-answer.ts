"use client";

import { showToast } from "@/lib/format-utils/toast";
import { useTranslation } from "@/lib/i18n";
import type { PendingDecision } from "@/lib/session-store/types";
import { ExecutionApiError, postExecutionCommand, type WaitCommand } from "@/lib/net/execution-client";
import { useDecisionSubmissions, type DecisionSubmission } from "@/lib/chat/decision-submissions";

export function useWaitAnswer(q: PendingDecision | null, onResolve: (id: string) => void) {
  const { text } = useTranslation();
  const submission = useDecisionSubmissions(s => q ? s.submissions[q.id] : undefined);
  function save(command: WaitCommand, status: DecisionSubmission["status"], error?: string) {
    if (q) useDecisionSubmissions.getState().setSubmission(q.id, { decision: q, command, status, error });
  }
  async function reconcileRejected(command: WaitCommand) {
    if (!q) return;
    try {
      const response = await fetch(`/api/questions?session_id=${encodeURIComponent(q.sessionId)}`, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error("Unable to check request");
      const data = await response.json();
      if (!Array.isArray(data.questions)) throw new Error("Invalid request list");
      const current = data.questions.find((item: { id: string }) => item.id === q.id);
      if (!current) {
        save(command, "closed", text("This request has ended. This answer was not accepted.", "请求已结束，本次回答未被接受。"));
        onResolve(q.id);
        return;
      }
      const { useSessionStore } = await import("@/lib/session-store");
      useSessionStore.getState().enqueueDecision({ ...q,
        expectedVersion: Number(current.expected_version),
        waitGeneration: Number(current.wait_generation),
      });
    } catch { /* Keep the rejected receipt; never imply successful delivery. */ }
    save(command, "rejected", text("The answer was rejected. Review the request and submit again.", "回答被拒绝，请检查问题后重新提交。"));
  }
  async function sendAnswer(action: "execution.wait.answer" | "execution.wait.decline", value?: unknown) {
    if (!q?.executionId || !Number.isInteger(q.expectedVersion)) return;
    const previous = useDecisionSubmissions.getState().submissions[q.id];
    if (previous && ["sending", "answered", "declined", "closed"].includes(previous.status)) return;
    const command: WaitCommand = previous?.status === "unknown" ? previous.command : {
      type: "execution.command", action,
      command_id: `web-wait-${crypto.randomUUID()}`,
      execution_id: q.executionId, expected_version: q.expectedVersion,
      payload: action === "execution.wait.answer"
        ? { wait_id: q.id, generation: q.waitGeneration, answer: value }
        : { wait_id: q.id, generation: q.waitGeneration, reason: value },
    };
    save(command, "sending");
    try {
      const result = await postExecutionCommand(command, AbortSignal.timeout(15000));
      if (result.command_id === command.command_id && result.status === "rejected") {
        await reconcileRejected(command);
        return;
      }
      if (result.command_id !== command.command_id || result.status !== "applied") {
        throw new Error("invalid_command_receipt");
      }
      save(command, command.action === "execution.wait.decline" ? "declined" : "answered");
      if (result.execution?.status === "paused" && result.execution.reason_code === "continuation_contract_mismatch") {
        const message = text("Your answer was saved, but execution could not resume. The operation has not run.", "答复已保存，但执行未能恢复，操作尚未执行。");
        save(command, command.action === "execution.wait.decline" ? "declined" : "answered", message);
        showToast(message, { tone: "error" });
      }
      onResolve(q.id);
      return true;
    } catch (error) {
      if (error instanceof ExecutionApiError && error.command?.command_id === command.command_id
          && error.command.status === "rejected") {
        await reconcileRejected(command);
        return;
      }
      const detail = error instanceof ExecutionApiError
        ? `${error.code}${error.status ? ` (HTTP ${error.status})` : ""}`
        : error instanceof Error ? error.message : "request_failed";
      save(command, "unknown", `${text("Delivery not confirmed. Retry sends the same answer.", "尚未确认送达。重试会发送同一份回答。")} ${detail}`);
    }
  }

  return { sendAnswer, submission, answerPending: submission?.status === "sending",
    answerLocked: Boolean(submission && ["sending", "unknown", "answered", "declined", "closed"].includes(submission.status)) };
}
