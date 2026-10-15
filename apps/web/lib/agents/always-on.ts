// Always-on Agent status as the Agents page shows it, and a change signal
// the worker's always_on_update / always_on_report frames raise.
import { jsonFetch } from "@/lib/net/fetch-client";

/** A channel conversation (Telegram chat, Slack channel, WeChat contact…) reports go to. */
export type AlwaysOnChannelTarget = {
  channel: string;
  account_id: string;
  peer_id: string;
  label: string;
};

export type AlwaysOnConfig = {
  enabled: boolean;
  goal: string;
  wake_minutes: number;
  research: boolean;
  autonomy: "report" | "act";
  channels: AlwaysOnChannelTarget[];
};

export type AlwaysOnDelivery = AlwaysOnChannelTarget & {
  status: "sending" | "sent" | "failed";
  error?: string;
  detail?: string;
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
  deliveries?: AlwaysOnDelivery[];
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
  channel_targets: AlwaysOnChannelTarget[];
};

export const ALWAYS_ON_DEFAULTS: AlwaysOnConfig = {
  enabled: false, goal: "", wake_minutes: 60, research: true, autonomy: "report", channels: [],
};
export const ALWAYS_ON_CHANNELS_MAX = 10;
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

export function sameChannelTarget(a: AlwaysOnChannelTarget, b: AlwaysOnChannelTarget): boolean {
  return a.channel === b.channel && a.account_id === b.account_id && a.peer_id === b.peer_id;
}

/** Picked targets first (so one no longer listed can still be removed), then the rest. */
export function channelChoices(picked: AlwaysOnChannelTarget[], known: AlwaysOnChannelTarget[]): AlwaysOnChannelTarget[] {
  return [...picked, ...known.filter((target) => !picked.some((item) => sameChannelTarget(item, target)))];
}

export function toggleChannelTarget(picked: AlwaysOnChannelTarget[], target: AlwaysOnChannelTarget, on: boolean): AlwaysOnChannelTarget[] {
  const rest = picked.filter((item) => !sameChannelTarget(item, target));
  return on ? [...rest, target] : rest;
}
