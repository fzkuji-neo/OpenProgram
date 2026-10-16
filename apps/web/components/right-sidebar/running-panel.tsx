"use client";

/**
 * Activity: the conversation's agent branches. The main conversation comes
 * first, the sub-agents it started hang under it as a tree, and each row
 * opens a page; what needs the reader is listed above them and background
 * programs below. The arrow at the top goes back one level. Nothing expands
 * in place and no group folds.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronRight, MessageSquareText } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { useSessionStore } from "@/lib/session-store";
import { useExecutionDebugger } from "@/lib/execution/use-execution-debugger";
import { useManagedProcesses } from "@/lib/execution/use-managed-processes";
import { processIsActive, stopProcess, type ActiveToolCall, type AgentCall, type ManagedProcess } from "@/lib/net/process-client";
import { buildExecutionCommand, canExecuteAction, newCommandId, type ExecutionSnapshot } from "@/lib/execution/execution-debugger";
import { activityModel, agentBranches, executionPending, spawnedBy, startedAt, type ActivityIssue } from "@/lib/execution/activity-model";
import { loadSubAgentTranscript } from "@/lib/chat/sub-agent-transcripts";
import { sendRuntimeCommand } from "@/lib/runtime-bridge/session-load";
import { SolarIcon, type SolarIconName } from "@/components/solar-icons";
import { presentTool, type ToolTone } from "@/components/chat/messages/tool-presentation";
import { SectionHeader } from "@/components/sidebar/section-header";
import { Button } from "@/components/ui/button";
import { DebuggerPanel } from "./debugger-panel";
import { SidebarNotice } from "./sidebar-notice";
import { executionTitle, shortTime, updatedTime } from "./debugger-presentation";
import styles from "./running-panel.module.css";

type Text = (en: string, zh: string) => string;
type Tone = "warn" | "run" | "ok" | "err" | "muted";
type View = { kind: "main" | "run" | "call" | "spawn" | "program" | "tech"; id: string };

const PAGE = 20;
const LIVE = ["queued", "running", "pausing", "cancelling"];
const DOT: Record<Tone, string> = {
  warn: "--warn", run: "--neutral pulse-opacity", ok: "--ok", err: "--err", muted: "is-muted",
};

function Glyph({ name, tone }: { name: SolarIconName; tone: ToolTone | "run" }) {
  return <span className={styles.glyph} data-tone={tone} aria-hidden="true">
    <SolarIcon name={name} size={16} motionPreset="none" />
  </span>;
}

/** A conversation or a run: a line glyph in the text colour. */
function RunGlyph() {
  return <span className={styles.glyph} data-tone="run" aria-hidden="true"><MessageSquareText size={15} strokeWidth={1.8} /></span>;
}

function Status({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={styles.status} data-tone={tone}>
    <span className={`indicator-dot sm ${DOT[tone]}`} aria-hidden="true" />
    <span className={styles.statusText}>{children}</span>
  </span>;
}

function Row({ glyph, title, status, tone, onOpen, depth = 0 }: {
  glyph: ReactNode; title: string; status: ReactNode; tone: Tone; onOpen: () => void; depth?: number;
}) {
  const row = <Button variant="ghost" className={styles.row} onClick={onOpen}>
    {glyph}
    <span className={styles.rowText}><span className={styles.name}>{title}</span><Status tone={tone}>{status}</Status></span>
    <ChevronRight size={14} className={styles.chevron} aria-hidden="true" />
  </Button>;
  // A sub-agent sits under the branch that started it, joined by a line.
  return depth > 0
    ? <div className={styles.branch} style={{ "--depth": Math.min(depth, 4) } as CSSProperties}>{row}</div>
    : row;
}

function duration(seconds: number, text: Text): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return text(`${s} s`, `${s} 秒`);
  const m = Math.round(s / 60);
  if (m < 60) return text(`${m} min`, `${m} 分钟`);
  const h = Math.floor(m / 60), rest = m % 60;
  return rest ? text(`${h} h ${rest} min`, `${h} 小时 ${rest} 分`) : text(`${h} h`, `${h} 小时`);
}

function dayLabel(seconds: number, text: Text): string {
  const day = new Date(seconds * 1000); day.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - day.getTime()) / 86400000);
  if (diff === 0) return text("Today", "今天");
  if (diff === 1) return text("Yesterday", "昨天");
  return day.toLocaleDateString([], { month: "short", day: "numeric", ...(day.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) });
}

/** The time of day for today, the date and time before that. */
function when(seconds: number): string {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return seconds * 1000 >= today.getTime() ? shortTime(seconds * 1000) : updatedTime(seconds);
}

/** What kind of thing a call is, in the reader's words. */
function callKind(call: ActiveToolCall, text: Text): string {
  const tone = presentTool(call.name, undefined, text).tone;
  if (tone === "agent") return text("Sub-agent", "子代理");
  if (tone === "shell") return text("Command", "命令");
  return call.name;
}

function executionTone(item: ExecutionSnapshot): Tone {
  if (executionPending(item)) return "warn";
  if (LIVE.includes(item.status)) return "run";
  if (item.status === "completed") return "ok";
  if (["failed", "interrupted"].includes(item.status)) return "err";
  return "muted";
}

function executionState(item: ExecutionSnapshot, text: Text): string {
  if (item.reason_code === "wait_declined") return text("Declined", "已拒绝");
  if (item.status === "paused" && item.reason_code === "wait_open") return text("Waiting for your answer", "等你回答");
  return text(...({
    queued: ["Waiting to start", "等待开始"], running: ["Running", "正在运行"], pausing: ["Pausing", "正在暂停"],
    paused: ["Paused", "已暂停"], cancelling: ["Stopping", "正在停止"],
    reconciliation_required: executionPending(item) ? ["Stopped", "已停止"] : ["Ended", "已结束"],
    completed: ["Completed", "已完成"], failed: ["Failed", "失败"], cancelled: ["Stopped", "已停止"], interrupted: ["Interrupted", "中断"],
  }[item.status] as [string, string] | undefined || ["Status unavailable", "状态不可用"]));
}

function programState(item: ManagedProcess, text: Text): string {
  return text(...({
    starting: ["Starting", "正在启动"], running: ["Running", "正在运行"], stopping: ["Stopping", "正在停止"],
    completed: ["Completed", "已完成"], exited: ["Exited", "已退出"], failed: ["Failed", "失败"],
    stopped: ["Stopped", "已停止"], interrupted: ["Interrupted", "中断"], unknown: ["State unconfirmed", "状态待确认"], lost: ["State unconfirmed", "状态待确认"],
  }[item.status] as [string, string] | undefined || [item.status, item.status]));
}

function programTone(item: ManagedProcess): Tone {
  if (["unknown", "lost"].includes(item.status)) return "warn";
  if (processIsActive(item)) return "run";
  if (["completed", "exited"].includes(item.status)) return "ok";
  if (item.status === "failed") return "err";
  return "muted";
}

function programName(item: ManagedProcess, text: Text): string {
  const display = item.display;
  if (display?.kind === "snippet") return `${display.name} ${text("snippet", "代码片段")}`;
  return display?.name || item.command.trim().match(/^(?:[^\s=]+=[^\s]+\s+)*([^\s]+)/)?.[1]?.split("/").pop() || text("Program", "程序");
}

/** A call that started no sub-agent: why, in the reader's words. */
function spawnState(item: AgentCall, text: Text): string {
  return item.failed ? text("Failed to start", "没有启动成功") : text("Not started", "没有启动");
}

export function RunningPanel({ active, sessionId }: { active: boolean; sessionId: string | null }) {
  const { text } = useTranslation();
  const [stack, setStack] = useState<View[]>([]);
  const view = stack.at(-1) ?? null;
  const state = useExecutionDebugger(active, sessionId, undefined, view?.kind === "tech");
  const processes = useManagedProcesses(active, sessionId, view?.kind === "program" ? view.id : null);
  const conversationTitle = useSessionStore(s => (sessionId ? s.conversations[sessionId]?.title : undefined) || "");
  const [shown, setShown] = useState(PAGE);
  const [programsShown, setProgramsShown] = useState(PAGE);
  const [taskOpen, setTaskOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  useEffect(() => { setStack([]); setShown(PAGE); setProgramsShown(PAGE); }, [sessionId]);
  useEffect(() => { setTaskOpen(false); setActionError(null); }, [view?.kind, view?.id]);

  const readFailed = processes.stale || (
    state.connection.errorSessionId === sessionId && Boolean(state.connection.message)
    && ["stale", "conflict"].includes(state.connection.state)
  );
  const hasRead = Boolean(state.fetchedAt) || processes.loaded;
  const [readNotice, setReadNotice] = useState<{ sessionId: string | null; persistent: boolean } | null>(null);
  useEffect(() => {
    setReadNotice(null);
    if (!active || !readFailed) return;
    const retry = setTimeout(() => setReadNotice({ sessionId, persistent: false }), 5000);
    const persistent = setTimeout(() => setReadNotice({ sessionId, persistent: true }), 30000);
    return () => { clearTimeout(retry); clearTimeout(persistent); };
  }, [active, sessionId, readFailed]);

  if (!sessionId) return <SidebarNotice>{text("Select or start a conversation to view what it runs.", "选择或开始一个会话，查看它运行的内容。")}</SidebarNotice>;

  // Until the executions are read every call and program would look unowned.
  const executions = state.fetchedAt ? state.executions : [];
  const calls = state.fetchedAt ? processes.calls || [] : [];
  const spawns = state.fetchedAt ? processes.spawns || [] : [];
  const model = activityModel(executions, processes.items, calls);
  const branches = agentBranches(executions);
  const now = Date.now() / 1000;
  const open = (next: View) => setStack(previous => [...previous, next]);
  const openTech = (executionId: string) => { state.selectExecution(executionId); open({ kind: "tech", id: executionId }); };
  const execution = (id: string) => executions.find(item => item.execution_id === id) ?? null;
  const call = (id: string) => calls.find(item => item.id === id) ?? null;
  const spawn = (id: string) => spawns.find(item => item.id === id) ?? null;
  const program = (id: string) => processes.items.find(item => item.id === id) ?? null;
  const runTitle = (item: ExecutionSnapshot) => executionTitle(item, 1, text);
  const isAgent = (item: ExecutionSnapshot) => item.display?.kind === "job_agent";
  const agentName = (item: ExecutionSnapshot) => (item.display?.label || runTitle(item)).replace(/_/g, " ");
  const mainName = text("Main conversation", "主对话");
  /** Executions a branch runs itself: the agent (null: the main
   *  conversation) and the executions under it that no deeper agent owns. */
  const ownedBy = (owner: string | null) => new Set(executions.filter(item => branches.ownerOf(item) === owner).map(item => item.execution_id));
  /** The sub-agent an `agent` call started, when it is listed: the one its
   *  transcript row was paired with, else the job that began right after it. */
  const agentOf = (entry: ActiveToolCall) => {
    if (entry.name !== "agent") return null;
    const paired = entry.tool_call_id ? spawns.find(item => item.job_id && item.id.endsWith(`_t_${entry.tool_call_id}`)) : undefined;
    return (paired?.job_id ? execution(paired.job_id) : null) ?? spawnedBy(entry, model.childrenOf(entry.execution_id));
  };
  /** Everything an agent covers: itself and every execution under it. */
  const subtreeOf = (item: ExecutionSnapshot) => {
    const ids = new Set<string>();
    const walk = (entry: ExecutionSnapshot) => { if (ids.has(entry.execution_id)) return; ids.add(entry.execution_id); model.childrenOf(entry.execution_id).forEach(walk); };
    walk(item);
    return ids;
  };
  /** What waits on the reader inside an agent, including the stopped call that started it. */
  const issuesOf = (item: ExecutionSnapshot) => {
    const ids = subtreeOf(item);
    return model.issues.filter(issue => issue.kind === "call"
      ? ids.has(issue.call.execution_id) || agentOf(issue.call)?.execution_id === item.execution_id
      : issue.kind === "execution" ? ids.has(issue.execution.execution_id)
        : Boolean(issue.program.execution_id && ids.has(issue.program.execution_id)));
  };
  const activeIn = (ids: Set<string>) => executions.some(entry => ids.has(entry.execution_id) && LIVE.includes(entry.status))
    || calls.some(entry => ids.has(entry.execution_id) && entry.status === "running")
    || processes.items.some(entry => entry.execution_id && ids.has(entry.execution_id) && processIsActive(entry));
  /** Calls that started no sub-agent, made by this branch (null: the main conversation). */
  const failedSpawns = (owner: string | null) => spawns.filter(item => !item.job_id && (item.owner_job_id ?? null) === owner
    && (owner === null || executions.some(entry => entry.execution_id === owner)));

  // ---- the main conversation ---------------------------------------------------
  const mainIds = ownedBy(null);
  const mainRuns = executions.filter(item => mainIds.has(item.execution_id) && !branches.parentOf(item)).sort((a, b) => startedAt(b) - startedAt(a));
  const latestRun = mainRuns[0] ?? null;
  // Calls and programs whose execution is not listed belong to the conversation itself.
  const mainCalls = calls.filter(entry => entry.status === "running" && (mainIds.has(entry.execution_id) || !execution(entry.execution_id)));
  const mainPrograms = processes.items.filter(entry => processIsActive(entry) && entry.execution_id && mainIds.has(entry.execution_id));
  const mainLive = executions.some(entry => mainIds.has(entry.execution_id) && LIVE.includes(entry.status)) || mainCalls.length > 0 || mainPrograms.length > 0;
  const mainIssues = model.issues.filter(issue => issue.kind === "call"
    ? !agentOf(issue.call) && (mainIds.has(issue.call.execution_id) || !execution(issue.call.execution_id))
    : issue.kind === "execution" ? mainIds.has(issue.execution.execution_id)
      : !issue.program.execution_id || mainIds.has(issue.program.execution_id));
  function mainStatus(): { label: string; tone: Tone } {
    if (mainLive) {
      const step = mainCalls.at(-1);
      const since = executions.filter(entry => mainIds.has(entry.execution_id) && LIVE.includes(entry.status)).map(startedAt).sort((a, b) => a - b)[0]
        ?? step?.started_at ?? now;
      const doing = !step ? text("Running", "正在运行")
        : step.name === "agent" ? text("Waiting for a sub-agent", "等待子代理")
          : `${text("Running", "正在运行")} ${step.description || step.name}`;
      return { label: `${doing} · ${duration(now - since, text)}`, tone: "run" };
    }
    if (!latestRun) return mainIssues.length
      ? { label: text(`${mainIssues.length} to handle`, `有 ${mainIssues.length} 项待处理`), tone: "warn" }
      : { label: text("No runs yet", "还没有运行"), tone: "muted" };
    const at = when(latestRun.terminal_at ?? latestRun.updated_at ?? startedAt(latestRun));
    if (mainIssues.length && latestRun.status !== "paused") return { label: `${text(`${mainIssues.length} to handle`, `有 ${mainIssues.length} 项待处理`)} · ${text("last", "上次")} ${at}`, tone: "warn" };
    if (latestRun.status === "paused" || executionPending(latestRun)) return { label: `${executionState(latestRun, text)} · ${at}`, tone: "warn" };
    if (latestRun.status === "completed" || latestRun.status === "reconciliation_required") return { label: `${text("Idle", "空闲")} · ${text("last", "上次")} ${at}`, tone: "muted" };
    if (["failed", "interrupted"].includes(latestRun.status)) { const what = executionState(latestRun, text); return { label: `${text(`Last run ${what.toLowerCase()}`, `上次运行${what}`)} · ${at}`, tone: "err" }; }
    return { label: `${executionState(latestRun, text)} · ${at}`, tone: "muted" };
  }

  function viewTitle(entry: View): string {
    if (entry.kind === "main") return mainName;
    if (entry.kind === "call") { const item = call(entry.id); return item ? item.description || item.name : text("Call", "调用"); }
    if (entry.kind === "spawn") { const item = spawn(entry.id); return item?.description || text("Sub-agent", "子代理"); }
    if (entry.kind === "program") { const item = program(entry.id); return item ? programName(item, text) : text("Program", "程序"); }
    const item = execution(entry.id);
    return item ? isAgent(item) ? agentName(item) : runTitle(item) : text("Run", "运行");
  }

  async function endRun(item: ExecutionSnapshot) {
    setPending(item.execution_id); setActionError(null);
    try {
      const result = await state.command(buildExecutionCommand(item, "cancel", newCommandId()));
      if (result && result.status === "rejected") setActionError(text("The run could not be marked as ended. Its status updates automatically.", "没能标为已结束，状态会自动更新。"));
    } catch { setActionError(text("The run could not be marked as ended. Its status updates automatically.", "没能标为已结束，状态会自动更新。")); }
    finally { setPending(null); }
  }

  async function openAgentConversation(job: ExecutionSnapshot) {
    const target = await loadSubAgentTranscript(sessionId!, job.execution_id, { jobId: job.execution_id, headId: job.display?.assistant_message_id })
      || job.display?.assistant_message_id;
    if (!target) return;
    sendRuntimeCommand({ action: "checkout_branch", session_id: sessionId, head_msg_id: target });
    sendRuntimeCommand({ action: "load_session", session_id: sessionId });
  }

  /** The sub-agents a branch started and its calls that started none, newest first. */
  function startedNewestFirst(agents: ExecutionSnapshot[], failed: AgentCall[]): ReactNode[] {
    return [...agents.map(item => ({ at: startedAt(item), node: agentRow(item) })), ...failed.map(item => ({ at: item.at, node: spawnRow(item) }))]
      .sort((a, b) => b.at - a.at).map(entry => entry.node);
  }

  // ---- rows ----------------------------------------------------------------
  function mainRow(): ReactNode {
    const { label, tone } = mainStatus();
    return <Row key="main" glyph={<RunGlyph />} title={mainName} status={label} tone={tone} onOpen={() => open({ kind: "main", id: "main" })} />;
  }
  function agentRow(item: ExecutionSnapshot, depth = 0): ReactNode {
    const ids = subtreeOf(item);
    const issues = issuesOf(item);
    const live = activeIn(ids);
    const runningCall = calls.filter(entry => ids.has(entry.execution_id) && entry.status === "running").at(-1);
    const status = issues.length
      ? issues.length === 1 && issues[0].kind === "call" ? `${text("Stopped", "已停止")} · ${when(issues[0].at)}` : text(`${issues.length} to handle`, `有 ${issues.length} 项待处理`)
      : live
        ? `${runningCall ? `${text("Running", "正在运行")} ${runningCall.description || runningCall.name}` : text("Running", "正在运行")} · ${duration(now - startedAt(item), text)}`
        : `${executionState(item, text)} · ${when(startedAt(item))}`;
    return <Row key={`agent:${item.execution_id}`} depth={depth} glyph={<Glyph name="bot" tone="agent" />} title={agentName(item)}
      status={status} tone={issues.length ? "warn" : live ? "run" : executionTone(item)}
      onOpen={() => open({ kind: "run", id: item.execution_id })} />;
  }
  function spawnRow(item: AgentCall, depth = 0): ReactNode {
    return <Row key={`spawn:${item.id}`} depth={depth} glyph={<Glyph name="bot" tone="agent" />} title={item.description || text("Sub-agent", "子代理")}
      status={`${spawnState(item, text)} · ${when(item.at)}`} tone={item.failed ? "err" : "muted"}
      onOpen={() => open({ kind: "spawn", id: item.id })} />;
  }
  function callRow(item: ActiveToolCall, withKind = true): ReactNode {
    const look = presentTool(item.name, undefined, text);
    const phase = item.status === "running" ? `${text("Running", "正在运行")} · ${duration(now - item.started_at, text)}` : text("Stopped", "已停止");
    return <Row key={`call:${item.id}`} glyph={<Glyph name={look.icon} tone={look.tone} />} title={item.description || item.name}
      status={withKind ? `${callKind(item, text)} · ${phase}` : phase} tone={item.status === "running" ? "run" : "warn"}
      onOpen={() => open({ kind: "call", id: item.id })} />;
  }
  function programRow(item: ManagedProcess): ReactNode {
    return <Row key={`program:${item.id}`} glyph={<Glyph name="code-square" tone="shell" />} title={programName(item, text)}
      status={`${programState(item, text)} · ${processIsActive(item) ? duration(now - item.started_at, text) : when(item.started_at)}`} tone={programTone(item)}
      onOpen={() => open({ kind: "program", id: item.id })} />;
  }
  function runRow(item: ExecutionSnapshot): ReactNode {
    return <Row key={`execution:${item.execution_id}`} glyph={<RunGlyph />} title={runTitle(item)}
      status={`${executionState(item, text)} · ${when(startedAt(item))}`} tone={executionTone(item)}
      onOpen={() => open({ kind: "run", id: item.execution_id })} />;
  }
  function childRow(item: ExecutionSnapshot): ReactNode {
    if (isAgent(item)) return agentRow(item);
    return <Row key={`execution:${item.execution_id}`} glyph={<RunGlyph />} title={runTitle(item)}
      status={`${text("Branch", "分支")} · ${executionState(item, text)}`} tone={executionTone(item)}
      onOpen={() => open({ kind: "run", id: item.execution_id })} />;
  }
  function issueRow(issue: ActivityIssue): ReactNode {
    if (issue.kind === "call") {
      const job = agentOf(issue.call);
      if (job) return <Row key={issue.key} glyph={<Glyph name="bot" tone="agent" />} title={agentName(job)}
        status={`${text("Sub-agent stopped", "子代理已停止")} · ${dayLabel(issue.at, text)}`} tone="warn"
        onOpen={() => open({ kind: "run", id: job.execution_id })} />;
      const look = presentTool(issue.call.name, undefined, text);
      return <Row key={issue.key} glyph={<Glyph name={look.icon} tone={look.tone} />} title={issue.call.description || issue.call.name}
        status={`${callKind(issue.call, text)}${text(" stopped", "已停止")} · ${dayLabel(issue.at, text)}`} tone="warn"
        onOpen={() => open({ kind: "call", id: issue.call.id })} />;
    }
    if (issue.kind === "program") {
      return <Row key={issue.key} glyph={<Glyph name="code-square" tone="shell" />} title={programName(issue.program, text)}
        status={`${text("Program state unconfirmed", "后台程序状态待确认")} · ${dayLabel(issue.at, text)}`} tone="warn"
        onOpen={() => open({ kind: "program", id: issue.program.id })} />;
    }
    return <Row key={issue.key} glyph={issue.execution.status === "paused" ? <Glyph name="chat-round-question-mark" tone="run" /> : <RunGlyph />}
      title={runTitle(issue.execution)} status={`${executionState(issue.execution, text)} · ${dayLabel(issue.at, text)}`} tone="warn"
      onOpen={() => open({ kind: "run", id: issue.execution.execution_id })} />;
  }

  // ---- issue block on a page --------------------------------------------------
  function issueBlock(issue: ActivityIssue, here: "run" | "agent" | "call" | "program"): ReactNode {
    let heading = "", body = "";
    const actions: ReactNode[] = [];
    const owner = issue.kind === "call" ? issue.owner : issue.kind === "execution" ? issue.execution : null;
    if (issue.kind === "call") {
      const name = issue.call.description || issue.call.name;
      heading = here === "call" || here === "agent" ? "" : text(`${callKind(issue.call, text)} "${name}" stopped`, `${callKind(issue.call, text)}“${name}”已停止`);
      body = here === "agent"
        ? text("The run stopped before this sub-agent finished.", "运行停止了，这个子代理没有做完。")
        : text("The run stopped before this call returned.", "运行在这次调用返回前停止了。");
      const job = agentOf(issue.call);
      if (job && here !== "agent") actions.push(<Button key="agent" variant="elevated" size="sm" onClick={() => void openAgentConversation(job)}>{text("Open its conversation", "打开它的对话")}</Button>);
    } else if (issue.kind === "execution") {
      const waiting = issue.execution.status === "paused";
      heading = waiting ? text("Waiting for you", "在等你处理") : text("Stopped during an action", "在一个操作途中停止了");
      body = waiting
        ? text("This run paused on a question or an approval.", "这次运行停在一个问题或审批上。")
        : text("The run stopped before an action returned.", "运行在一个操作返回前停止了。");
      actions.push(<Button key="tech" variant="elevated" size="sm" onClick={() => openTech(issue.execution.execution_id)}>{waiting ? text("Answer", "去处理") : text("See details", "查看详情")}</Button>);
    } else {
      heading = here === "program" ? "" : text(`Program "${programName(issue.program, text)}": state unconfirmed`, `后台程序“${programName(issue.program, text)}”状态待确认`);
      body = text("Its supervisor is unavailable, so whether it exited is not known. The record is kept.", "程序监督进程不可用，不确定它是否已退出，记录仍保留。");
      if (here !== "program") actions.push(<Button key="program" variant="elevated" size="sm" onClick={() => open({ kind: "program", id: issue.program.id })}>{text("See the program", "查看程序")}</Button>);
    }
    if (owner && executionPending(owner) && canExecuteAction(owner, "cancel")) {
      actions.push(<Button key="end" variant="elevated" size="sm" disabled={pending === owner.execution_id} onClick={() => void endRun(owner)}>
        {pending === owner.execution_id ? text("Marking…", "正在标记…") : text("Mark as ended", "标为已结束")}</Button>);
    }
    return <div className={styles.issue} key={issue.key}>
      {heading && <h4 className={styles.issueTitle}>{heading}</h4>}
      <p className={styles.issueText}>{body}</p>
      {actions.length > 0 && <div className={styles.actions}>{actions}</div>}
    </div>;
  }

  const backBar = (fallback: string) => <div className={styles.toolbar}>
    <Button variant="ghost" size="sm" className={styles.back} onClick={() => setStack(previous => previous.slice(0, -1))}>
      ← {stack.length > 1 ? viewTitle(stack[stack.length - 2]) : fallback}
    </Button>
  </div>;
  const toActivity = text("Activity", "运行记录");
  /** Where a branch came from: the agent that started it, or the main conversation. */
  const fromLink = (owner: string | null) => {
    const agent = owner ? execution(owner) : null;
    return <button type="button" className={styles.link} onClick={() => open(agent ? { kind: "run", id: agent.execution_id } : { kind: "main", id: "main" })}>
      {agent ? agentName(agent) : mainName}</button>;
  };

  // ---- pages -------------------------------------------------------------------
  if (view?.kind === "tech") return <div className={styles.panel}>
    {backBar(toActivity)}
    <DebuggerPanel key={state.selectedExecutionId || "empty"} {...state} detailOnly
      onSelectExecution={state.selectExecution} onCommand={state.command} onRespondWait={state.respondWait}
      onCreateDraft={async input => { await state.createDraft(input); }} onUpdateDraft={state.updateDraft}
      onDraftAction={state.draftAction} />
  </div>;

  if (view?.kind === "main") {
    const { label, tone } = mainStatus();
    const agents = branches.agentsUnder(null);
    const failed = failedSpawns(null);
    const runningHere = [...mainCalls.filter(entry => !agentOf(entry)).map(entry => callRow(entry)), ...mainPrograms.map(programRow)];
    return <div className={styles.panel}>
      {backBar(toActivity)}
      <div className={styles.scroll}>
        <div className={styles.head}>
          <div className={styles.kind}>{mainName}</div>
          <h3 className={styles.title}>{conversationTitle || mainName}</h3>
          <Status tone={tone}>{label}</Status>
        </div>
        {mainIssues.map(issue => issueBlock(issue, "run"))}
        {actionError && <p role="alert" className={styles.error}>{actionError}</p>}
        {runningHere.length > 0 && <><h4 className={styles.section}>{text("Running now", "正在做")}</h4>{runningHere}</>}
        {latestRun && <><h4 className={styles.section}>{text("Latest run", "最近一次运行")}</h4>{runRow(latestRun)}</>}
        <h4 className={styles.section}>{text("Sub-agents it started", "它启动的子代理")}</h4>
        {agents.length + failed.length === 0
          ? <p className={styles.empty}>{text("No sub-agents yet.", "还没有启动过子代理。")}</p>
          : startedNewestFirst(agents, failed)}
        {latestRun && <Button variant="ghost" className={styles.techRow} onClick={() => openTech(latestRun.execution_id)}>
          {text("Technical details", "技术详情")}<ChevronRight size={13} aria-hidden="true" />
        </Button>}
      </div>
    </div>;
  }

  if (view?.kind === "run") {
    const item = execution(view.id);
    const run = item ? model.runOf(item.execution_id) : null;
    if (!item || !run) return <div className={styles.panel}>{backBar(toActivity)}<SidebarNotice>{text("This run is no longer listed.", "这次运行已不在列表中。")}</SidebarNotice></div>;
    const isRoot = run.root.execution_id === item.execution_id;
    const issues = issuesOf(item);
    const agent = isAgent(item);
    // An agent call is reached through the sub-agent it started.
    const ownCalls = run.calls.filter(entry => entry.execution_id === item.execution_id && !agentOf(entry));
    const kids = model.childrenOf(item.execution_id);
    const nested = agent ? branches.agentsUnder(item.execution_id).filter(entry => !kids.includes(entry)) : [];
    const ownPrograms = run.programs.filter(entry => entry.execution_id === item.execution_id);
    const failed = agent ? failedSpawns(item.execution_id) : [];
    const spawning = agent ? calls.find(entry => agentOf(entry)?.execution_id === item.execution_id) : undefined;
    const task = spawning?.prompt || (agent ? spawns.find(entry => entry.job_id === item.execution_id)?.prompt : "") || "";
    const end = item.terminal_at ?? (LIVE.includes(item.status) ? now : item.updated_at);
    return <div className={styles.panel}>
      {backBar(toActivity)}
      <div className={styles.scroll}>
        <div className={styles.head}>
          <div className={styles.kind}>{agent ? text("Sub-agent", "子代理") : isRoot ? text("Run", "一次运行") : text("Branch", "分支")} · {updatedTime(startedAt(item))} · {text("took", "用时")} {duration(end - startedAt(item), text)}</div>
          <h3 className={styles.title}>{agent ? agentName(item) : runTitle(item)}</h3>
          <Status tone={issues.length ? "warn" : executionTone(item)}>{issues.length ? agent && issues.length === 1 && issues[0].kind === "call" ? text("Stopped", "已停止") : text(`${issues.length} to handle`, `有 ${issues.length} 项待处理`) : executionState(item, text)}</Status>
        </div>
        {issues.map(issue => issueBlock(issue, agent ? "agent" : "run"))}
        {agent && <div className={styles.actions} data-inline="1">
          <Button variant="elevated" size="sm" onClick={() => void openAgentConversation(item)}>{text("Open its conversation", "打开它的对话")}</Button>
        </div>}
        {actionError && <p role="alert" className={styles.error}>{actionError}</p>}
        {agent
          ? <dl className={styles.facts}>
            <dt>{text("Started by", "由谁启动")}</dt><dd>{fromLink(branches.agentParentOf(item))}</dd>
            {!isRoot && <><dt>{text("From", "来自")}</dt>
              <dd><button type="button" className={styles.link} onClick={() => open({ kind: "run", id: run.root.execution_id })}>{runTitle(run.root)}</button></dd></>}
          </dl>
          : !isRoot && <dl className={styles.facts}>
            <dt>{text("From", "来自")}</dt>
            <dd><button type="button" className={styles.link} onClick={() => open({ kind: "run", id: run.root.execution_id })}>{runTitle(run.root)}</button></dd>
          </dl>}
        {task && <Long label={text("Task given to it", "交给它的任务")} body={task} mono={false} open={taskOpen} onToggle={() => setTaskOpen(value => !value)} text={text} />}
        <h4 className={styles.section}>{agent ? text("What it did", "它做了什么") : text("What this run did", "这次运行做了什么")}</h4>
        {kids.length + nested.length + ownCalls.length + ownPrograms.length + failed.length === 0
          ? <p className={styles.empty}>{text("No sub-agents, open calls or background programs.", "没有子代理、未返回的调用或后台程序。")}</p>
          : <>{ownCalls.map(entry => callRow(entry))}{kids.filter(entry => !isAgent(entry)).map(childRow)}
            {startedNewestFirst([...kids.filter(isAgent), ...nested], failed)}{ownPrograms.map(programRow)}</>}
        <Button variant="ghost" className={styles.techRow} onClick={() => openTech(item.execution_id)}>
          {text("Technical details", "技术详情")}<ChevronRight size={13} aria-hidden="true" />
        </Button>
      </div>
    </div>;
  }

  if (view?.kind === "spawn") {
    const item = spawn(view.id);
    if (!item) return <div className={styles.panel}>{backBar(toActivity)}<SidebarNotice>{text("This call is no longer listed.", "这次调用已不在列表中。")}</SidebarNotice></div>;
    return <div className={styles.panel}>
      {backBar(toActivity)}
      <div className={styles.scroll}>
        <div className={styles.head}>
          <div className={styles.kind}><Glyph name="bot" tone="agent" />{text("Sub-agent", "子代理")} · {updatedTime(item.at)}</div>
          <h3 className={styles.title}>{item.description || text("Sub-agent", "子代理")}</h3>
          <Status tone={item.failed ? "err" : "muted"}>{spawnState(item, text)}</Status>
        </div>
        <p className={styles.note}>{text("This call did not start a sub-agent, so it has no conversation of its own.", "这次调用没有建出子代理，所以没有它自己的对话。")}</p>
        <dl className={styles.facts}>
          <dt>{text("Started by", "由谁启动")}</dt><dd>{fromLink(item.owner_job_id)}</dd>
        </dl>
        {item.error && <><h4 className={styles.section}>{text("Error", "报错")}</h4><p className={styles.code} data-open="1">{item.error}</p></>}
        {item.prompt && <Long label={text("Task given to it", "交给它的任务")} body={item.prompt} mono={false} open={taskOpen} onToggle={() => setTaskOpen(value => !value)} text={text} />}
      </div>
    </div>;
  }

  if (view?.kind === "call") {
    const item = call(view.id);
    if (!item) return <div className={styles.panel}>{backBar(toActivity)}<SidebarNotice>{text("This call has returned.", "这次调用已经返回。")}</SidebarNotice></div>;
    const look = presentTool(item.name, undefined, text);
    const owner = execution(item.execution_id);
    const issue = model.issues.find(entry => entry.kind === "call" && entry.call.id === item.id);
    const run = owner ? model.runOf(owner.execution_id) : null;
    return <div className={styles.panel}>
      {backBar(toActivity)}
      <div className={styles.scroll}>
        <div className={styles.head}>
          <div className={styles.kind}><Glyph name={look.icon} tone={look.tone} />{callKind(item, text)} · {updatedTime(item.started_at)}</div>
          <h3 className={styles.title}>{item.description || item.name}</h3>
          <Status tone={item.status === "running" ? "run" : "warn"}>{item.status === "running" ? `${text("Running", "正在运行")} · ${duration(now - item.started_at, text)}` : text("Stopped", "已停止")}</Status>
        </div>
        {issue && issueBlock(issue, "call")}
        {actionError && <p role="alert" className={styles.error}>{actionError}</p>}
        {run && <dl className={styles.facts}>
          <dt>{text("From", "来自")}</dt>
          <dd><button type="button" className={styles.link} onClick={() => open({ kind: "run", id: run.root.execution_id })}>{runTitle(run.root)}</button></dd>
        </dl>}
        {item.prompt && <Long label={text("Task given to it", "交给它的任务")} body={item.prompt} mono={false} open={taskOpen} onToggle={() => setTaskOpen(value => !value)} text={text} />}
        {item.command && <Long label={text("Command", "命令")} body={item.command} mono open={taskOpen} onToggle={() => setTaskOpen(value => !value)} text={text} />}
      </div>
    </div>;
  }

  if (view?.kind === "program") {
    const item = processes.detail?.process.id === view.id ? processes.detail.process : program(view.id);
    const issue = item ? model.issues.find(entry => entry.kind === "program" && entry.program.id === item.id) : undefined;
    const run = item?.execution_id ? model.runOf(item.execution_id) : null;
    return <div className={styles.panel}>
      {backBar(toActivity)}
      {processes.stale && item && <SidebarNotice>{text("Program updates are unavailable. Showing saved results and retrying automatically.", "程序更新暂时不可用，保留上次记录并自动重试。")}</SidebarNotice>}
      {!item ? <SidebarNotice>{processes.stale ? text("Program details unavailable.", "暂时无法读取程序详情。") : text("Loading program…", "正在读取程序…")}</SidebarNotice> : <div className={styles.scroll}>
        <div className={styles.head}>
          <div className={styles.kind}><Glyph name="code-square" tone="shell" />{text("Background program", "后台程序")} · {updatedTime(item.started_at)}</div>
          <h3 className={styles.title}>{programName(item, text)}</h3>
          <Status tone={programTone(item)}>{programState(item, text)}</Status>
        </div>
        {issue && issueBlock(issue, "program")}
        {processIsActive(item) && <div className={styles.actions} data-inline="1">
          <Button variant="elevated" size="sm" disabled={pending === item.id || processes.stale || item.can_stop === false} onClick={async () => {
            setPending(item.id); setActionError(null);
            try { await stopProcess(item.id, sessionId); processes.refresh(); }
            catch { setActionError(text("Could not stop the program. Its status will update automatically; try again once it is available.", "未能停止程序，状态将自动更新，恢复后可重试。")); }
            finally { setPending(null); }
          }}>{pending === item.id ? text("Stopping…", "正在停止…") : text("Stop program", "停止程序")}</Button>
        </div>}
        {actionError && <p role="alert" className={styles.error}>{actionError}</p>}
        <dl className={styles.facts}>
          {run && <><dt>{text("From", "来自")}</dt><dd><button type="button" className={styles.link} onClick={() => open({ kind: "run", id: run.root.execution_id })}>{runTitle(run.root)}</button></dd></>}
          <dt>{text("Folder", "工作目录")}</dt><dd>{item.cwd || "—"}</dd>
          {item.ended_at != null && <><dt>{text("Ended", "结束")}</dt><dd>{updatedTime(item.ended_at)}</dd></>}
          {item.exit_code != null && <><dt>{text("Exit code", "退出码")}</dt><dd>{item.exit_code}</dd></>}
          <dt>{text("Environment", "运行环境")}</dt><dd>{item.backend_id}</dd>
        </dl>
        <Long label={text("Command", "命令")} body={item.command} mono open={taskOpen} onToggle={() => setTaskOpen(value => !value)} text={text} />
        <h4 className={styles.section}>{text("Output", "输出")}</h4>
        {item.truncated && <p className={styles.empty}>{text("Earlier output was truncated; the process record is retained.", "较早的输出已截断，程序记录仍然保留。")}</p>}
        <pre className={styles.output}>{processes.detail?.output || text("No output recorded yet.", "尚无输出记录。")}</pre>
      </div>}
    </div>;
  }

  // ---- overview ----------------------------------------------------------------
  // Messages live in the chat; Activity lists the conversation's agent
  // branches, its background programs and what needs the reader.
  // A call that never started a sub-agent sits where that sub-agent would.
  const tree = branches.tree<AgentCall>(owner => failedSpawns(owner).map(leaf => ({ at: leaf.at, leaf })));
  const visible = tree.slice(0, shown);
  const showMain = Boolean(latestRun) || tree.length > 0 || mainLive;
  const programs = [...processes.items].sort((a, b) => Number(processIsActive(b)) - Number(processIsActive(a)) || b.started_at - a.started_at);
  const empty = state.fetchedAt && processes.loaded && !model.issues.length && !showMain && !programs.length;
  return <section className={styles.panel} aria-label={text("Conversation activity", "会话运行记录")}>
    {readFailed && readNotice?.sessionId === sessionId && <p role="status" className={`${styles.notice} ${readNotice.persistent && !hasRead ? styles.error : ""}`}>{hasRead
      ? text("Updating status… Showing saved records.", "正在更新状态，当前显示上次记录。")
      : readNotice.persistent
        ? text("Activity is still unavailable. Retrying automatically.", "运行记录暂时无法读取，正在自动重试。")
        : text("Loading activity… Retrying automatically.", "正在加载运行记录，自动重试中。")}</p>}
    <div className={styles.scroll}>
      {!hasRead && !processes.stale && state.connection.state === "reconnecting" ? <SidebarNotice>{text("Loading…", "加载中…")}</SidebarNotice> : null}
      {model.issues.length > 0 && <div className="group/sec">
        <SectionHeader name={text("Needs you", "要你处理")} className={styles.sectionHeader} collapsible={false} collapsed={false} onToggle={() => {}} actions={<span className={styles.count}>{model.issues.length}</span>} />
        {model.issues.map(issueRow)}
      </div>}
      {showMain && <div className="group/sec">
        <SectionHeader name={text("Agent branches", "Agent 分支")} className={styles.sectionHeader} collapsible={false} collapsed={false} onToggle={() => {}} actions={<span className={styles.count}>{tree.length + 1}</span>} />
        {mainRow()}
        {visible.map(entry => entry.kind === "agent" ? agentRow(entry.item, entry.depth) : spawnRow(entry.leaf, entry.depth))}
        {tree.length > shown && <button type="button" className={styles.more} data-depth="1" onClick={() => setShown(value => value + 50)}>
          {text(`Show ${Math.min(50, tree.length - shown)} earlier`, `显示更早的 ${Math.min(50, tree.length - shown)} 个`)}
        </button>}
      </div>}
      {programs.length > 0 && <div className="group/sec">
        <SectionHeader name={text("Background programs", "后台程序")} className={styles.sectionHeader} collapsible={false} collapsed={false} onToggle={() => {}} actions={<span className={styles.count}>{programs.length}</span>} />
        {programs.slice(0, programsShown).map(programRow)}
        {programs.length > programsShown && <button type="button" className={styles.more} onClick={() => setProgramsShown(value => value + 50)}>
          {text(`Show ${Math.min(50, programs.length - programsShown)} earlier`, `显示更早的 ${Math.min(50, programs.length - programsShown)} 个`)}
        </button>}
      </div>}
      {empty && <SidebarNotice>{text("This conversation's agent branches, its background programs and anything that needs you appear here.", "这个会话的 agent 分支、后台程序和需要你处理的事会显示在这里。")}</SidebarNotice>}
    </div>
  </section>;
}

/** A task or command: five lines, then the whole text on request. */
function Long({ label, body, mono, open, onToggle, text }: {
  label: string; body: string; mono: boolean; open: boolean; onToggle: () => void; text: Text;
}) {
  const long = body.length > 280 || body.split("\n").length > 5;
  return <>
    <h4 className={styles.section}>{label}</h4>
    <p className={mono ? styles.code : styles.prose} data-open={open || !long ? "1" : "0"}>{body}</p>
    {long && <button type="button" className={styles.more} onClick={onToggle}>{open ? text("Show less", "收起") : text("Show all", "展开全文")}</button>}
  </>;
}
