import assert from "node:assert/strict";
import test from "node:test";

const { currentPlan, normalizeTodos, planVisible, useTodoStore } = await import("../../lib/chat/transcript/todo-plan.ts");

const todo = (id, status, created, updated = created) => ({
  id, subject: `task ${id}`, status, created_at: created, updated_at: updated,
});

test("malformed rows are dropped and unknown statuses read as to do", () => {
  const rows = normalizeTodos([
    { id: "1", subject: "  ship it  ", status: "weird", created_at: 5 },
    { id: "2", subject: "" },
    null,
    { id: 3, subject: "numeric id", status: "completed", created_at: 6, updated_at: 7 },
  ]);
  assert.deepEqual(rows, [
    { id: "1", subject: "ship it", status: "pending", created_at: 5, updated_at: 5 },
    { id: "3", subject: "numeric id", status: "completed", created_at: 6, updated_at: 7 },
  ]);
  assert.deepEqual(normalizeTodos("nope"), []);
});

test("a todo added after the board was all done starts a new plan", () => {
  const board = [
    todo("1", "completed", 10, 20),
    todo("2", "completed", 11, 25),
    todo("3", "pending", 30),
    todo("4", "in_progress", 31, 32),
  ];
  assert.deepEqual(currentPlan(board).map((t) => t.id), ["3", "4"]);
});

test("adding to an unfinished plan extends it", () => {
  const board = [todo("1", "completed", 10, 20), todo("2", "pending", 11), todo("3", "pending", 30)];
  assert.deepEqual(currentPlan(board).map((t) => t.id), ["1", "2", "3"]);
});

test("a todo created before the last one was finished stays in the same plan", () => {
  // Item 2 was added while item 1 was still open, even though 1 finished later.
  const board = [todo("1", "completed", 10, 40), todo("2", "completed", 20, 50)];
  assert.deepEqual(currentPlan(board).map((t) => t.id), ["1", "2"]);
});

test("unfinished plans always show; finished ones until the next user message", () => {
  const T = 1_790_000_000; // backend seconds
  const open = [todo("1", "completed", T, T + 10), todo("2", "in_progress", T + 1, T + 11)];
  assert.equal(planVisible(open, (T + 99) * 1000), true);
  const finished = [todo("1", "completed", T, T + 10), todo("2", "completed", T + 1, T + 20)];
  assert.equal(planVisible(finished, null), true);
  assert.equal(planVisible(finished, (T + 15) * 1000), true, "the turn that finished it (ms timestamp) keeps it");
  assert.equal(planVisible(finished, T + 15), true, "seconds work too");
  assert.equal(planVisible(finished, (T + 21) * 1000), false, "the next user message retires it");
  assert.equal(planVisible([], null), false);
});

test("the store keeps each session's board apart", () => {
  useTodoStore.getState().setTodos("a", [{ id: "1", subject: "x", status: "pending", created_at: 1 }]);
  useTodoStore.getState().setTodos("b", []);
  assert.equal(useTodoStore.getState().bySession.a.length, 1);
  assert.deepEqual(useTodoStore.getState().bySession.b, []);
});
