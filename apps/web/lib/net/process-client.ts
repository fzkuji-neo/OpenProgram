import { jsonFetch } from "./fetch-client";

export type ActiveToolCall = {
  id: string; execution_id: string; session_id: string; tool_call_id?: string | null;
  name: string; description: string; command: string; started_at: number;
  status: "running" | "unknown";
};

export type ManagedProcess = {
  id: string;
  session_id: string | null;
  execution_id: string | null;
  tool_call_id?: string | null;
  command: string;
  display?: { name: string; kind: "executable" | "script" | "module" | "snippet" | "unknown" };
  cwd: string | null;
  status: string;
  started_at: number;
  ended_at: number | null;
  pid: number | null;
  exit_code: number | null;
  backend_id: string;
  truncated: boolean;
  can_stop?: boolean;
};
export const processIsActive = (process: ManagedProcess) =>
  ["starting", "running", "stopping", "unknown"].includes(process.status);
export const getSessionProcesses = (sessionId: string, signal?: AbortSignal) =>
  jsonFetch<{ items: ManagedProcess[]; calls?: ActiveToolCall[]; now: number }>(`/api/session/${encodeURIComponent(sessionId)}/processes`, { signal, cache: "no-store" });
export const getProcess = (id: string, signal?: AbortSignal, sessionId?: string | null) =>
  jsonFetch<{ process: ManagedProcess; output: string }>(`/api/process/${encodeURIComponent(id)}${sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ""}`, { signal, cache: "no-store" });
export const stopProcess = (id: string, sessionId?: string | null) =>
  jsonFetch<{ process: ManagedProcess }>(`/api/process/${encodeURIComponent(id)}/stop${sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ""}`, { method: "POST", body: JSON.stringify({}), headers: { "Content-Type": "application/json" } });
