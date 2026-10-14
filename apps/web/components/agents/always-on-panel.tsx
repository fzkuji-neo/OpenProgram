"use client";

// Agents → Always-on: the configuration that makes a saved Agent wake on a
// schedule, and the live status of its home conversation and reports.
// Configuration is part of the Agent draft (saved with the rest); status
// and Wake now act on the saved configuration.

import { useEffect, useState } from "react";
import { MessageCircleIcon, ZapIcon } from "@/components/animated-icons";
import {
  fetchAlwaysOn, onAlwaysOnChanged, openAlwaysOnHome, wakeAlwaysOn, wakeMinutesValid,
  WAKE_MINUTES_MAX, WAKE_MINUTES_MIN, type AlwaysOnConfig, type AlwaysOnStatus, type AlwaysOnWakeOutcome,
} from "@/lib/agents/always-on";
import { AgentButton } from "./agent-controls";
import type { Agent, Text } from "./agent-types";
import styles from "./agents-page.module.css";

type Props = { draft: Agent; update: (patch: Partial<Agent>) => void; text: Text };

function outcomeLabel(outcome: AlwaysOnWakeOutcome, text: Text): string {
  switch (outcome) {
    case "disabled": return text("Always-on was off", "常驻未开启");
    case "busy": return text("Skipped: a turn was running", "跳过：会话正在运行");
    case "goal_started": return text("Started the standing goal", "已开始常驻目标");
    case "goal_in_progress": return text("Goal in progress", "目标进行中");
    case "goal_paused": return text("Goal paused", "目标已暂停");
    case "check_in": return text("Checked in", "已巡检");
    case "idle": return text("Nothing to do", "无事可做");
  }
}

function goalStatusLabel(status: string, text: Text): string {
  const labels: Record<string, string> = {
    active: text("In progress", "进行中"),
    paused: text("Paused", "已暂停"),
    achieved: text("Achieved", "已达成"),
    blocked: text("Blocked", "受阻"),
    cancelled: text("Cancelled", "已取消"),
    cleared: text("Cleared", "已清除"),
    failed: text("Failed", "失败"),
    impossible: text("Impossible", "无法完成"),
  };
  return labels[status] ?? status;
}

function when(seconds: number | null | undefined): string {
  if (!seconds) return "—";
  return new Date(seconds * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function sameConfig(a: AlwaysOnConfig, b: AlwaysOnConfig): boolean {
  return a.enabled === b.enabled && a.goal.trim() === b.goal.trim() && a.wake_minutes === b.wake_minutes
    && a.research === b.research && a.autonomy === b.autonomy;
}

export function AlwaysOnPanel({ draft, update, text }: Props) {
  const config = draft.always_on;
  const [status, setStatus] = useState<AlwaysOnStatus | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [acting, setActing] = useState(false);
  function patch(value: Partial<AlwaysOnConfig>) { update({ always_on: { ...config, ...value } }); }

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const load = () => fetchAlwaysOn(draft.id, controller.signal)
      .then((data) => { if (active) { setStatus(data); setError(""); } })
      .catch((cause) => { if (active && cause.name !== "AbortError") setError(String(cause.message || cause)); });
    void load();
    const stop = onAlwaysOnChanged((agentId) => { if (agentId === draft.id) void load(); });
    return () => { active = false; controller.abort(); stop(); };
  }, [draft.id, draft.revision, attempt]);

  const saved = status?.config;
  const unsaved = Boolean(saved && !sameConfig(saved, config));
  async function act(run: () => Promise<unknown>) {
    setActing(true); setError("");
    try { await run(); setAttempt((value) => value + 1); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setActing(false); }
  }
  async function openHome() {
    await act(async () => {
      const { session_id } = await openAlwaysOnHome(draft.id);
      const { openSession } = await import("@/lib/tabs/open-session");
      openSession(session_id);
    });
  }

  return <>
    <div className={styles.panelIntro}><h3>{text("Always-on", "常驻")}</h3><p>{text(
      "Keep this Agent working while you are away: it wakes on a schedule, works on its standing goal in one home conversation, checks for news with read-only tools, and notifies you when it finds something.",
      "让此 Agent 在你离开时持续工作：按计划唤醒，在一个固定的会话里推进常驻目标，用只读工具巡检新情况，有发现时通知你。",
    )}</p></div>
    <label className={styles.memorySpace}><input type="checkbox" checked={config.enabled} onChange={(event) => patch({ enabled: event.target.checked })} /><span><strong>{text("Keep this Agent always on", "让此 Agent 常驻")}</strong><small>{text("Uses this Agent's model, instructions, capabilities and memory. Its work runs in the home conversation with that conversation's permissions.", "使用此 Agent 的模型、指令、能力与记忆。工作在常驻会话里进行，遵循该会话的权限设置。")}</small></span></label>
    <fieldset className={styles.memoryFields} disabled={!config.enabled}>
      <label className={styles.dialogField}>{text("Standing goal", "常驻目标")}<textarea className={styles.alwaysOnGoal} rows={3} maxLength={4000} value={config.goal} onChange={(event) => patch({ goal: event.target.value })} placeholder={text("For example: keep the docs site free of broken links and tell me when a fix needs review.", "例如：保持文档站没有死链，有需要我审阅的修复时告诉我。")} /><small>{text("Started as a Goal in the home conversation. A changed goal starts after the current one ends. Leave empty to only check in.", "作为目标在常驻会话中启动。修改后的目标会在当前目标结束后开始。留空则只做巡检。")}</small></label>
      <div className={styles.formGrid}><label>{text("Wake every (minutes)", "唤醒间隔（分钟）")}<input type="number" min={WAKE_MINUTES_MIN} max={WAKE_MINUTES_MAX} step={5} value={config.wake_minutes} onChange={(event) => patch({ wake_minutes: Number(event.target.value) })} aria-invalid={!wakeMinutesValid(config.wake_minutes)} /><small>{text(`${WAKE_MINUTES_MIN} to ${WAKE_MINUTES_MAX} minutes.`, `${WAKE_MINUTES_MIN} 到 ${WAKE_MINUTES_MAX} 分钟。`)}</small></label></div>
      <label className={styles.memorySpace}><input type="checkbox" checked={config.research} onChange={(event) => patch({ research: event.target.checked })} /><span><strong>{text("Check in when there is no goal to work on", "没有目标时进行巡检")}</strong><small>{text("Reviews memory and this conversation and looks for news with read-only tools. Reports only what is worth your attention.", "回顾记忆和会话，用只读工具查找新情况，只报告值得你关注的内容。")}</small></span></label>
      <div className={`${styles.modeGrid} ${styles.modeGridTwo}`} role="radiogroup" aria-label={text("What a check-in may do", "巡检可以做什么")}>{([
        ["report", text("Report findings", "只报告发现"), text("Proposes work in a report; you decide what to start.", "在报告中提出建议，由你决定是否开始。")],
        ["act", text("Start goals on its own", "可自行开始目标"), text("May turn a finding into a Goal, which then runs under the conversation's permissions.", "可把发现转为目标，按会话权限执行。")],
      ] as const).map(([mode, label, help]) => <label key={mode} className={config.autonomy === mode ? styles.modeActive : styles.modeCard}><input type="radio" name="always-on-autonomy" value={mode} checked={config.autonomy === mode} onChange={() => patch({ autonomy: mode })} /><span><strong>{label}</strong><small>{help}</small></span></label>)}</div>
    </fieldset>
    {draft.memory.mode !== "read_write" ? <p className={styles.note}>{text("To learn from your feedback over time, set Memory to Read and write.", "如需随反馈逐步改进，请在长期记忆中选择“读写”。")}</p> : null}
    <section className={styles.alwaysOnSection}>
      <h4>{text("Status", "状态")}</h4>
      {unsaved ? <p className={styles.note}>{text("Save changes to apply them; status and Wake now use the saved settings.", "保存后修改才会生效；状态和立即唤醒使用已保存的设置。")}</p> : null}
      {error ? <p role="alert" className={styles.inlineError}>{error} <button type="button" onClick={() => setAttempt((value) => value + 1)}>{text("Retry", "重试")}</button></p> : null}
      {status ? <div className={styles.alwaysOnStatus}>
        <div className={styles.workspaceFile}><span><MessageCircleIcon size={16} aria-hidden /></span><div><strong>{text("Home conversation", "常驻会话")}</strong><small>{status.running ? text("Working now", "正在工作") : status.goal ? `${goalStatusLabel(status.goal.status, text)} · ${status.goal.text}` : status.home_session_id ? text("No goal", "暂无目标") : text("Created on the first wake", "首次唤醒时创建")}</small></div><AgentButton variant="ghost" icon={MessageCircleIcon} disabled={acting} onClick={() => void openHome()}>{text("Open", "打开")}</AgentButton></div>
        <div className={styles.workspaceFile}><span><ZapIcon size={16} aria-hidden /></span><div><strong>{status.last_wake ? `${text("Last wake", "上次唤醒")}: ${outcomeLabel(status.last_wake.outcome, text)}` : text("Not woken yet", "尚未唤醒")}</strong><small>{status.last_wake ? when(status.last_wake.at) : "—"} · {text("Next", "下次")} {saved?.enabled ? (status.next_wake_at ? when(status.next_wake_at) : text("within a minute", "一分钟内")) : text("off", "未开启")}</small></div><AgentButton variant="ghost" icon={ZapIcon} disabled={acting || !saved?.enabled || unsaved} onClick={() => void act(() => wakeAlwaysOn(draft.id))}>{text("Wake now", "立即唤醒")}</AgentButton></div>
      </div> : !error ? <p role="status" className={styles.note}>{text("Loading status…", "正在加载状态…")}</p> : null}
    </section>
    {status ? <section className={styles.alwaysOnSection}>
      <h4>{text("Recent reports", "最近的报告")}</h4>
      {status.reports.length ? <ol className={styles.alwaysOnReports}>{status.reports.map((report) => <li key={report.id}>
        <div><strong>{report.title}</strong><time dateTime={new Date(report.at * 1000).toISOString()}>{when(report.at)}</time></div>
        {report.body ? <p>{report.body}</p> : null}
        {report.links.length ? <ul>{report.links.map((link) => <li key={link}><a href={link} target="_blank" rel="noreferrer">{link}</a></li>)}</ul> : null}
      </li>)}</ol> : <p className={styles.note}>{text("No reports yet.", "还没有报告。")}</p>}
    </section> : null}
  </>;
}
