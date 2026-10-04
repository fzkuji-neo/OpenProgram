export type ToolPolicy = {
  mode: "automatic" | "selected" | "none";
  preset?: string;
  allowed?: string[];
  disabled?: string[];
  web_search?: boolean;
};
export type GatePolicy = { allowed: string[]; disabled: string[]; categories?: string[] };
export type McpPolicy = GatePolicy & { required: string[] };
export type MemorySpace = "self" | "legacy_global";
export type AgentMemory = {
  mode: "off" | "read_only" | "read_write";
  read_spaces: MemorySpace[];
  write_space: MemorySpace;
  required: boolean;
};
/** Editable, persisted fields. Invocation snapshots use this same shape. */
export type AgentConfigDTO = {
  name: string;
  description: string;
  model: { provider: string; id: string };
  thinking_effort: string;
  system_prompt: string;
  skills: GatePolicy;
  tools: ToolPolicy;
  mcp: McpPolicy;
  memory: AgentMemory;
  identity: { name: string; mention_patterns: string[] };
  session_scope: string;
  session_idle_minutes: number;
  session_daily_reset: string;
};
export type Agent = AgentConfigDTO & {
  id: string;
  default: boolean;
  revision: number;
  created_at: number;
  updated_at: number;
};
export type Text = (english: string, chinese: string) => string;
export type TabId = "overview" | "programs" | "skills" | "mcp" | "memory" | "context" | "advanced";
export const TABS: Array<{ id: TabId; en: string; zh: string }> = [
  { id: "overview", en: "General", zh: "常规" },
  { id: "programs", en: "Programs", zh: "Programs" },
  { id: "skills", en: "Skills", zh: "Skills" },
  { id: "mcp", en: "MCP", zh: "MCP" },
  { id: "memory", en: "Memory", zh: "长期记忆" },
  { id: "context", en: "Context", zh: "上下文" },
  { id: "advanced", en: "Advanced", zh: "高级" },
];
export const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export function normalizeAgent(raw: Agent): Agent {
  return {
    ...raw, description: raw.description ?? "", revision: raw.revision ?? 0,
    memory: raw.memory ?? { mode: "read_write", read_spaces: ["legacy_global"], write_space: "legacy_global", required: false },
    skills: { ...raw.skills, allowed: raw.skills?.allowed ?? [], disabled: raw.skills?.disabled ?? [], categories: raw.skills?.categories ?? [] },
    mcp: { ...raw.mcp, allowed: raw.mcp?.allowed ?? [], disabled: raw.mcp?.disabled ?? [], required: raw.mcp?.required ?? [] },
  };
}
export function configuration(agent: Agent): AgentConfigDTO {
  return clone({
    name: agent.name, description: agent.description, model: agent.model,
    thinking_effort: agent.thinking_effort, system_prompt: agent.system_prompt,
    skills: agent.skills, tools: agent.tools, mcp: agent.mcp, memory: agent.memory,
    identity: agent.identity, session_scope: agent.session_scope,
    session_idle_minutes: agent.session_idle_minutes,
    session_daily_reset: agent.session_daily_reset,
  });
}
export function policyMode(policy: GatePolicy): "all" | "selected" | "none" {
  if (policy.disabled.includes("*")) return "none";
  return policy.allowed.length || policy.categories?.length ? "selected" : "all";
}
export function selectedProgramNames(policy: ToolPolicy, presets: Record<string, string[]>): string[] {
  return policy.mode !== "selected" ? [] : policy.preset ? presets[policy.preset] || [] : policy.allowed || [];
}
export function trialConfiguration(agent: Agent): AgentConfigDTO {
  const config = configuration(agent);
  config.memory.mode = config.memory.mode === "off" ? "off" : "read_only";
  return config;
}
