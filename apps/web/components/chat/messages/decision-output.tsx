"use client";

import { useSessionStore, type PendingDecision } from "@/lib/session-store";
import { useDecisionSubmissions, type DecisionSubmission } from "@/lib/chat/decision-submissions";
import { useTranslation } from "@/lib/i18n";
import { QuestionMode } from "../composer/modes/question/question-mode";
import { useDecisionDiscussion } from "../composer/modes/question/use-decision-discussion";
import styles from "./decision-output.module.css";

// Match the lifetime of session receipts: switching panes or answering a later
// parallel question must not change the order in which cards first appeared.
const firstSeen = new Map<string, number>();
function displayOrder(decision: PendingDecision): number {
  const key = JSON.stringify([decision.sessionId, decision.id]);
  if (!firstSeen.has(key)) firstSeen.set(key, firstSeen.size);
  return firstSeen.get(key)!;
}

function DecisionOutput({ decision, submission }: {
  decision: PendingDecision;
  submission?: DecisionSubmission;
}) {
  const { text } = useTranslation();
  const dequeue = useSessionStore((s) => s.dequeueDecision);
  const thinking = useSessionStore((s) =>
    s.composerSettingsBySession[decision.sessionId ?? ""]?.thinking ?? "",
  );
  const discuss = useDecisionDiscussion({ decision, thinking, dequeue });
  const status = submission?.status;
  const terminal = status === "answered" || status === "declined" || status === "closed";
  const answer = submission?.command.payload.answer;
  const answerText = typeof answer === "string" ? answer : answer === undefined
    ? undefined : JSON.stringify(answer, null, 2);
  return (
    <section className={styles.card} data-decision-output={decision.id}
      data-decision-status={status ?? "open"} data-session-id={decision.sessionId}
      aria-label={text("User decision", "用户决定")}>
      {terminal ? (
        <div className={styles.receipt}>
          <div className={styles.prompt}>{decision.prompt}</div>
          {decision.questions?.map((question, index) => (
            <div key={index}>{question.prompt}</div>
          ))}
          {answerText !== undefined && <div>
            <div className={styles.label}>{text("Submitted answer", "已提交的回答")}</div>
            <pre className={styles.answer}>{answerText}</pre>
          </div>}
          {submission?.error && <div role="alert">{submission.error}</div>}
          <div role="status" className={styles.label}>
            {status === "answered" ? text("Answer confirmed", "回答已确认")
              : status === "declined" ? text("Declined", "已拒绝")
              : text("Request closed; answer not confirmed", "请求已关闭，回答未确认")}
          </div>
        </div>
      ) : <QuestionMode decision={decision} onResolve={dequeue} onChatAbout={discuss} />}
    </section>
  );
}

/** Session-owned output, separate from the chat draft and its submit action. */
export function DecisionOutputs({ sessionId }: { sessionId: string | null }) {
  const pending = useSessionStore((s) => s.pendingDecisions);
  const submissions = useDecisionSubmissions((s) => s.submissions);
  if (!sessionId) return null;
  const decisions = new Map<string, PendingDecision>();
  for (const submission of Object.values(submissions)) {
    if (submission.decision.sessionId === sessionId) {
      decisions.set(submission.decision.id, submission.decision);
    }
  }
  for (const decision of pending) {
    if (decision.sessionId === sessionId) decisions.set(decision.id, decision);
  }
  const ordered = Array.from(decisions.values());
  ordered.forEach(displayOrder);
  ordered.sort((a, b) => displayOrder(a) - displayOrder(b));
  return <>{ordered.map((decision) => (
    <DecisionOutput key={decision.id} decision={decision} submission={submissions[decision.id]} />
  ))}</>;
}
