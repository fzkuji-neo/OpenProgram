"use client";

/**
 * Activity: what in this conversation needs the reader, what is running and
 * what ran before. Every row is a run (one message and everything done for
 * it), a call or a program, and every row opens a page; the arrow at the top
 * goes back one level. Nothing expands in place and no group folds.
 */
import { useEffect, useState, type ReactNode } from "react";
import { ChevronRight, MessageSquareText } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { useExecutionDebugger } from "@/lib/execution/use-execution-debugger";
import { useManagedProcesses } from "@/lib/execution/use-managed-processes";
import { processIsActive, stopProcess, type ActiveToolCall, type ManagedProcess } from "@/lib/net/process-client";
import { buildExecutionCommand, canExecuteAction, newCommandId, type ExecutionSnapshot } from "@/lib/execution/execution-debugger";
import { activityModel, executionPending, spawnedBy, startedAt, type ActivityIssue, type ActivityRun } from "@/lib/execution/activity-model";
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
type View = { kind: "run" | "call" | "program" | "tech"; id: string };

const PAGE = 20;
const DOT: Record<Tone, string> = {
  warn: "--warn", run: "--neutral pulse-opacity", ok: "--ok", err: "--err", muted: "is-muted",
};

function Glyph({ name, tone }: { name: SolarIconName; tone: ToolTone | "run" }) {
  return <span className={styles.glyph} data-tone={tone} aria-hidden="true">
    <SolarIcon name={name} size={16} motionPreset="none" />
  </span>;
}

/** A run: the message it answered, as a line glyph in the text colour. */
function RunGlyph() {
  return <span className={styles.glyph} data-tone="run" aria-hidden="true"><MessageSquareText size={15} strokeWidth={1.8} /></span>;
}

function Status({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={styles.status} data-tone={tone}>
    <span className={`indicator-dot sm ${DOT[tone]}`} aria-hidden="true" />
    <span className={styles.statusText}>{children}</span>
  </span>;
}

function Row({ glyph, title, status, tone, onOpen }: {
  glyph: ReactNode; title: string; status: ReactNode; tone: Tone; onOpen: () => void;
}) {
  return <Button variant="ghost" className={styles.row} onClick={onOpen}>
    {glyph}
    <span className={styles.rowText}><span className={styles.name}>{title}</span><Status tone={tone}>{status}</Status></span>
    <ChevronRight size={14} className={styles.chevron} aria-hidden="true" />
  </Button>;
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

/** What kind of thing a call is, in the reader's words. */
function callKind(call: ActiveToolCall, text: Text): string {
  const tone = presentTool(call.name, undefined, text).tone;
  if (tone === "agent") return text("Sub-agent", "子代理");
  if (tone === "shell") return text("Command", "命令");
  return call.name;
}

function executionTone(item: ExecutionSnapshot): Tone {
  if (executionPending(item)) return "warn";
  if (["queued", "running", "pausing", "cancelling"].includes(item.status)) return "run";
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
    reconciliation_required: executionPending(item) ? ["Result unconfirmed", "结果待确认"] : ["Ended", "已结束"],
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

export function RunningPanel({ active, sessionId }: { active: boolean; sessionId: string | null }) {
  const { text } = useTranslation();
  const [stack, setStack] = useState<View[]>([]);
  const view = stack.at(-1) ?? null;
  const state = useExecutionDebugger(active, sessionId, undefined, view?.kind === "tech");
  const processes = useManagedProcesses(active, sessionId, view?.kind === "program" ? view.id : null);
  const [shown, setShown] = useState(PAGE);
  const [taskOpen, setTaskOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  useEffect(() => { setStack([]); setShown(PAGE); }, [sessionId]);
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
  const model = activityModel(state.fetchedAt ? state.executions : [], processes.items, state.fetchedAt ? processes.calls || [] : []);
  const now = Date.now() / 1000;
  const open = (next: View) => setStack(previous => [...previous, next]);
  const openTech = (executionId: string) => { state.selectExecution(executionId); open({ kind: "tech", id: executionId }); };
  const execution = (id: string) => state.executions.find(item => item.execution_id === id) ?? null;
  const call = (id: string) => (processes.calls || []).find(item => item.id === id) ?? null;
  const program = (id: string) => processes.items.find(item => item.id === id) ?? null;
  const runTitle = (item: ExecutionSnapshot) => executionTitle(item, 1, text);

  function viewTitle(entry: View): string {
    if (entry.kind === "call") { const item = call(entry.id); return item ? item.description || item.name : text("Call", "调用"); }
    if (entry.kind === "program") { const item = program(entry.id); return item ? programName(item, text) : text("Program", "程序"); }
    const item = execution(entry.id);
    return item ? runTitle(item) : text("Run", "运行");
  }

  async function endRun(item: ExecutionSnapshot) {
    setPending(item.execution_id); setActionError(null);
    try {
      const result = await state.command(buildExecutionCommand(item, "cancel", newCommandId()));
      if (result && result.status === "rejected") setActionError(text("The run could not be ended. Its status updates automatically.", "没能结束这次运行，状态会自动更新。"));
    } catch { setActionError(text("The run could not be ended. Its status updates automatically.", "没能结束这次运行，状态会自动更新。")); }
    finally { setPending(null); }
  }

  async function openAgentConversation(job: ExecutionSnapshot) {
    const target = await loadSubAgentTranscript(sessionId!, job.execution_id, { jobId: job.execution_id, headId: job.display?.assistant_message_id })
      || job.display?.assistant_message_id;
    if (!target) return;
    sendRuntimeCommand({ action: "checkout_branch", session_id: sessionId, head_msg_id: target });
    sendRuntimeCommand({ action: "load_session", session_id: sessionId });
  }

  // ---- rows ----------------------------------------------------------------
  function runRow(run: ActivityRun): ReactNode {
    const live = run.active;
    const tone: Tone = run.issues.length ? "warn" : live ? "run" : executionTone(run.root);
    const agents = run.tree.filter(item => item.display?.kind === "job_agent").length;
    const status = run.issues.length
      ? text(`${run.issues.length} to handle`, `有 ${run.issues.length} 项待处理`)
      : live
        ? `${run.runningCall ? `${text("Running", "正在运行")} ${run.runningCall.name}` : text("Running", "正在运行")} · ${duration(now - run.at, text)}`
        : [executionState(run.root, text), agents ? text(`${agents} sub-agent${agents === 1 ? "" : "s"}`, `${agents} 个子代理`) : "",
          run.programs.length ? text(`${run.programs.length} program${run.programs.length === 1 ? "" : "s"}`, `${run.programs.length} 个程序`) : ""].filter(Boolean).join(" · ");
    return <Row key={run.root.execution_id} glyph={<RunGlyph />} title={runTitle(run.root)}
      status={live || run.issues.length ? status : `${status} · ${shortTime(run.at * 1000)}`} tone={tone}
      onOpen={() => open({ kind: "run", id: run.root.execution_id })} />;
  }
  function callRow(item: ActiveToolCall, withKind = true): ReactNode {
    const look = presentTool(item.name, undefined, text);
    const phase = item.status === "running" ? `${text("Running", "正在运行")} · ${duration(now - item.started_at, text)}` : text("Result unconfirmed", "结果待确认");
    return <Row key={`call:${item.id}`} glyph={<Glyph name={look.icon} tone={look.tone} />} title={item.description || item.name}
      status={withKind ? `${callKind(item, text)} · ${phase}` : phase} tone={item.status === "running" ? "run" : "warn"}
      onOpen={() => open({ kind: "call", id: item.id })} />;
  }
  function programRow(item: ManagedProcess): ReactNode {
    return <Row key={`program:${item.id}`} glyph={<Glyph name="code-square" tone="shell" />} title={programName(item, text)}
      status={`${text("Program", "后台程序")} · ${programState(item, text)}`} tone={programTone(item)}
      onOpen={() => open({ kind: "program", id: item.id })} />;
  }
  function childRow(item: ExecutionSnapshot): ReactNode {
    const agent = item.display?.kind === "job_agent";
    return <Row key={`execution:${item.execution_id}`} glyph={agent ? <Glyph name="bot" tone="agent" /> : <RunGlyph />}
      title={agent ? (item.display?.label || runTitle(item)).replace(/_/g, " ") : runTitle(item)}
      status={`${agent ? text("Sub-agent", "子代理") : text("Branch", "分支")} · ${executionState(item, text)}`} tone={executionTone(item)}
      onOpen={() => open({ kind: "run", id: item.execution_id })} />;
  }
  function issueRow(issue: ActivityIssue): ReactNode {
    if (issue.kind === "call") {
      const look = presentTool(issue.call.name, undefined, text);
      return <Row key={issue.key} glyph={<Glyph name={look.icon} tone={look.tone} />} title={issue.call.description || issue.call.name}
        status={`${callKind(issue.call, text)}${text(" result unconfirmed", "结果待确认")} · ${dayLabel(issue.at, text)}`} tone="warn"
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
  function issueBlock(issue: ActivityIssue, here: "run" | "call" | "program"): ReactNode {
    let heading = "", body = "";
    const actions: ReactNode[] = [];
    const owner = issue.kind === "call" ? issue.owner : issue.kind === "execution" ? issue.execution : null;
    if (issue.kind === "call") {
      const name = issue.call.description || issue.call.name;
      heading = here === "call" ? "" : text(`${callKind(issue.call, text)} "${name}": result unconfirmed`, `${callKind(issue.call, text)}“${name}”结果待确认`);
      body = text("The run stopped while this call was out, so whether it finished is not known.", "运行在这次调用途中中断，不确定它有没有做完。");
      const job = issue.owner && issue.call.name === "agent" ? spawnedBy(issue.call, model.childrenOf(issue.owner.execution_id)) : null;
      if (job) actions.push(<Button key="agent" variant="elevated" size="sm" onClick={() => void openAgentConversation(job)}>{text("Open its conversation", "打开它的对话")}</Button>);
    } else if (issue.kind === "execution") {
      const waiting = issue.execution.status === "paused";
      heading = waiting ? text("Waiting for you", "在等你处理") : text("An action's result is unconfirmed", "有一个操作结果待确认");
      body = waiting
        ? text("This run paused on a question or an approval.", "这次运行停在一个问题或审批上。")
        : text("The run stopped while an action was out, so whether it took effect is not known.", "运行在一个操作途中中断，不确定它有没有生效。");
      actions.push(<Button key="tech" variant="elevated" size="sm" onClick={() => openTech(issue.execution.execution_id)}>{waiting ? text("Answer", "去处理") : text("See details", "查看详情")}</Button>);
    } else {
      heading = here === "program" ? "" : text(`Program "${programName(issue.program, text)}": state unconfirmed`, `后台程序“${programName(issue.program, text)}”状态待确认`);
      body = text("Its supervisor is unavailable, so whether it exited is not known. The record is kept.", "程序监督进程不可用，不确定它是否已退出，记录仍保留。");
      if (here !== "program") actions.push(<Button key="program" variant="elevated" size="sm" onClick={() => open({ kind: "program", id: issue.program.id })}>{text("See the program", "查看程序")}</Button>);
    }
    if (owner && executionPending(owner) && canExecuteAction(owner, "cancel")) {
      actions.push(<Button key="end" variant="elevated" size="sm" disabled={pending === owner.execution_id} onClick={() => void endRun(owner)}>
        {pending === owner.execution_id ? text("Ending…", "正在结束…") : text("End this run", "结束这次运行")}</Button>);
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

  // ---- pages -------------------------------------------------------------------
  if (view?.kind === "tech") return <div className={styles.panel}>
    {backBar(toActivity)}
    <DebuggerPanel key={state.selectedExecutionId || "empty"} {...state} detailOnly
      onSelectExecution={state.selectExecution} onCommand={state.command} onRespondWait={state.respondWait}
      onCreateDraft={async input => { await state.createDraft(input); }} onUpdateDraft={state.updateDraft}
      onDraftAction={state.draftAction} />
  </div>;

  if (view?.kind === "run") {
    const item = execution(view.id);
    const run = item ? model.runOf(item.execution_id) : null;
    if (!item || !run) return <div className={styles.panel}>{backBar(toActivity)}<SidebarNotice>{text("This run is no longer listed.", "这次运行已不在列表中。")}</SidebarNotice></div>;
    const isRoot = run.root.execution_id === item.execution_id;
    const subtree = new Set<string>();
    const collect = (entry: ExecutionSnapshot) => { if (subtree.has(entry.execution_id)) return; subtree.add(entry.execution_id); model.childrenOf(entry.execution_id).forEach(collect); };
    collect(item);
    const issues = run.issues.filter(issue => issue.kind === "call" ? subtree.has(issue.call.execution_id)
      : issue.kind === "execution" ? subtree.has(issue.execution.execution_id) : Boolean(issue.program.execution_id && subtree.has(issue.program.execution_id)));
    const ownCalls = run.calls.filter(entry => entry.execution_id === item.execution_id);
    // A sub-agent an agent call started is reached through that call.
    const hidden = new Set(ownCalls.filter(entry => entry.name === "agent")
      .map(entry => spawnedBy(entry, model.childrenOf(item.execution_id))?.execution_id).filter(Boolean) as string[]);
    const children = model.childrenOf(item.execution_id).filter(child => !hidden.has(child.execution_id));
    const ownPrograms = run.programs.filter(entry => entry.execution_id === item.execution_id);
    const agent = item.display?.kind === "job_agent";
    const end = item.terminal_at ?? (["queued", "running", "pausing", "cancelling"].includes(item.status) ? now : item.updated_at);
    return <div className={styles.panel}>
      {backBar(toActivity)}
      <div className={styles.scroll}>
        <div className={styles.head}>
          <div className={styles.kind}>{agent ? text("Sub-agent", "子代理") : isRoot ? text("Run", "一次运行") : text("Branch", "分支")} · {updatedTime(startedAt(item))} · {text("took", "用时")} {duration(end - startedAt(item), text)}</div>
          <h3 className={styles.title}>{agent ? (item.display?.label || runTitle(item)).replace(/_/g, " ") : runTitle(item)}</h3>
          <Status tone={issues.length ? "warn" : executionTone(item)}>{issues.length ? text(`${issues.length} to handle`, `有 ${issues.length} 项待处理`) : executionState(item, text)}</Status>
        </div>
        {issues.map(issue => issueBlock(issue, "run"))}
        {actionError && <p role="alert" className={styles.error}>{actionError}</p>}
        <h4 className={styles.section}>{text("What this run did", "这次运行做了什么")}</h4>
        {children.length + ownCalls.length + ownPrograms.length === 0
          ? <p className={styles.empty}>{text("No sub-agents, open calls or background programs.", "没有子代理、未返回的调用或后台程序。")}</p>
          : <>{ownCalls.map(entry => callRow(entry))}{children.map(childRow)}{ownPrograms.map(programRow)}</>}
        <Button variant="ghost" className={styles.techRow} onClick={() => openTech(item.execution_id)}>
          {text("Technical details", "技术详情")}<ChevronRight size={13} aria-hidden="true" />
        </Button>
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
          <Status tone={item.status === "running" ? "run" : "warn"}>{item.status === "running" ? `${text("Running", "正在运行")} · ${duration(now - item.started_at, text)}` : text("Result unconfirmed", "结果待确认")}</Status>
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
  const runningRuns = model.runs.filter(run => run.active);
  const runningLoose = [
    ...model.looseCalls.filter(entry => entry.status === "running").map(entry => callRow(entry)),
    ...model.loosePrograms.filter(processIsActive).map(programRow),
  ];
  type Past = { at: number; node: ReactNode };
  const past: Past[] = [
    ...model.runs.filter(run => !run.active).map(run => ({ at: run.at, node: runRow(run) })),
    ...model.loosePrograms.filter(entry => !processIsActive(entry)).map(entry => ({ at: entry.started_at, node: programRow(entry) })),
  ].sort((a, b) => b.at - a.at);
  const visible = past.slice(0, shown);
  const runningCount = runningRuns.length + runningLoose.length;
  const empty = state.fetchedAt && processes.loaded && !model.issues.length && !runningCount && !past.length;
  let lastDay = "";
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
      {runningCount > 0 && <div className="group/sec">
        <SectionHeader name={text("Running", "正在运行")} className={styles.sectionHeader} collapsible={false} collapsed={false} onToggle={() => {}} actions={<span className={styles.count}>{runningCount}</span>} />
        {runningRuns.map(runRow)}{runningLoose}
      </div>}
      {past.length > 0 && <div className="group/sec">
        <SectionHeader name={text("Earlier", "记录")} className={styles.sectionHeader} collapsible={false} collapsed={false} onToggle={() => {}} actions={<span className={styles.count}>{past.length}</span>} />
        {visible.map(entry => {
          const day = dayLabel(entry.at, text);
          const heading = day !== lastDay ? <div className={styles.day} key={`day:${day}`}>{day}</div> : null;
          lastDay = day;
          return [heading, entry.node];
        })}
        {past.length > shown && <button type="button" className={styles.more} onClick={() => setShown(value => value + 50)}>
          {text(`Show ${Math.min(50, past.length - shown)} earlier`, `显示更早的 ${Math.min(50, past.length - shown)} 条`)}
        </button>}
      </div>}
      {empty && <SidebarNotice>{text("What this conversation runs will appear here.", "这个会话运行的内容会显示在这里。")}</SidebarNotice>}
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
