// Always-on Agent status as the Agents page shows it, and a change signal
// the worker's always_on_update / always_on_report frames raise.
import { jsonFetch } from "@/lib/net/fetch-client";

export type AlwaysOnConfig = {
  enabled: boolean;
  goal: string;
  wake_minutes: number;
  research: boolean;
  autonomy: "report" | "act";
};

export type AlwaysOnWakeOutcome =
  | "disabled" | "busy" | "goal_started" | "goal_in_progress" | "goal_paused" | "check_in" | "idle";

export type AlwaysOnReport = {
  id: string;
  at: number;
  title: string;
  body: string;
  links: string[];
  session_id: string | null;
};

export type AlwaysOnStatus = {
  agent_id: string;
  config: AlwaysOnConfig;
  home_session_id: string | null;
  running: boolean;
  goal: { text: string; status: string } | null;
  last_wake: { at: number; reason: string; outcome: AlwaysOnWakeOutcome } | null;
  next_wake_at: number | null;
  memory_mode: string | null;
  reports: AlwaysOnReport[];
};

export const ALWAYS_ON_DEFAULTS: AlwaysOnConfig = {
  enabled: false, goal: "", wake_minutes: 60, research: true, autonomy: "report",
};
export const WAKE_MINUTES_MIN = 5;
export const WAKE_MINUTES_MAX = 10080;

const listeners = new Set<(agentId: string) => void>();

export function notifyAlwaysOnChanged(agentId: string): void {
  for (const listener of listeners) listener(agentId);
}

export function onAlwaysOnChanged(listener: (agentId: string) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

const path = (agentId: string) => `/api/agents/${encodeURIComponent(agentId)}/always-on`;

export function fetchAlwaysOn(agentId: string, signal?: AbortSignal): Promise<AlwaysOnStatus> {
  return jsonFetch<AlwaysOnStatus>(path(agentId), { signal });
}

export function wakeAlwaysOn(agentId: string): Promise<{ outcome: AlwaysOnWakeOutcome; session_id: string | null }> {
  return jsonFetch(`${path(agentId)}/wake`, { method: "POST" });
}

export function openAlwaysOnHome(agentId: string): Promise<{ session_id: string }> {
  return jsonFetch(`${path(agentId)}/home`, { method: "POST" });
}

/** A wake-minutes value the server accepts. */
export function wakeMinutesValid(value: number): boolean {
  return Number.isInteger(value) && value >= WAKE_MINUTES_MIN && value <= WAKE_MINUTES_MAX;
}
