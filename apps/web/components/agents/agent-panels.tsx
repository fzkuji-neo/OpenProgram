"use client";

import { useEffect, useState } from "react";
import { FileTextIcon, CopyIcon } from "@/components/animated-icons";
import { jsonFetch } from "@/lib/net/fetch-client";
import { AgentButton } from "./agent-controls";
import { ModelPicker, type ModelCatalog } from "./model-picker";
import type { Agent, MemorySpace, Text, TabId } from "./agent-types";
import styles from "./agents-page.module.css";

type Props = { draft: Agent; update: (patch: Partial<Agent>) => void; text: Text };
function Intro({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className={styles.panelIntro}><h3>{title}</h3><p>{children}</p></div>;
}
export function OverviewPanel({ draft, update, text, go }: Props & { go: (tab: TabId) => void }) {
  return <><Intro title={text("About this Agent", "Agent 信息")}>{text("Name, purpose and current settings.", "名称、用途与当前配置。")}</Intro>
    <div className={`${styles.formGrid} ${styles.identityGrid}`}>
      <label>{text("Display name", "显示名称")}<input value={draft.name} maxLength={80} onChange={(event) => update({ name: event.target.value })} /></label>
      <label>{text("Agent ID", "Agent ID")}<input value={draft.id} disabled /></label>
      <label className={styles.fullField}>{text("Description", "描述")}<textarea className={styles.descriptionField} rows={2} value={draft.description} maxLength={2000} onChange={(event) => update({ description: event.target.value })} placeholder={text("When to use this Agent", "说明何时使用此 Agent")} /></label>
    </div>
    <div className={styles.summaryList}>
      <Summary label={text("Model", "模型")} value={draft.model.id || text("Inherit default", "继承默认值")} go={() => go("model")} text={text} />
      <Summary label="Programs" value={draft.tools.mode === "automatic" ? text("All available", "全部可用项") : draft.tools.mode === "none" ? text("Disabled", "已关闭") : text("Selected scope", "指定范围")} go={() => go("programs")} text={text} />
      <Summary label={text("Long-term memory", "长期记忆")} value={draft.memory.mode === "off" ? text("Off", "关闭") : draft.memory.mode === "read_only" ? text("Read only", "只读") : text("Read and write", "读写")} go={() => go("memory")} text={text} />
      <Summary label={text("Context", "上下文")} value={draft.session_scope === "main" ? text("Shared", "共享会话") : draft.session_scope === "per-peer" ? text("Per contact", "按联系人") : draft.session_scope === "per-channel-peer" ? text("Per channel and contact", "按频道和联系人") : text("Per account, channel and contact", "按账号、频道和联系人")} go={() => go("context")} text={text} />
    </div>
  </>;
}
function Summary({ label, value, go, text }: { label: string; value: string; go: () => void; text: Text }) {
  return <div className={styles.summaryRow}><span>{label}</span><strong>{value}</strong><AgentButton variant="ghost" onClick={go} aria-label={text(`Edit ${label}`, `编辑${label}`)}>{text("Edit", "编辑")}</AgentButton></div>;
}
export function ModelPanel({ draft, update, text, catalog }: Props & { catalog: ModelCatalog }) {
  return <><Intro title={text("Model & Instructions", "模型与指令")}>{text("Existing conversations keep their model and explicit reasoning choice; inherited reasoning uses the current Agent default.", "已有对话保留模型和明确选择的思考强度；未设置思考强度时使用当前 Agent 默认值。")}</Intro>
    <div className={styles.modelFields}><ModelPicker draft={draft} update={update} text={text} catalog={catalog} />
      <label className={styles.dialogField}>{text("System prompt", "系统指令")}<textarea rows={10} maxLength={100000} value={draft.system_prompt} onChange={(event) => update({ system_prompt: event.target.value })} /><small>{text("Workspace instruction files are listed in Advanced.", "Workspace 指令文件在高级分区中查看。")}</small></label>
    </div>
  </>;
}
export function MemoryPanel({ draft, update, text }: Props) {
  const memory = draft.memory;
  function patch(value: Partial<Agent["memory"]>) { update({ memory: { ...memory, ...value } }); }
  const spaces: Array<[MemorySpace, string, string]> = [
    ["self", text("This Agent", "此 Agent"), text("Memory kept separately for this Agent.", "为此 Agent 单独保存的记忆。")],
    ["legacy_global", text("Shared legacy memory", "旧版共享记忆"), text("Existing profile-wide memory shared with other Agents.", "旧版在整个 profile 内共享的记忆。")],
  ];
  return <><Intro title={text("Long-term memory", "长期记忆")}>{text("Choose whether this Agent can read or write memory between conversations.", "选择此 Agent 是否在不同对话间读取或写入记忆。")}</Intro>
    <div className={styles.modeGrid}>{([
      ["off", text("Off", "关闭"), text("Do not read or write long-term memory.", "不读取或写入长期记忆。")],
      ["read_only", text("Read only", "只读"), text("Use existing memory without adding new records.", "使用已有记忆，不新增记录。")],
      ["read_write", text("Read and write", "读写"), text("Use existing memory and save new records.", "使用已有记忆并保存新记录。")],
    ] as const).map(([mode, label, help]) => <label key={mode} className={memory.mode === mode ? styles.modeActive : styles.modeCard}><input type="radio" name="memory-mode" value={mode} checked={memory.mode === mode} onChange={() => patch({ mode })} /><span><strong>{label}</strong><small>{help}</small></span></label>)}</div>
    <p className={styles.note}>{text("Trial conversations use read-only memory at most. Turning memory off keeps existing records.", "试运行最多使用只读记忆。关闭记忆不会删除已有记录。")}</p>
    <fieldset className={styles.memoryFields} disabled={memory.mode === "off"}><legend>{text("Read from", "读取范围")}</legend>
      {spaces.map(([space, label, help]) => <label className={styles.memorySpace} key={space}><input type="checkbox" checked={memory.read_spaces.includes(space)} onChange={(event) => patch({ read_spaces: event.target.checked ? [...memory.read_spaces, space] : memory.read_spaces.filter((item) => item !== space) })} /><span><strong>{label}</strong><small>{help}</small></span></label>)}
      <label className={styles.dialogField}>{text("Write to", "写入位置")}<select disabled={memory.mode !== "read_write"} value={memory.write_space} onChange={(event) => patch({ write_space: event.target.value as MemorySpace })}>{spaces.map(([space, label]) => <option key={space} value={space}>{label}</option>)}</select></label>
      <label className={styles.memorySpace}><input type="checkbox" checked={memory.required} onChange={(event) => patch({ required: event.target.checked })} /><span><strong>{text("Require memory to be available", "要求记忆可用")}</strong><small>{text("If memory is unavailable, stop before starting a conversation.", "记忆不可用时阻止启动对话。")}</small></span></label>
    </fieldset>
  </>;
}
export function ContextPanel({ draft, update, text }: Props) {
  return <><Intro title={text("Context", "上下文")}>{text("Control how channel conversations are separated and when an inactive conversation resets.", "控制频道对话的隔离方式，以及空闲对话的重置规则。")}</Intro>
    <p className={styles.note}>{text("New conversations and trial conversations start with a new history. These routing rules apply to channel conversations.", "新对话与试运行都使用新历史。以下路由规则用于频道对话。")}</p>
    <div className={styles.formGrid}><label className={styles.fullField}>{text("Session scope", "会话范围")}<select value={draft.session_scope} onChange={(event) => update({ session_scope: event.target.value })}><option value="per-account-channel-peer">{text("Per account, channel and peer", "按账号、频道与联系人隔离")}</option><option value="per-channel-peer">{text("Per channel and peer", "按频道与联系人隔离")}</option><option value="per-peer">{text("Per peer", "按联系人隔离")}</option><option value="main">{text("Shared main session", "共享主会话")}</option></select></label>
      <label>{text("Idle reset (minutes)", "空闲重置（分钟）")}<input type="number" min={0} max={525600} value={draft.session_idle_minutes} onChange={(event) => update({ session_idle_minutes: Number(event.target.value) })} /><small>{text("0 disables idle reset.", "0 表示禁用空闲重置。")}</small></label>
      <label>{text("Daily reset", "每日重置")}<input type="time" value={draft.session_daily_reset} onChange={(event) => update({ session_daily_reset: event.target.value })} /><small>{text("Empty disables daily reset.", "留空表示禁用。")}</small></label>
    </div>
  </>;
}
export function AdvancedPanel({ draft, update, text }: Props) {
  const [workspace, setWorkspace] = useState<{ path: string; files: Array<{ name: string; path: string; exists: boolean }> } | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [copied, setCopied] = useState("");
  useEffect(() => {
    let active = true; const controller = new AbortController(); setWorkspace(null); setError("");
    void jsonFetch<NonNullable<typeof workspace>>(`/api/agents/${encodeURIComponent(draft.id)}/workspace`, { signal: controller.signal }).then((data) => { if (active) setWorkspace(data); }).catch((cause) => { if (active && cause.name !== "AbortError") setError(String(cause.message || cause)); });
    return () => { active = false; controller.abort(); };
  }, [draft.id, attempt]);
  async function copy(path: string) {
    try { await navigator.clipboard.writeText(path); setCopied(path); }
    catch { setError(text("Unable to copy this path", "无法复制路径")); }
  }
  return <><Intro title={text("Advanced", "高级")}>{text("Channel identity and this Agent's workspace files.", "频道身份与此 Agent 的 Workspace 文件。")}</Intro>
    <div className={styles.formGrid}><label>{text("Channel identity", "频道身份")}<input value={draft.identity.name} maxLength={80} onChange={(event) => update({ identity: { ...draft.identity, name: event.target.value } })} /></label><label>{text("Mention patterns", "提及规则")}<input value={draft.identity.mention_patterns.join(", ")} onChange={(event) => update({ identity: { ...draft.identity, mention_patterns: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) } })} /><small>{text("Comma-separated patterns.", "使用逗号分隔。")}</small></label></div>
    <section className={styles.workspaceSection}><h4>{text("Workspace files", "Workspace 文件")}</h4><p className={styles.note}>{text("Files are managed in the Agent workspace. Their contents are not copied when duplicating an Agent.", "文件在 Agent Workspace 中管理。复制 Agent 时不复制文件内容。")}</p>{error ? <p role="alert" className={styles.inlineError}>{error} <button type="button" onClick={() => setAttempt((value) => value + 1)}>{text("Retry", "重试")}</button></p> : workspace ? <><p className={styles.workspacePath}>{workspace.path}</p>{workspace.files.map((file) => <div className={styles.workspaceFile} key={file.name}><span><FileTextIcon size={16} aria-hidden /></span><div><strong>{file.name}</strong><small>{file.exists ? file.path : text("Optional file not created", "可选文件尚未创建")}</small></div><AgentButton variant="ghost" icon={CopyIcon} aria-label={text(`Copy ${file.name} path`, `复制 ${file.name} 路径`)} onClick={() => void copy(file.path)}>{copied === file.path ? text("Copied", "已复制") : text("Copy path", "复制路径")}</AgentButton></div>)}</> : <p role="status">{text("Loading workspace…", "正在加载 Workspace…")}</p>}</section>
  </>;
}
