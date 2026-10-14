"use client";

// The agent's current plan, kept at the end of the transcript while it
// works through it: done, in progress and still to do, from the session's
// todo board. Updates live as the agent calls todo_create / todo_update.

import { CircleCheck, CircleDashed, LoaderCircle } from "lucide-react";
import { useSessionStore } from "@/lib/session-store";
import { currentPlan, planVisible, useTodoStore, type TodoStatus } from "@/lib/chat/todo-plan";
import { useTranslation } from "@/lib/i18n";
import styles from "./todo-plan-card.module.css";

const EMPTY: never[] = [];

type SessionState = ReturnType<typeof useSessionStore.getState>;

function lastUserMessageAt(state: SessionState, sessionId: string) {
  const ids = state.messageOrder[sessionId] ?? EMPTY;
  for (let i = ids.length - 1; i >= 0; i -= 1) {
    const message = state.messagesById[ids[i]];
    if (message?.role === "user") return typeof message.timestamp === "number" ? message.timestamp : null;
  }
  return null;
}

function StatusIcon({ status }: { status: TodoStatus }) {
  if (status === "completed") return <CircleCheck className={styles.done} aria-hidden="true" />;
  if (status === "in_progress") return <LoaderCircle className={styles.active} aria-hidden="true" />;
  return <CircleDashed className={styles.pending} aria-hidden="true" />;
}

export function TodoPlanCard({ sessionId }: { sessionId: string | null }) {
  const { text } = useTranslation();
  const todos = useTodoStore((s) => (sessionId ? s.bySession[sessionId] : undefined) ?? EMPTY);
  // A new user turn retires a finished plan.
  const lastUser = useSessionStore((s) => (sessionId ? lastUserMessageAt(s, sessionId) : null));
  if (!sessionId) return null;
  const plan = currentPlan(todos);
  if (!planVisible(plan, lastUser)) return null;
  const done = plan.filter((item) => item.status === "completed").length;
  const statusLabel: Record<TodoStatus, string> = {
    completed: text("Done", "已完成"),
    in_progress: text("In progress", "进行中"),
    pending: text("To do", "待办"),
  };
  return (
    <section className={styles.card} data-todo-plan={sessionId} aria-label={text("Task list", "任务清单")}>
      <div className={styles.header}>
        <span>{text("Tasks", "任务")}</span>
        <span className={styles.count}>{done}/{plan.length}</span>
      </div>
      <ol className={styles.list}>
        {plan.map((item) => (
          <li key={item.id} className={styles.item} data-status={item.status}>
            <StatusIcon status={item.status} />
            <span className="sr-only">{statusLabel[item.status]}: </span>
            <span className={styles.subject}>{item.subject}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
