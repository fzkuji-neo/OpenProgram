import type { ChatMsg } from "../session-store/types";

export type ActivityPhase = "thinking" | "tool" | "generating";

/** Presentation only: execution ownership and terminal status remain authoritative. */
export function activityPhase(msg: ChatMsg): ActivityPhase | null {
  if (!["pending", "running", "streaming", "cancelling"].includes(msg.status ?? "")) return null;
  if (msg.retryStatus) return "thinking";
  if (msg.display === "runtime" || msg.function) return "tool";
  if (msg.tools?.some((tool) => tool.status === "running")) return "tool";
  const last = msg.blocks?.at(-1);
  if (last?.type === "thinking") return "thinking";
  if (last?.type === "text" && last.text) return "generating";
  if (last?.type === "tool") return "thinking";
  return msg.content ? "generating" : "thinking";
}
