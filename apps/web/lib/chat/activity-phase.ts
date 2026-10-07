import type { AssistantBlock, ChatMsg } from "../session-store/types";

export type ActivityPhase = "thinking" | "tool" | "generating";

/** Agentic calls live only in ordered blocks; ordinary tools also have a status record. */
export function isRunningToolBlock(msg: ChatMsg, block: AssistantBlock): boolean {
  if (block.type !== "tool") return false;
  const tool = block.tool_call_id
    ? msg.tools?.find((item) => item.id === block.tool_call_id) : undefined;
  if (tool) return tool.status === "running";
  return block.result == null && !block.is_error
    && (!block.outcome || block.outcome === "waiting");
}

/** Presentation only: execution ownership and terminal status remain authoritative. */
export function activityPhase(msg: ChatMsg): ActivityPhase | null {
  if (!["pending", "running", "streaming", "cancelling"].includes(msg.status ?? "")) return null;
  if (msg.retryStatus) return "thinking";
  if (msg.display === "runtime" || msg.function) return "tool";
  if (msg.tools?.some((tool) => tool.status === "running")
      || msg.blocks?.some((block) => isRunningToolBlock(msg, block))) return "tool";
  const last = msg.blocks?.at(-1);
  if (last?.type === "thinking") return "thinking";
  if (last?.type === "text" && last.text) return "generating";
  if (last?.type === "tool") return "thinking";
  return msg.content ? "generating" : "thinking";
}
