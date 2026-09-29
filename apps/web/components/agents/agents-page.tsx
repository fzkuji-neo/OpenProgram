"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BotIcon, CheckIcon, CopyIcon, MessageCircleIcon, PlusIcon, SearchIcon, SettingsIcon } from "@/components/animated-icons";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ManagePageHeader, managePageStyles } from "@/components/ui/manage-page";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTranslation } from "@/lib/i18n";
import { HttpError, jsonFetch } from "@/lib/net/fetch-client";
import { startAgentConversation } from "@/lib/agents/start-conversation";
import settingsStyles from "@/components/settings/settings-page.module.css";
import { AgentButton, AgentListRow } from "./agent-controls";
import { AdvancedPanel, ContextPanel, MemoryPanel, ModelPanel, OverviewPanel } from "./agent-panels";
import { CapabilityPanel } from "./agent-capabilities";
import { selectedModel, useAgentModels } from "./model-picker";
import { clone, configuration, normalizeAgent, trialConfiguration, TABS, type Agent, type TabId } from "./agent-types";
import styles from "./agents-page.module.css";

type CachedDraft = { draft: Agent; baseline: Agent; tab: TabId };
// Keep unsaved edits across in-app navigation, including a trial conversation.
// This is deliberately memory-only; a page reload uses the beforeunload guard.
const cachedDrafts = new Map<string, CachedDraft>();
let lastSelected = "";
type PendingAction = { run: (saved: Agent | null) => void | Promise<void> };
function changed(a: Agent, b: Agent) { return JSON.stringify(configuration(a)) !== JSON.stringify(configuration(b)); }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }

export function AgentsPage() {
  const { text } = useTranslation();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [baseline, setBaseline] = useState<Agent | null>(null);
  const [draft, setDraft] = useState<Agent | null>(null);
  const [tab, setTab] = useState<TabId>("overview");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; message: string } | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [conflict, setConflict] = useState<Agent | null>(null);
  const [dialog, setDialog] = useState<"create" | "duplicate" | "delete" | null>(null);
  const [newName, setNewName] = useState("");
  const [deleteId, setDeleteId] = useState("");
  const [dialogError, setDialogError] = useState("");
  const mounted = useRef(true);
  const menu = useRef<HTMLDetailsElement>(null);
  const dialogOpener = useRef<HTMLElement | null>(null);
  const busyRef = useRef(false);
  const models = useAgentModels();
  const dirty = Boolean(draft && baseline && changed(draft, baseline));
  const model = draft ? selectedModel(draft, models) : undefined;
  const effortInvalid = Boolean(draft?.thinking_effort && model && !model.thinking_levels?.includes(draft.thinking_effort));
  const formError = draft && !draft.name.trim() ? text("Enter an Agent name.", "请输入 Agent 名称。")
    : effortInvalid ? text("Choose a supported thinking effort in Model & Instructions.", "请在模型与指令中选择支持的思考强度。") : "";

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (draft && baseline) {
      cachedDrafts.set(draft.id, { draft: clone(draft), baseline: clone(baseline), tab });
      lastSelected = draft.id;
    }
  }, [draft, baseline, tab]);
  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);

  const applyAgent = useCallback((raw: Agent, restore = false) => {
    const saved = normalizeAgent(clone(raw));
    setAgents((rows) => rows.map((agent) => agent.id === saved.id ? saved : agent));
    const cached = restore ? cachedDrafts.get(saved.id) : undefined;
    if (cached && changed(cached.draft, cached.baseline)) {
      setBaseline(clone(cached.baseline)); setDraft(clone(cached.draft)); setTab(cached.tab);
      setConflict(saved.revision !== cached.baseline.revision ? saved : null);
    } else {
      setBaseline(saved); setDraft(clone(saved)); setTab("overview"); setConflict(null);
      cachedDrafts.set(saved.id, { draft: clone(saved), baseline: clone(saved), tab: "overview" });
    }
    setNotice(null); lastSelected = saved.id;
  }, []);
  const loadAgents = useCallback(async (preferredId?: string, signal?: AbortSignal) => {
    const data = await jsonFetch<{ agents: Agent[] }>("/api/agents", { signal });
    if (!mounted.current || signal?.aborted) return;
    const rows = data.agents.map(normalizeAgent);
    setAgents(rows); setLoadError("");
    const next = rows.find((agent) => agent.id === (preferredId || lastSelected)) || rows.find((agent) => agent.default) || rows[0];
    if (next) applyAgent(next, true);
    else { setDraft(null); setBaseline(null); setConflict(null); lastSelected = ""; }
  }, [applyAgent]);
  useEffect(() => {
    const controller = new AbortController();
    void loadAgents(undefined, controller.signal).catch((error) => { if (!controller.signal.aborted) setLoadError(errorMessage(error)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [loadAgents]);
  function updateDraft(patch: Partial<Agent>) { setDraft((current) => current ? { ...current, ...patch } : current); setNotice(null); }
  function lock(value: boolean) { busyRef.current = value; if (mounted.current) setBusy(value); }
  function discard() {
    if (!baseline) return;
    setDraft(clone(baseline)); setConflict(null); setNotice(null);
    cachedDrafts.set(baseline.id, { draft: clone(baseline), baseline: clone(baseline), tab });
  }
  async function save(): Promise<Agent | null> {
    if (!draft || busyRef.current || formError) return null;
    const submitted = clone(draft);
    const submittedCache = cachedDrafts.get(submitted.id);
    captureDialogOpener(); lock(true); setNotice(null);
    try {
      const result = await jsonFetch<{ agent: Agent }>(`/api/agents/${encodeURIComponent(submitted.id)}`, {
        method: "PATCH", body: JSON.stringify({ ...configuration(submitted), expected_revision: baseline?.revision ?? submitted.revision }),
      });
      const saved = normalizeAgent(result.agent);
      // A remounted editor may already own a newer draft. Keep its baseline
      // so the existing revision conflict flow reconciles this late response.
      if (cachedDrafts.get(saved.id) === submittedCache) {
        cachedDrafts.set(saved.id, { draft: clone(saved), baseline: clone(saved), tab });
      }
      if (mounted.current) {
        setAgents((rows) => rows.map((agent) => agent.id === saved.id ? saved : agent));
        setBaseline(clone(saved)); setDraft(clone(saved)); setConflict(null);
        setNotice({ tone: "ok", message: text("Saved", "已保存") });
      }
      return saved;
    } catch (error) {
      if (!mounted.current) return null;
      if (error instanceof HttpError && error.status === 409) {
        try {
          const body = JSON.parse(error.body || "{}");
          const latest = body.agent || body.current || (await jsonFetch<{ agent: Agent }>(`/api/agents/${encodeURIComponent(submitted.id)}`)).agent;
          if (mounted.current) { setConflict(normalizeAgent(latest)); setPending(null); }
        } catch (refreshError) { if (mounted.current) setNotice({ tone: "error", message: errorMessage(refreshError) }); }
      } else setNotice({ tone: "error", message: errorMessage(error) });
      return null;
    } finally { lock(false); }
  }
  function captureDialogOpener() {
    const active = document.activeElement as HTMLElement | null;
    dialogOpener.current = menu.current?.contains(active) ? menu.current.querySelector("summary") : active;
  }
  function restoreDialogFocus(event: Event) {
    event.preventDefault();
    if (document.querySelector('[role="dialog"][data-state="open"]')) return;
    const target = dialogOpener.current;
    if (target?.isConnected && !target.matches(":disabled")) target.focus();
    else document.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
  }
  function guard(run: PendingAction["run"]) {
    if (busyRef.current) return;
    if (dirty) { captureDialogOpener(); setPending({ run }); } else void run(baseline);
  }
  async function resolveLeave(choice: "save" | "discard") {
    if (!pending || busyRef.current) return;
    const action = pending;
    const saved = choice === "save" ? await save() : baseline;
    if (choice === "save" && !saved) return;
    if (choice === "discard") discard();
    setPending(null); await action.run(saved);
  }
  function openDialog(kind: NonNullable<typeof dialog>) {
    captureDialogOpener();
    if (menu.current) menu.current.open = false;
    guard((saved) => {
      setDialogError(""); setDeleteId(""); setNewName(kind === "duplicate" && saved ? `${saved.name} ${text("Copy", "副本")}` : ""); setDialog(kind);
    });
  }
  async function submitName() {
    if (!newName.trim() || busyRef.current) return;
    const duplicate = dialog === "duplicate";
    if (duplicate && !baseline) return;
    lock(true); setDialogError("");
    try {
      const url = duplicate ? `/api/agents/${encodeURIComponent(baseline!.id)}/duplicate` : "/api/agents";
      const payload = await jsonFetch<{ agent: Agent }>(url, { method: "POST", body: JSON.stringify({ name: newName.trim() }) });
      if (!mounted.current) return;
      const created = normalizeAgent(payload.agent); setAgents((rows) => [...rows, created]); applyAgent(created);
      setDialog(null); setNewName(""); setSearch("");
    } catch (error) { if (mounted.current) setDialogError(errorMessage(error)); }
    finally { lock(false); }
  }
  async function makeDefault(saved: Agent | null) {
    if (!saved || saved.default || busyRef.current) return;
    lock(true); setNotice(null);
    try {
      const result = await jsonFetch<{ agent: Agent }>(`/api/agents/${encodeURIComponent(saved.id)}/default`, { method: "POST" });
      if (!mounted.current) return;
      const updated = normalizeAgent(result.agent);
      setAgents((rows) => rows.map((agent) => agent.id === updated.id ? updated : { ...agent, default: false }));
      applyAgent(updated); setNotice({ tone: "ok", message: text("Default Agent updated", "默认 Agent 已更新") });
    } catch (error) { if (mounted.current) setNotice({ tone: "error", message: errorMessage(error) }); }
    finally { lock(false); }
  }
  async function remove() {
    if (!baseline || baseline.default || deleteId !== baseline.id || busyRef.current) return;
    const id = baseline.id; lock(true); setDialogError("");
    try {
      await jsonFetch(`/api/agents/${encodeURIComponent(id)}`, { method: "DELETE" });
      cachedDrafts.delete(id); if (lastSelected === id) lastSelected = "";
      if (!mounted.current) return;
      setDialog(null); setDeleteId(""); setDraft(null); setBaseline(null); setConflict(null);
      await loadAgents();
    } catch (error) { if (mounted.current) setDialogError(errorMessage(error)); }
    finally { lock(false); }
  }
  async function start(trial: boolean, saved: Agent | null = baseline) {
    const source = trial ? draft : saved;
    if (!source || busyRef.current) return;
    lock(true); setNotice(null);
    // Capture before navigation. The map also retains this draft on return.
    if (draft && baseline) cachedDrafts.set(draft.id, { draft: clone(draft), baseline: clone(baseline), tab });
    try {
      await startAgentConversation(trial ? { agentId: source.id, config: trialConfiguration(source), trial: true } : { agentId: source.id });
    } catch (error) { if (mounted.current) setNotice({ tone: "error", message: errorMessage(error) }); }
    finally { lock(false); }
  }
  function keepDraft() {
    if (!conflict || !draft) return;
    const current = conflict;
    setBaseline(clone(current)); setDraft({ ...draft, revision: current.revision, updated_at: current.updated_at, default: current.default });
    setAgents((rows) => rows.map((agent) => agent.id === current.id ? current : agent)); setConflict(null);
    setNotice({ tone: "ok", message: text("Draft kept. Review the fields, then save to replace the server configuration.", "已保留草稿。确认字段后保存，将替换服务端配置。") });
  }
  const visible = agents.filter((agent) => `${agent.name} ${agent.id} ${agent.description}`.toLowerCase().includes(search.trim().toLowerCase()));
  const activeName = draft?.name || draft?.id || "";
  const canStart = !models.loading && !models.error && Boolean(model) && !effortInvalid;
  return <div className={`main ${styles.agentsMain}`}><div className={`${managePageStyles.view} ${styles.agentView}`}>
    <ManagePageHeader title="Agents" toolbar={<span className={styles.unsaved} role="status">{dirty ? text("Unsaved changes", "有未保存的修改") : draft ? text("Saved", "已保存") : ""}</span>} actions={[{ label: text("New Agent", "新建 Agent"), onClick: () => openDialog("create"), icon: PlusIcon, disabled: busy || loading || Boolean(loadError), primary: true }]} />
    {notice ? <div className={notice.tone === "error" ? styles.errorBanner : styles.successBanner} role={notice.tone === "error" ? "alert" : "status"}><span>{notice.message}</span></div> : null}
    {loading ? <div className={styles.centerState} role="status">{text("Loading Agents…", "正在加载 Agents…")}</div> : loadError ? <div className={styles.centerState} role="alert"><p>{text("Unable to load Agents", "无法加载 Agents")}</p><p>{loadError}</p><AgentButton onClick={() => { setLoading(true); void loadAgents().catch((error) => setLoadError(errorMessage(error))).finally(() => setLoading(false)); }}>{text("Retry", "重试")}</AgentButton></div> : <div className={`${managePageStyles.splitBody} ${styles.agentSplit}`}>
      <aside className={styles.agentNav} aria-label={text("Agent list", "Agent 列表")}>
        <label className={styles.searchField}><SearchIcon size={15} aria-hidden /><input aria-label={text("Search Agents", "搜索 Agents")} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={text("Search Agents…", "搜索 Agents…")} /></label>
        <label className={styles.mobileAgentSelect}>{text("Agent", "Agent")}<select value={draft?.id || ""} disabled={busy} onChange={(event) => { const agent = agents.find((item) => item.id === event.target.value); if (agent) guard(() => applyAgent(agent, true)); }}>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name || agent.id}{agent.default ? ` (${text("Default", "默认")})` : ""}</option>)}</select></label>
        <div className={styles.agentList}>{visible.map((agent) => <AgentListRow key={agent.id} className={agent.id === draft?.id ? styles.agentSelected : undefined} onClick={() => { if (agent.id !== draft?.id) guard(() => applyAgent(agent, true)); }} name={agent.name || agent.id} description={agent.description || `${agent.model.id || text("Default model", "默认模型")} · ${agent.memory.mode === "off" ? text("Memory off", "记忆关闭") : agent.memory.mode === "read_only" ? text("Memory read only", "记忆只读") : text("Memory read/write", "记忆读写")}`} meta={agent.default ? <span className={managePageStyles.badge}>{text("Default", "默认")}</span> : null} />)}{!visible.length && agents.length ? <p className={styles.note}>{text("No matching Agents", "没有匹配的 Agent")}</p> : null}</div>
      </aside>
      <main className={styles.editor}>{!draft ? <div className={styles.emptyState}><BotIcon size={28} /><h2>{text("Create your first Agent", "创建第一个 Agent")}</h2><p>{text("Configure a model, capabilities, and optional memory.", "配置模型、能力和可选的长期记忆。")}</p><AgentButton icon={PlusIcon} onClick={() => openDialog("create")}>{text("New Agent", "新建 Agent")}</AgentButton></div> : <div className={`${settingsStyles.page} ${styles.editorPage}`}>
        <div className={`${settingsStyles.pageHeader} ${styles.agentPageHeader}`}><span className={styles.detailAvatar}><BotIcon size={20} aria-hidden /></span><div className={styles.agentHeading}><h2 className={settingsStyles.pageTitle}>{activeName}</h2><p className={settingsStyles.pageMeta}>{draft.id} · {text("Revision", "修订") } {baseline?.revision}</p></div>
          <details ref={menu} key={draft.id} className={styles.moreMenu}><summary aria-label={text("Agent actions", "Agent 操作")}><SettingsIcon size={18} aria-hidden /></summary><div><AgentButton icon={CheckIcon} variant="ghost" disabled={draft.default || busy} onClick={() => { if (menu.current) menu.current.open = false; guard(makeDefault); }}>{text("Set as default", "设为默认")}</AgentButton><AgentButton icon={CopyIcon} variant="ghost" disabled={busy} onClick={() => openDialog("duplicate")}>{text("Duplicate Agent", "复制 Agent")}</AgentButton><AgentButton variant="ghost" className={styles.danger} disabled={draft.default || busy} onClick={() => openDialog("delete")}>{text("Delete Agent", "删除 Agent")}</AgentButton></div></details>
        </div>
        <div className={styles.conversationActions}><AgentButton variant="outline" icon={MessageCircleIcon} disabled={busy} onClick={() => guard((saved) => start(false, saved))}>{text("New conversation", "新对话")}</AgentButton><AgentButton variant="ghost" icon={MessageCircleIcon} disabled={busy || !canStart || Boolean(formError)} onClick={() => void start(true)}>{text("Try in new conversation", "在新对话试运行")}</AgentButton><span>{text("New conversation uses saved settings; a trial uses your draft with memory read only or off.", "新对话使用已保存配置；试运行使用草稿，记忆最多只读。")}</span></div>
        <Tabs className={styles.configTabs} value={tab} onValueChange={(value) => setTab(value as TabId)}><TabsList className={styles.configTabsList} aria-label={text("Agent configuration", "Agent 配置")}>{TABS.map((item) => <TabsTrigger className={styles.configTab} value={item.id} key={item.id}>{text(item.en, item.zh)}</TabsTrigger>)}</TabsList>
          <div className={`${settingsStyles.pageBody} ${styles.editorBody}`}><fieldset className={styles.editorFields} disabled={busy}>
            <TabsContent className={styles.tabPanel} value="overview"><OverviewPanel draft={draft} update={updateDraft} text={text} go={setTab} /></TabsContent>
            <TabsContent className={styles.tabPanel} value="model"><ModelPanel draft={draft} update={updateDraft} text={text} catalog={models} /></TabsContent>
            {(["programs", "skills", "mcp"] as const).map((kind) => <TabsContent className={styles.tabPanel} value={kind} key={kind}><CapabilityPanel kind={kind} draft={draft} update={updateDraft} text={text} /></TabsContent>)}
            <TabsContent className={styles.tabPanel} value="memory"><MemoryPanel draft={draft} update={updateDraft} text={text} /></TabsContent>
            <TabsContent className={styles.tabPanel} value="context"><ContextPanel draft={draft} update={updateDraft} text={text} /></TabsContent>
            <TabsContent className={styles.tabPanel} value="advanced"><AdvancedPanel draft={draft} update={updateDraft} text={text} /></TabsContent>
          </fieldset></div>
        </Tabs>
        <div className={styles.saveBar}>{formError ? <span role="alert" className={styles.inlineError}>{formError}</span> : <span>{dirty ? text("Changes apply after saving.", "保存后生效。") : text("This Agent's configuration is saved.", "此 Agent 的配置已保存。")}</span>}<AgentButton variant="ghost" disabled={!dirty || busy} onClick={discard}>{text("Discard changes", "放弃修改")}</AgentButton><AgentButton icon={CheckIcon} disabled={!dirty || busy || Boolean(formError)} onClick={() => void save()}>{busy ? text("Working…", "处理中…") : text("Save changes", "保存修改")}</AgentButton></div>
      </div>}</main>
    </div>}
    <Dialog open={pending !== null} onOpenChange={(open) => { if (!open && !busy) setPending(null); }}><DialogContent onCloseAutoFocus={restoreDialogFocus}><DialogHeader><DialogTitle>{text("Unsaved changes", "未保存的修改")}</DialogTitle><DialogDescription>{text("Save or discard your changes before continuing.", "继续前保存或放弃修改。")}</DialogDescription></DialogHeader><DialogFooter><AgentButton variant="ghost" disabled={busy} onClick={() => setPending(null)}>{text("Cancel", "取消")}</AgentButton><AgentButton variant="outline" disabled={busy} onClick={() => void resolveLeave("discard")}>{text("Discard", "放弃")}</AgentButton><AgentButton disabled={busy || Boolean(formError)} onClick={() => void resolveLeave("save")}>{text("Save and continue", "保存并继续")}</AgentButton></DialogFooter></DialogContent></Dialog>
    <Dialog open={conflict !== null} onOpenChange={(open) => { if (!open) setConflict(null); }}><DialogContent className={styles.conflictDialog} onCloseAutoFocus={restoreDialogFocus}><DialogHeader><DialogTitle>{text("Configuration changed on the server", "服务端配置已更新")}</DialogTitle><DialogDescription>{text("Your draft has been kept. Compare the values before replacing either version.", "你的草稿已保留。比较字段后明确选择保留哪份配置。")}</DialogDescription></DialogHeader>
      {conflict && draft ? <div className={styles.conflictBody}><div className={styles.conflictLabels}><strong>{text("Your draft", "你的草稿")}</strong><strong>{text("Server configuration", "服务端配置")}</strong></div>{Object.entries(configuration(draft)).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(configuration(conflict)[key as keyof ReturnType<typeof configuration>])).map(([key, value]) => <section key={key}><h4>{key}</h4><div className={styles.conflictValues}><pre>{typeof value === "string" ? value || "—" : JSON.stringify(value, null, 2)}</pre><pre>{typeof configuration(conflict)[key as keyof ReturnType<typeof configuration>] === "string" ? String(configuration(conflict)[key as keyof ReturnType<typeof configuration>]) || "—" : JSON.stringify(configuration(conflict)[key as keyof ReturnType<typeof configuration>], null, 2)}</pre></div></section>)}</div> : null}
      <DialogFooter><AgentButton variant="ghost" onClick={() => setConflict(null)}>{text("Cancel", "取消")}</AgentButton><AgentButton variant="outline" onClick={() => { if (conflict) { applyAgent(conflict); setTab(tab); } }}>{text("Load server version", "加载服务端版本")}</AgentButton><AgentButton onClick={keepDraft}>{text("Keep my draft", "保留我的草稿")}</AgentButton></DialogFooter>
    </DialogContent></Dialog>
    <Dialog open={dialog === "create" || dialog === "duplicate"} onOpenChange={(open) => { if (!open && !busy) setDialog(null); }}><DialogContent onCloseAutoFocus={restoreDialogFocus}><form className={styles.dialogForm} onSubmit={(event) => { event.preventDefault(); void submitName(); }}><DialogHeader><DialogTitle>{dialog === "duplicate" ? text("Duplicate Agent", "复制 Agent") : text("New Agent", "新建 Agent")}</DialogTitle><DialogDescription>{dialog === "duplicate" ? text("Copy saved configuration. Conversations, memory records, and workspace file contents are not copied.", "复制已保存配置，不复制对话、记忆记录或 Workspace 文件内容。") : text("Choose a name. New Agents start with memory off.", "填写名称。新 Agent 默认关闭记忆。")}</DialogDescription></DialogHeader><label className={styles.dialogField}>{text("Agent name", "Agent 名称")}<input autoFocus value={newName} maxLength={80} disabled={busy} onChange={(event) => setNewName(event.target.value)} /></label>{dialogError ? <p className={styles.dialogError} role="alert">{dialogError}</p> : null}<DialogFooter><AgentButton type="button" variant="ghost" disabled={busy} onClick={() => setDialog(null)}>{text("Cancel", "取消")}</AgentButton><AgentButton type="submit" disabled={busy || !newName.trim()}>{dialog === "duplicate" ? text("Duplicate", "复制") : text("Create", "创建")}</AgentButton></DialogFooter></form></DialogContent></Dialog>
    <Dialog open={dialog === "delete"} onOpenChange={(open) => { if (!open && !busy) setDialog(null); }}><DialogContent onCloseAutoFocus={restoreDialogFocus}><DialogHeader><DialogTitle>{text("Delete Agent", "删除 Agent")}</DialogTitle><DialogDescription>{text("This removes the Agent configuration, workspace, and sessions. Shared Programs, Skills and MCP services are kept.", "这会删除此 Agent 的配置、Workspace 和会话。共享的 Programs、Skills 与 MCP 服务保留。")}</DialogDescription></DialogHeader><label className={styles.dialogField}>{text(`Type ${baseline?.id || ""} to confirm`, `输入 ${baseline?.id || ""} 以确认`)}<input value={deleteId} disabled={busy} onChange={(event) => setDeleteId(event.target.value)} /></label>{dialogError ? <p className={styles.dialogError} role="alert">{dialogError}</p> : null}<DialogFooter><AgentButton variant="ghost" disabled={busy} onClick={() => setDialog(null)}>{text("Cancel", "取消")}</AgentButton><AgentButton variant="destructive" disabled={busy || deleteId !== baseline?.id} onClick={() => void remove()}>{text("Delete Agent", "删除 Agent")}</AgentButton></DialogFooter></DialogContent></Dialog>
  </div></div>;
}
