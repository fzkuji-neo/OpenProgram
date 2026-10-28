// The session's todo board (todo_create / todo_update) as the chat's task
// list. The board only grows, so the card shows the current plan: the run
// of todos created since the board was last fully done.

import { create } from "zustand";

export type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoItem {
  id: string;
  subject: string;
  status: TodoStatus;
  created_at: number;
  updated_at: number;
}

function normalizeTodo(raw: unknown): TodoItem | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id : String(row.id ?? "");
  const subject = typeof row.subject === "string" ? row.subject.trim() : "";
  if (!id || !subject) return null;
  const status: TodoStatus = row.status === "in_progress" || row.status === "completed" ? row.status : "pending";
  const created = typeof row.created_at === "number" ? row.created_at : 0;
  const updated = typeof row.updated_at === "number" ? row.updated_at : created;
  return { id, subject, status, created_at: created, updated_at: updated };
}

export function normalizeTodos(raw: unknown): TodoItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeTodo).filter((todo): todo is TodoItem => todo !== null);
}

/** The latest plan: a todo created after every earlier one was completed
 *  starts a new plan, so finished work from an earlier task drops off. */
export function currentPlan(todos: readonly TodoItem[]): TodoItem[] {
  const ordered = [...todos].sort((a, b) => a.created_at - b.created_at);
  let plan: TodoItem[] = [];
  for (const todo of ordered) {
    const finishedBefore = plan.length > 0 && plan.every(
      (item) => item.status === "completed" && item.updated_at <= todo.created_at,
    );
    plan = finishedBefore ? [todo] : [...plan, todo];
  }
  return plan;
}

const toSeconds = (ts: number) => (ts > 1e12 ? ts / 1000 : ts);

/** An unfinished plan always shows. A finished one stays under the turn
 *  that finished it and goes away once the user sends the next message. */
export function planVisible(plan: readonly TodoItem[], lastUserMessageAt: number | null): boolean {
  if (plan.length === 0) return false;
  if (plan.some((item) => item.status !== "completed")) return true;
  if (lastUserMessageAt === null) return true;
  const finishedAt = Math.max(...plan.map((item) => item.updated_at));
  return toSeconds(lastUserMessageAt) <= finishedAt;
}

interface TodoState {
  bySession: Record<string, TodoItem[]>;
  setTodos(sessionId: string, todos: unknown): void;
}

export const useTodoStore = create<TodoState>((set) => ({
  bySession: {},
  setTodos: (sessionId, todos) => set((state) => ({
    bySession: { ...state.bySession, [sessionId]: normalizeTodos(todos) },
  })),
}));
