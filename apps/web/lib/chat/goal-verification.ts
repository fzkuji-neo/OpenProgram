export interface GoalVerification {
  id: string;
  status: "pending" | "met" | "unmet" | "unavailable";
  reason?: string;
  requirements?: { id: string; text?: string; verdict?: string; reason?: string; evidence?: string[] }[];
}

export function verificationSummary(
  value: GoalVerification, status: string | undefined,
  text: (en: string, zh: string) => string,
): string {
  if (value.status === "met") {
    const todos = value.requirements?.filter(row => row.id.startsWith("todo:")) ?? [];
    return todos.length
      ? text(`Goal completed; ${todos.length}/${todos.length} todos verified`, `Goal 已完成，${todos.length}/${todos.length} 项待办通过验收`)
      : text("Goal completed; verification passed", "Goal 已完成，验收通过");
  }
  if (value.status === "unmet") return text("Verification did not pass; requirements remain unmet or uncertain", "验收未通过，仍有未满足或无法确认的要求");
  if (status === "cancelled") return text("Verification cancelled", "验收已取消");
  if (status === "error" || status === "interrupted") return text("Verification interrupted; result not confirmed", "验收已中断，结果未确认");
  return value.status === "pending"
    ? text("Checking verification results…", "正在核对验收结果…")
    : text("Verification result not confirmed", "验收结果未确认");
}
