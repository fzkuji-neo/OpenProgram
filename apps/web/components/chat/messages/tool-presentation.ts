/**
 * How one tool call reads in the execution timeline: an icon, a tone
 * (colour family), a verb and the single argument that identifies the
 * call ("Ran `npm test`", "Edited `src/app.ts`"). Raw JSON never reaches
 * the row; the side panel still shows full params and output.
 */
// Type-only (erased at runtime), so the node unit tests can load this
// module without the `@/` alias.
import type { SolarIconName } from "../../solar-icons/bodies";

export type ToolTone =
  | "shell" | "edit" | "read" | "search" | "web" | "agent"
  | "memory" | "plan" | "media" | "system" | "function";

export interface ToolPresentation {
  /** Solar Bold Duotone glyph drawn in the row's tinted tile. */
  icon: SolarIconName;
  tone: ToolTone;
  /** Verb phrase, already localized. */
  title: string;
  /** The identifying argument (command, path, query, url…), if any. */
  target?: string;
}

type Text = (en: string, zh: string) => string;
type Args = Record<string, unknown>;

function str(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return undefined;
}

function pick(args: Args, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const v = str(args[key]);
    if (v) return v;
  }
  return undefined;
}

function firstLine(s: string | undefined): string | undefined {
  if (!s) return s;
  const line = s.split("\n").find((l) => l.trim());
  return line?.trim();
}

/** Shorten an absolute path to its last segments so the chip stays readable. */
function shortPath(p: string | undefined): string | undefined {
  if (!p) return p;
  const parts = p.split("/").filter(Boolean);
  return parts.length > 3 ? "…/" + parts.slice(-3).join("/") : p;
}

export function parseToolArgs(input?: string): Args {
  if (!input) return {};
  try {
    const v = JSON.parse(input);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Args) : { input: v };
  } catch {
    return { input };
  }
}

/** Any string-ish argument, for tools without a dedicated rule. */
function genericTarget(args: Args): string | undefined {
  return pick(args, "command", "action", "path", "file_path", "url", "query",
    "pattern", "name", "prompt", "description", "title", "input")
    ?? Object.values(args).map(str).find(Boolean);
}

export function presentTool(name: string, input: string | undefined, text: Text): ToolPresentation {
  const args = parseToolArgs(input);
  const path = shortPath(pick(args, "path", "file_path", "filename", "file"));
  switch (name) {
    case "bash":
    case "terminal_use":
    case "process":
      return { icon: "programming", tone: "shell", title: text("Ran", "运行"),
        target: firstLine(pick(args, "command", "cmd", "input", "action")) };
    case "execute_code":
      return { icon: "code-square", tone: "shell", title: text("Executed code", "执行代码"),
        target: pick(args, "language") ?? firstLine(pick(args, "code")) };
    case "edit":
      return { icon: "pen-new-square", tone: "edit", title: text("Edited", "修改"), target: path };
    case "write":
      return { icon: "pen-new-square", tone: "edit", title: text("Wrote", "写入"), target: path };
    case "apply_patch":
      return { icon: "pen-new-square", tone: "edit", title: text("Patched", "应用补丁"), target: path };
    case "read":
    case "pdf":
      return { icon: "file-text", tone: "read", title: text("Read", "读取"), target: path };
    case "list":
      return { icon: "folder-open", tone: "read", title: text("Listed", "列出"), target: path ?? "." };
    case "glob":
      return { icon: "file-search", tone: "search", title: text("Found files", "查找文件"),
        target: pick(args, "pattern", "glob") };
    case "grep":
      return { icon: "magnifier", tone: "search", title: text("Searched", "搜索"),
        target: pick(args, "pattern", "query", "regex") };
    case "semble_search":
    case "semble_find_related":
      return { icon: "magnifier", tone: "search", title: text("Searched code", "搜索代码"),
        target: pick(args, "query", "path", "symbol") };
    case "lsp_definition":
    case "lsp_references":
    case "lsp_diagnostics":
      return { icon: "structure", tone: "search", title: text("Inspected code", "代码分析"),
        target: pick(args, "symbol") ?? path };
    case "web_search":
      return { icon: "global", tone: "web", title: text("Searched the web", "网页搜索"),
        target: pick(args, "query", "q") };
    case "web_fetch":
      return { icon: "global", tone: "web", title: text("Fetched", "抓取网页"), target: pick(args, "url") };
    case "agent_browser":
    case "playwright_browser":
    case "web_use":
      return { icon: "cursor", tone: "web", title: text("Browser", "浏览器"),
        target: [pick(args, "command", "action"), pick(args, "url")].filter(Boolean).join(" ") || undefined };
    case "image_generate":
      return { icon: "gallery-add", tone: "media", title: text("Generated image", "生成图片"),
        target: firstLine(pick(args, "prompt")) };
    case "image_analyze":
      return { icon: "gallery", tone: "media", title: text("Analyzed image", "分析图片"),
        target: path ?? pick(args, "url") };
    case "canvas":
    case "send_file":
      return { icon: "plain-2", tone: "media", title: name === "canvas" ? text("Canvas", "画布") : text("Sent file", "发送文件"),
        target: path ?? genericTarget(args) };
    case "agent":
    case "task":
    case "mixture_of_agents":
    case "list_agents":
    case "archive_agent":
      return { icon: "bot", tone: "agent", title: text("Sub-agent", "子代理"),
        target: firstLine(pick(args, "description", "name", "prompt", "task")) };
    case "send_message":
      return { icon: "plain-2", tone: "agent", title: text("Messaged", "发送消息"),
        target: pick(args, "to", "agent", "name") };
    case "read_conversation":
      return { icon: "book", tone: "read", title: text("Read conversation", "读取对话"),
        target: genericTarget(args) };
    case "ask_user_question":
      return { icon: "chat-round-question-mark", tone: "plan", title: text("Asked", "提问"),
        target: firstLine(pick(args, "question", "prompt")) };
    case "enter_plan_mode":
    case "exit_plan_mode":
      return { icon: "map", tone: "plan", title: name === "enter_plan_mode" ? text("Planning", "进入规划") : text("Plan ready", "规划完成") };
    case "cron":
    case "scheduler":
    case "list_jobs":
    case "job_output":
      return { icon: "calendar", tone: "plan", title: text("Scheduled", "定时任务"),
        target: genericTarget(args) };
    case "program":
      return { icon: "box", tone: "function", title: text("Ran program", "运行程序"),
        target: pick(args, "name", "program", "path") };
    case "skill":
      return { icon: "stars", tone: "function", title: text("Used skill", "使用技能"),
        target: pick(args, "name", "skill") };
    case "resource":
      return { icon: "database", tone: "read", title: text("Resource", "资源"), target: genericTarget(args) };
  }
  if (name.startsWith("todo_")) {
    return { icon: "checklist", tone: "plan", title: text("Updated todos", "更新待办"),
      target: firstLine(pick(args, "title", "content", "text")) };
  }
  if (name.startsWith("memory_")) {
    return { icon: "database", tone: "memory", title: text("Memory", "记忆"),
      target: pick(args, "query", "key", "path", "content") };
  }
  if (name.startsWith("worktree_")) {
    return { icon: "git-branch", tone: "system", title: text("Worktree", "工作树"),
      target: name.slice("worktree_".length) };
  }
  if (name.startsWith("self_update")) {
    return { icon: "refresh", tone: "system", title: text("Self-update", "自我更新"),
      target: name.replace(/^self_update_?/, "") || undefined };
  }
  if (name.includes("mcp")) {
    return { icon: "plug-circle", tone: "system", title: "MCP", target: genericTarget(args) };
  }
  return { icon: "sledgehammer", tone: "function", title: name || text("Function", "函数"),
    target: genericTarget(args) };
}

/** One readable line for a tool result. JSON objects and arrays are
 *  summarised by their telling fields instead of printed raw. */
export function summarizeResult(raw: string, text: Text): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return firstLine(trimmed) ?? "";
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    // Stored results are often truncated mid-object; still pull out the
    // telling string fields rather than echoing the braces.
    const found: string[] = [];
    for (const key of ["error", "title", "message", "summary", "status", "url"]) {
      const m = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(trimmed);
      if (m?.[1]) found.push(m[1]);
      if (found.length >= 2) break;
    }
    return found.length ? found.join(" · ") : text("structured output", "结构化输出");
  }
  if (Array.isArray(value)) {
    return value.length === 1 ? text("1 item", "1 项") : text(`${value.length} items`, `${value.length} 项`);
  }
  if (!value || typeof value !== "object") return String(value);
  const obj = value as Args;
  const pieces: string[] = [];
  const failed = obj.ok === false || obj.success === false || typeof obj.error === "string";
  if (failed) pieces.push(str(obj.error) ?? text("failed", "失败"));
  for (const key of ["title", "message", "summary", "status", "url", "path", "result", "output"]) {
    const v = str(obj[key]);
    if (v && !pieces.includes(v)) pieces.push(firstLine(v) ?? v);
    if (pieces.length >= 2) break;
  }
  if (pieces.length === 0) {
    const nested = Object.values(obj).find((v) => Array.isArray(v)) as unknown[] | undefined;
    if (nested) pieces.push(text(`${nested.length} items`, `${nested.length} 项`));
    else pieces.push(obj.ok === true || obj.success === true ? text("done", "完成") : text(`${Object.keys(obj).length} fields`, `${Object.keys(obj).length} 个字段`));
  }
  return pieces.join(" · ");
}
