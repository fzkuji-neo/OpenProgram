/**
 * What the Activity panel shows for one conversation.
 *
 * A row is a run: one top-level execution, normally one message and
 * everything the assistant did for it. Its sub-agents (child executions),
 * the function calls that have not returned and the managed programs hang
 * under it. Issues are the concrete things waiting on the reader: a call
 * whose result is unconfirmed, an execution paused on a question or an
 * unconfirmed action, a program whose state is unknown.
 */
import type { ExecutionSnapshot } from "./execution-debugger";
import { processIsActive, type ActiveToolCall, type ManagedProcess } from "@/lib/net/process-client";

const LIVE = new Set(["queued", "running", "pausing", "cancelling"]);

export type ActivityIssue =
  | { kind: "call"; key: string; call: ActiveToolCall; owner: ExecutionSnapshot | null; at: number }
  | { kind: "execution"; key: string; execution: ExecutionSnapshot; at: number }
  | { kind: "program"; key: string; program: ManagedProcess; at: number };

export type ActivityRun = {
  root: ExecutionSnapshot;
  /** The root and every execution under it. */
  tree: ExecutionSnapshot[];
  calls: ActiveToolCall[];
  programs: ManagedProcess[];
  issues: ActivityIssue[];
  active: boolean;
  /** The call it is waiting on right now, if one is out. */
  runningCall: ActiveToolCall | null;
  at: number;
};

export type ActivityModel = {
  runs: ActivityRun[];
  issues: ActivityIssue[];
  /** Calls and programs whose execution is not listed. */
  looseCalls: ActiveToolCall[];
  loosePrograms: ManagedProcess[];
  childrenOf: (executionId: string) => ExecutionSnapshot[];
  runOf: (executionId: string) => ActivityRun | null;
};

export function executionPending(item: ExecutionSnapshot): boolean {
  return item.status === "paused" || (item.status === "reconciliation_required"
    && item.effect_summary?.provider_response_incomplete !== true);
}

export function startedAt(item: ExecutionSnapshot): number {
  return item.started_at ?? item.updated_at ?? 0;
}

export function parentOf(item: ExecutionSnapshot): string | null {
  return item.view_parent_execution_id ?? item.parent_execution_id ?? null;
}

export function activityModel(
  executions: ExecutionSnapshot[],
  programs: ManagedProcess[],
  calls: ActiveToolCall[],
): ActivityModel {
  const byId = new Map(executions.map(item => [item.execution_id, item]));
  const children = new Map<string, ExecutionSnapshot[]>();
  const roots: ExecutionSnapshot[] = [];
  for (const item of executions) {
    const parent = parentOf(item);
    if (parent && byId.has(parent) && parent !== item.execution_id) {
      children.set(parent, [...(children.get(parent) || []), item]);
    } else roots.push(item);
  }
  const childrenOf = (id: string) => [...(children.get(id) || [])].sort((a, b) => startedAt(a) - startedAt(b));
  // A managed program reports its own tool call; the call row would repeat it.
  const liveCalls = calls.filter(call => !programs.some(program => processIsActive(program)
    && program.execution_id === call.execution_id && program.tool_call_id && program.tool_call_id === call.tool_call_id));

  const runOfId = new Map<string, ActivityRun>();
  const runs = roots.map(root => {
    const tree: ExecutionSnapshot[] = [];
    const seen = new Set<string>();
    const walk = (item: ExecutionSnapshot) => {
      if (seen.has(item.execution_id)) return;
      seen.add(item.execution_id);
      tree.push(item);
      for (const child of childrenOf(item.execution_id)) walk(child);
    };
    walk(root);
    const ids = new Set(tree.map(item => item.execution_id));
    const runCalls = liveCalls.filter(call => ids.has(call.execution_id));
    const runPrograms = programs.filter(program => program.execution_id && ids.has(program.execution_id));
    const issues: ActivityIssue[] = [];
    for (const call of runCalls) {
      if (call.status !== "running") issues.push({ kind: "call", key: `call:${call.id}`, call, owner: byId.get(call.execution_id) ?? null, at: call.started_at });
    }
    for (const item of tree) {
      // An unconfirmed call already says what the execution is waiting on.
      if (!executionPending(item) || runCalls.some(call => call.execution_id === item.execution_id && call.status !== "running")) continue;
      issues.push({ kind: "execution", key: `execution:${item.execution_id}`, execution: item, at: startedAt(item) });
    }
    for (const program of runPrograms) {
      if (["unknown", "lost"].includes(program.status)) issues.push({ kind: "program", key: `program:${program.id}`, program, at: program.started_at });
    }
    const run: ActivityRun = {
      root, tree, calls: runCalls, programs: runPrograms, issues,
      active: tree.some(item => LIVE.has(item.status)) || runPrograms.some(processIsActive)
        || runCalls.some(call => call.status === "running"),
      runningCall: runCalls.filter(call => call.status === "running").at(-1) ?? null,
      at: startedAt(root),
    };
    for (const id of ids) runOfId.set(id, run);
    return run;
  }).sort((a, b) => b.at - a.at);

  const looseCalls = liveCalls.filter(call => !byId.has(call.execution_id));
  const loosePrograms = programs.filter(program => !program.execution_id || !byId.has(program.execution_id));
  const issues = [
    ...runs.flatMap(run => run.issues),
    ...looseCalls.filter(call => call.status !== "running").map(call => ({ kind: "call" as const, key: `call:${call.id}`, call, owner: null, at: call.started_at })),
    ...loosePrograms.filter(program => ["unknown", "lost"].includes(program.status)).map(program => ({ kind: "program" as const, key: `program:${program.id}`, program, at: program.started_at })),
  ].sort((a, b) => b.at - a.at);
  return { runs, issues, looseCalls, loosePrograms, childrenOf, runOf: id => runOfId.get(id) ?? null };
}

/** The sub-agent an `agent` call started: the job child that began right
 *  after it, preferring the one whose label matches the call's description. */
export function spawnedBy(call: ActiveToolCall, children: ExecutionSnapshot[]): ExecutionSnapshot | null {
  const jobs = children.filter(child => child.display?.kind === "job_agent" && startedAt(child) >= call.started_at - 1);
  if (!jobs.length) return null;
  const words = (value: string) => value.toLowerCase().replace(/[_\s]+/g, " ").trim();
  return jobs.find(job => call.description && words(job.display?.label || "") === words(call.description))
    ?? [...jobs].sort((a, b) => startedAt(a) - startedAt(b))[0];
}

export type BranchRow<T> =
  | { kind: "agent"; item: ExecutionSnapshot; depth: number }
  | { kind: "leaf"; leaf: T; depth: number };

export type AgentBranches = {
  /** The listed execution this one runs under, if any. */
  parentOf: (item: ExecutionSnapshot) => string | null;
  /** The nearest sub-agent above an execution; null: the main conversation. */
  agentParentOf: (item: ExecutionSnapshot) => string | null;
  /** The branch that runs an execution: the sub-agent itself, the nearest
   *  sub-agent above it, or null for the main conversation. */
  ownerOf: (item: ExecutionSnapshot) => string | null;
  /** The sub-agents a branch started (null: the main conversation), newest first. */
  agentsUnder: (owner: string | null) => ExecutionSnapshot[];
  /** Every sub-agent under the main conversation, depth first, newest
   *  first, with each branch's `leaves` (things it started that are not
   *  sub-agents) placed among its sub-agents by time. */
  tree: <T>(leaves?: (owner: string | null) => { at: number; leaf: T }[]) => BranchRow<T>[];
};

/** The conversation's agent branches: the main conversation and the
 *  sub-agents (`job_agent` executions) under it, each under the branch
 *  that started it. */
export function agentBranches(executions: ExecutionSnapshot[]): AgentBranches {
  const byId = new Map(executions.map(item => [item.execution_id, item]));
  const isAgent = (item: ExecutionSnapshot) => item.display?.kind === "job_agent";
  const listedParent = (item: ExecutionSnapshot) => {
    const parent = parentOf(item);
    return parent && parent !== item.execution_id && byId.has(parent) ? parent : null;
  };
  const agentParent = new Map<string, string | null>();
  const agentParentOf = (item: ExecutionSnapshot): string | null => {
    if (agentParent.has(item.execution_id)) return agentParent.get(item.execution_id)!;
    const seen = new Set([item.execution_id]);
    let found: string | null = null;
    for (let id = listedParent(item); id && !seen.has(id); id = listedParent(byId.get(id)!)) {
      seen.add(id);
      if (isAgent(byId.get(id)!)) { found = id; break; }
    }
    agentParent.set(item.execution_id, found);
    return found;
  };
  const agents = executions.filter(isAgent).sort((a, b) => startedAt(b) - startedAt(a));
  const agentsUnder = (owner: string | null) => agents.filter(item => agentParentOf(item) === owner);
  return {
    parentOf: listedParent,
    agentParentOf,
    ownerOf: item => isAgent(item) ? item.execution_id : agentParentOf(item),
    agentsUnder,
    tree: <T>(leaves?: (owner: string | null) => { at: number; leaf: T }[]) => {
      const rows: BranchRow<T>[] = [];
      const placed = new Set<string>();
      const visit = (owner: string | null, depth: number) => {
        const children: ({ at: number; item: ExecutionSnapshot } | { at: number; leaf: T })[] = [
          ...agentsUnder(owner).filter(item => !placed.has(item.execution_id)).map(item => ({ at: startedAt(item), item })),
          ...(leaves?.(owner) ?? []),
        ].sort((a, b) => b.at - a.at);
        for (const child of children) {
          if (!("item" in child)) { rows.push({ kind: "leaf", leaf: child.leaf, depth }); continue; }
          if (placed.has(child.item.execution_id)) continue;
          placed.add(child.item.execution_id);
          rows.push({ kind: "agent", item: child.item, depth });
          visit(child.item.execution_id, depth + 1);
        }
      };
      visit(null, 1);
      // A sub-agent whose parents loop never reaches the main conversation;
      // it is still listed.
      for (const item of agents) {
        if (placed.has(item.execution_id)) continue;
        placed.add(item.execution_id);
        rows.push({ kind: "agent", item, depth: 1 });
        visit(item.execution_id, 2);
      }
      return rows;
    },
  };
}
