import type { TNode } from "./tree-types";

type RecordValue = Record<string, unknown>;
type Text = (en: string, zh: string) => string;
export const GUI_TOOL_NAMES = new Set(["gui_agent", "computer_use", "browser_use", "vm_use"]);

export interface GuiStepView {
  capability: string;
  target: string;
  action: string;
  status: string;
  summary: string;
  blocker: string;
  handoff: string;
  screenshot?: string;
}

function object(value: unknown): RecordValue {
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return {}; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
}

function string(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Only local image artifacts go to the existing, server-authorized file viewer. */
export function recordedScreenshot(value: unknown): string | undefined {
  if (typeof value !== "string" || /[\x00-\x1f]/.test(value)) return undefined;
  const path = string(value);
  if ((!path.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(path))
      || path.startsWith("//") || /[\x00-\x1f]/.test(path)
      || !/\.(png|jpe?g|webp)$/i.test(path)) return undefined;
  return path;
}

export function guiStatus(output: unknown, executionStatus = ""): string {
  const result = object(output);
  // A stop/error on this execution takes precedence over its last successful step.
  if (["cancelled", "canceled", "cancelling", "interrupted", "paused", "pausing", "error", "failed"].includes(executionStatus)) {
    return executionStatus === "error" ? "failed" : executionStatus;
  }
  if (["running", "streaming", "pending", "queued"].includes(executionStatus)) return "running";
  const status = string(result.status);
  if (status === "infeasible" || result.infeasible_declared === true) return "infeasible";
  if (result.success === false || result.ok === false) return "failed";
  if (["applied", "succeeded", "failed", "cancelled", "interrupted", "paused", "infeasible", "unknown"].includes(status)) return status;
  // Function transport completion alone is not task-success evidence.
  return "unknown";
}

export function guiStatusLabel(status: string, text: Text): string {
  const labels: Record<string, [string, string]> = {
    running: ["Running", "运行中"], applied: ["Action applied", "动作已执行"],
    succeeded: ["Succeeded", "成功"], failed: ["Failed", "失败"],
    infeasible: ["Needs takeover", "需要接手"], cancelled: ["Cancelled", "已取消"],
    canceled: ["Cancelled", "已取消"], cancelling: ["Stopping…", "正在停止…"],
    interrupted: ["Interrupted", "已中断"], paused: ["Paused", "已暂停"],
    pausing: ["Pausing…", "正在暂停…"], unknown: ["Result unavailable", "结果不可用"],
  };
  return text(...(labels[status] ?? labels.unknown));
}

export function guiCapabilityLabel(name: string, text: Text): string {
  return name === "computer_use" ? text("Computer Use", "电脑操作")
    : name === "browser_use" ? text("Browser Use", "浏览器操作")
    : name === "vm_use" ? text("VM Use", "虚拟机操作") : "GUI Agent";
}

function stepView(capability: string, input: unknown, output: unknown, status = ""): GuiStepView {
  const params = object(input), result = object(output), step = object(result.step);
  const plan = object(step.plan), target = object(result.target);
  const actionResult = object(step.exec_result);
  return {
    capability,
    target: string(target.app_name) || string(params.app_name) || string(params.url),
    action: string(plan.call) || string(params.task),
    status: guiStatus(actionResult.success === false ? { ...result, success: false } : result, status),
    summary: string(result.summary) || string(actionResult.error),
    blocker: string(result.blocker) || string(step.blocker),
    handoff: string(result.handoff_instruction) || string(step.handoff_instruction),
    screenshot: recordedScreenshot(step.screenshot_artifact) || recordedScreenshot(result.screenshot_artifact)
      || recordedScreenshot(step.img_path) || recordedScreenshot(result.img_path),
  };
}

/** Project only GUI-owned data; generic tool results retain their existing renderer. */
export function guiToolView(node: {
  name: string; status: string; output?: unknown; params?: RecordValue; tree_root?: unknown;
}) {
  if (!GUI_TOOL_NAMES.has(node.name)) return null;
  const tree = object(node.tree_root) as TNode;
  const output = object(node.output ?? tree.output);
  const root = stepView(node.name, node.params, output, node.status);
  const steps: GuiStepView[] = [];
  if (Array.isArray(output.history)) {
    for (const value of output.history) {
      const entry = object(value);
      if (entry.type === "capability_call" && GUI_TOOL_NAMES.has(string(entry.capability))) {
        steps.push(stepView(string(entry.capability), entry.input, entry.output));
      }
    }
  }
  if (!steps.length && node.name === "gui_agent") {
    const seen = new Set<TNode>();
    const visit = (item: TNode) => {
      if (seen.has(item) || item.expose === "hidden") return;
      seen.add(item);
      if (item.name && GUI_TOOL_NAMES.has(item.name) && item.name !== "gui_agent") {
        steps.push(stepView(item.name, item.params, item.output, item.status));
        return; // A capability owns its nested planner and action calls.
      }
      for (const child of item.children ?? []) visit(child);
    };
    for (const child of tree.children ?? []) visit(child);
  }
  if (!steps.length && node.name !== "gui_agent") steps.push(root);
  return { ...root, steps };
}
