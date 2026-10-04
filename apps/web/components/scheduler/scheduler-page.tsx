"use client";

import { useEffect, useMemo, useState } from "react";
import { Bell, CalendarClock, Clock3, Eye, Link2, Pause, Play, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SearchInput } from "@/components/ui/search-input";
import {
  ManageEmptyState, ManageIconButton, ManagePage, ManagePageHeader, ManageRow,
  ManageSubnav, ManageSummary, managePageStyles as shared,
} from "@/components/ui/manage-page";
import { PlusIcon, RefreshCwIcon } from "@/components/animated-icons";
import { useTranslation } from "@/lib/i18n";
import styles from "./scheduler-page.module.css";
import {
  actionAccessibleName,
  filterTasks,
  numberedTasks,
  shouldShowSuggestions,
  taskCounts,
} from "./scheduler-view-model.mjs";

type TaskType = "once" | "recurring" | "monitor";
type TaskFilter = "all" | TaskType;

interface MemoryRef {
  workspace_id: string;
  memory_id: string;
  topic_path: string;
  content: string;
}

interface Task {
  id: string;
  title: string;
  type: TaskType;
  enabled: boolean;
  prompt?: string;
  command?: string;
  cron?: string;
  run_at?: string;
  memory_refs: Array<Pick<MemoryRef, "workspace_id" | "memory_id">>;
}

const EMPTY_FORM = {
  title: "",
  type: "once" as TaskType,
  prompt: "",
  runAt: "",
  cron: "0 9 * * *",
  memoryId: "",
};

export function SchedulerPage() {
  const { t, text, locale } = useTranslation();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [memoryRefs, setMemoryRefs] = useState<MemoryRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [pageError, setPageError] = useState("");
  // The dialog keeps showing pendingDelete through its exit animation, so
  // open state is separate from the task being confirmed.
  const [pendingDelete, setPendingDelete] = useState<Task | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function reload() {
    setLoading(true);
    setPageError("");
    try {
      const response = await fetch("/api/scheduler/tasks");
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(text("Could not load scheduled tasks", "无法加载定时任务"));
      setTasks(Array.isArray(data) ? data : []);
      setLoadedOnce(true);
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : text("Could not load scheduled tasks", "无法加载定时任务"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    fetch("/api/memory/refs?limit=200")
      .then((response) => response.ok ? response.json() : [])
      .then((data) => setMemoryRefs(Array.isArray(data) ? data : []))
      .catch(() => setMemoryRefs([]));
  }, []);

  const visible = useMemo(() => filterTasks(tasks, filter, search) as Task[], [filter, search, tasks]);
  const counts = useMemo(() => taskCounts(tasks) as Record<TaskFilter, number>, [tasks]);

  const filters: Array<{ id: TaskFilter; label: string }> = [
    { id: "all", label: text("All tasks", "全部任务") },
    { id: "once", label: text("One-time", "一次性") },
    { id: "recurring", label: text("Recurring", "周期任务") },
    { id: "monitor", label: text("Monitors", "监控任务") },
  ];

  function begin(template?: Partial<typeof EMPTY_FORM>) {
    setForm({ ...EMPTY_FORM, ...template });
    setError("");
    setOpen(true);
  }

  async function createTask() {
    setSaving(true);
    setError("");
    try {
      const selected = memoryRefs.find((ref) => ref.memory_id === form.memoryId);
      const payload = {
        title: form.title,
        type: form.type,
        prompt: form.prompt,
        ...(form.type === "once"
          ? { run_at: form.runAt ? new Date(form.runAt).toISOString() : "" }
          : { cron: form.cron }),
        memory_refs: selected ? [{
          workspace_id: selected.workspace_id,
          memory_id: selected.memory_id,
        }] : [],
      };
      const response = await fetch("/api/scheduler/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error?.message || text("Create failed", "创建失败"));
      setTasks((current) => [...current, data]);
      setOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : text("Create failed", "创建失败"));
    } finally {
      setSaving(false);
    }
  }

  async function toggle(task: Task) {
    setPageError("");
    try {
      const response = await fetch(`/api/scheduler/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !task.enabled }),
      });
      const updated = await response.json().catch(() => null);
      if (!response.ok) throw new Error(text("Could not update task", "无法更新任务"));
      setTasks((current) => current.map((row) => row.id === task.id ? updated : row));
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : text("Could not update task", "无法更新任务"));
    }
  }

  async function remove(task: Task): Promise<boolean> {
    setPageError("");
    try {
      const response = await fetch(`/api/scheduler/tasks/${task.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(text("Could not delete task", "无法删除任务"));
      setTasks((current) => current.filter((row) => row.id !== task.id));
      return true;
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : text("Could not delete task", "无法删除任务"));
      return false;
    }
  }

  async function confirmDelete() {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    const ok = await remove(pendingDelete);
    setDeleting(false);
    if (ok) setDeleteOpen(false);
  }

  const activeCount = tasks.filter((task) => task.enabled).length;
  const filterTabs = filters.map((item) => ({ id: item.id, label: item.label, count: loadedOnce ? counts[item.id] : undefined }));
  // A reload replaces the whole list, so hold row mutations until it lands
  // instead of letting an older snapshot overwrite a newer change.
  const rowsBusy = loading || deleting;

  return (
    <ManagePage className={styles.view}>
        <ManagePageHeader
          title={t("nav.scheduler")}
          toolbar={(
            <>
              {loadedOnce && tasks.length > 0 && (
                <ManageSummary>{text(`${activeCount} of ${tasks.length} active`, `已启用 ${activeCount}/${tasks.length} 个`)}</ManageSummary>
              )}
              <SearchInput
                className={styles.headerSearch}
                placeholder={text("Search tasks...", "搜索任务...")}
                value={search}
                onChange={setSearch}
              />
            </>
          )}
          actions={[
            { label: text("Refresh", "刷新"), onClick: () => void reload(), icon: RefreshCwIcon, iconOnly: true, disabled: loading },
            { label: text("New task", "新建任务"), onClick: () => begin(), icon: PlusIcon, primary: true, disabled: !loadedOnce || loading },
          ]}
        />
        <ManageSubnav
          tabs={filterTabs}
          activeTab={filter}
          onTabChange={(id) => setFilter(id as TaskFilter)}
          ariaLabel={text("Task types", "任务类型")}
          panelId="scheduler-panel"
        />
        {pageError && <div className={shared.errorBar} role="alert">{pageError}</div>}
        <main className={styles.layout}>
          <div
            id="scheduler-panel"
            role="tabpanel"
            aria-labelledby={`scheduler-panel-tab-${filter}`}
            className={styles.content}
          >
            {loading && !loadedOnce ? (
              <div className={shared.empty}>{text("Loading…", "加载中…")}</div>
            ) : !loadedOnce ? (
              <ManageEmptyState
                icon={<CalendarClock />}
                title={text("Scheduled tasks are unavailable", "暂时无法加载定时任务")}
                description={text("Check the error above, then try again.", "请查看上方错误后重试。")}
                action={<Button variant="outline" onClick={() => void reload()}>{text("Retry", "重试")}</Button>}
              />
            ) : visible.length > 0 ? (
              <section aria-label={text("Scheduled tasks", "定时任务")}>
                <div className={shared.sectionHeader}>
                  <span>{filterLabel(filter, text)}</span>
                  <span>{visible.length}</span>
                </div>
                <div className={styles.list}>
                  {numberedTasks(visible).map(({ task, number }: { task: Task; number: number }) => (
                    <ManageRow
                      key={task.id}
                      icon={<span className={styles.taskIndex}>{number}</span>}
                      name={task.title}
                      description={(
                        <span className={styles.description}>
                          <code className={styles.schedule}>{formatSchedule(task, text, locale)}</code>
                          {(task.prompt || task.command) && <span>{task.prompt || task.command}</span>}
                        </span>
                      )}
                      meta={(
                        <>
                          <span className={shared.badge}>{typeLabel(task.type, text)}</span>
                          <span className={`${shared.badge} ${task.enabled ? shared.badgeGreen : ""}`}>
                            {task.enabled ? text("Active", "已启用") : text("Paused", "已暂停")}
                          </span>
                          {!!task.memory_refs?.length && (
                            <span className={styles.memory}><Link2 aria-hidden />{text(`${task.memory_refs.length} memory ${task.memory_refs.length === 1 ? "reference" : "references"}`, `${task.memory_refs.length} 条记忆引用`)}</span>
                          )}
                        </>
                      )}
                      actions={(
                        <>
                          <ManageIconButton
                            disabled={rowsBusy}
                            onClick={() => void toggle(task)}
                            label={actionAccessibleName(task.enabled ? text("Pause", "暂停") : text("Resume", "恢复"), task.title)}
                            tooltip={task.enabled ? text("Pause", "暂停") : text("Resume", "恢复")}
                          >
                            {task.enabled ? <Pause /> : <Play />}
                          </ManageIconButton>
                          <ManageIconButton
                            danger
                            disabled={rowsBusy}
                            onClick={() => { setPendingDelete(task); setDeleteOpen(true); }}
                            label={actionAccessibleName(text("Delete", "删除"), task.title)}
                            tooltip={text("Delete", "删除")}
                          >
                            <Trash2 />
                          </ManageIconButton>
                        </>
                      )}
                    />
                  ))}
                </div>
              </section>
            ) : shouldShowSuggestions(tasks, filter, search) ? (
              <Suggestions onChoose={begin} text={text} />
            ) : (
              <ManageEmptyState
                compact
                icon={<CalendarClock />}
                title={search.trim() ? text("No matching tasks", "没有匹配的任务") : text("Nothing here yet", "这里还没有任务")}
                description={search.trim()
                  ? text("Try a different search or task type.", "换个关键词或任务类型试试。")
                  : text("Tasks of this type will appear here.", "此类型的任务会显示在这里。")}
              />
            )}
          </div>
        </main>

      <Dialog open={deleteOpen} onOpenChange={(next) => { if (!deleting) setDeleteOpen(next); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{text("Delete scheduled task", "删除定时任务")}</DialogTitle>
            <DialogDescription>
              {text(`“${pendingDelete?.title ?? ""}” will stop running and be removed.`, `“${pendingDelete?.title ?? ""}”将停止运行并被删除。`)}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={deleting} onClick={() => setDeleteOpen(false)}>{text("Cancel", "取消")}</Button>
            <Button variant="destructive" disabled={deleting} onClick={() => void confirmDelete()}>{deleting ? text("Deleting…", "删除中…") : text("Delete", "删除")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{text("Create scheduled task", "创建定时任务")}</DialogTitle>
            <DialogDescription>{text("The task runs with the current owner's permissions, frozen when it is created.", "任务按创建时冻结的当前所有者权限执行。")}</DialogDescription>
          </DialogHeader>
          <div className={styles.form}>
            <label>{text("Title", "标题")}<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
            <label>{text("Type", "类型")}<select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as TaskType })}>
              <option value="once">{text("One-time", "一次性")}</option>
              <option value="recurring">{text("Recurring", "周期")}</option>
              <option value="monitor">{text("Monitor", "监控")}</option>
            </select></label>
            {form.type === "once" ? (
              <label>{text("Run at", "执行时间")}<input type="datetime-local" value={form.runAt} onChange={(event) => setForm({ ...form, runAt: event.target.value })} /></label>
            ) : (
              <label>{text("Cron expression", "Cron 表达式")}<input value={form.cron} onChange={(event) => setForm({ ...form, cron: event.target.value })} placeholder="0 9 * * 1-5" /></label>
            )}
            <label>{text("Task prompt", "任务提示")}<textarea value={form.prompt} onChange={(event) => setForm({ ...form, prompt: event.target.value })} rows={4} /></label>
            <label>{text("Memory context (optional)", "记忆上下文（可选）")}<select value={form.memoryId} onChange={(event) => setForm({ ...form, memoryId: event.target.value })}>
              <option value="">{text("No Memory reference", "不引用记忆")}</option>
              {memoryRefs.map((ref) => <option value={ref.memory_id} key={ref.memory_id}>{ref.topic_path} · {ref.content.slice(0, 70)}</option>)}
            </select></label>
            {error && <div className={styles.error} role="alert">{error}</div>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{text("Cancel", "取消")}</Button>
            <Button onClick={() => void createTask()} disabled={saving}>{saving ? text("Creating…", "创建中…") : text("Create", "创建")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ManagePage>
  );
}

function typeLabel(type: TaskType, text: (en: string, zh: string) => string) {
  if (type === "once") return text("One-time", "一次性");
  if (type === "monitor") return text("Monitor", "监控");
  return text("Recurring", "周期");
}

function filterLabel(filter: TaskFilter, text: (en: string, zh: string) => string) {
  if (filter === "all") return text("All scheduled tasks", "全部定时任务");
  if (filter === "once") return text("One-time tasks", "一次性任务");
  if (filter === "monitor") return text("Monitors", "监控任务");
  return text("Recurring tasks", "周期任务");
}

// The type badge already names the kind of task; the schedule column only
// carries the time or cron expression.
function formatSchedule(task: Task, text: (en: string, zh: string) => string, locale: string) {
  if (task.type === "once") return task.run_at ? new Date(task.run_at).toLocaleString(locale === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium", timeStyle: "short" }) : text("Not scheduled", "未设置时间");
  return task.cron || "";
}

function Suggestions({ onChoose, text }: {
  onChoose: (template?: Partial<typeof EMPTY_FORM>) => void;
  text: (en: string, zh: string) => string;
}) {
  const rows = [
    { icon: <Bell />, title: text("Daily brief", "每日简报"), schedule: text("Weekdays at 8:00 AM", "工作日 8:00"), form: { type: "recurring" as TaskType, title: text("Daily brief", "每日简报"), cron: "0 8 * * 1-5", prompt: text("Summarize today's priorities.", "总结今天的优先事项。") } },
    { icon: <Clock3 />, title: text("Weekly review", "每周回顾"), schedule: text("Fridays at 4:00 PM", "周五 16:00"), form: { type: "recurring" as TaskType, title: text("Weekly review", "每周回顾"), cron: "0 16 * * 5", prompt: text("Review this week's work and open decisions.", "回顾本周工作和未决事项。") } },
    { icon: <Eye />, title: text("Follow-up monitor", "跟进监控"), schedule: text("Weekdays at 9:00 AM", "工作日 9:00"), form: { type: "monitor" as TaskType, title: text("Follow-up monitor", "跟进监控"), cron: "0 9 * * 1-5", prompt: text("Check whether the selected follow-up needs attention.", "检查选定的跟进事项是否需要处理。") } },
  ];
  return (
    <section className={styles.suggestions}>
      <ManageEmptyState
        compact
        icon={<CalendarClock />}
        title={text("No scheduled tasks", "还没有定时任务")}
        description={text("Run a prompt once, on a schedule, or as a monitor. Create a task or start from a suggestion.", "让提示词单次、周期或以监控方式运行。创建任务，或从建议开始。")}
        action={<Button onClick={() => onChoose()}><PlusIcon size={16} aria-hidden />{text("New task", "新建任务")}</Button>}
      />
      <div className={shared.sectionHeader}>
        <span>{text("Start from a suggestion", "从建议开始")}</span>
      </div>
      <div className={styles.suggestionList}>
        {rows.map((row) => (
          <article key={row.title} className={styles.suggestionRow}>
            <span className={styles.suggestionIcon} aria-hidden="true">{row.icon}</span>
            <h3>{row.title}</h3>
            <p className={styles.suggestionSchedule}>{row.schedule}</p>
            <p className={styles.suggestionPrompt}>{row.form.prompt}</p>
            <Button size="sm" variant="outline" aria-label={actionAccessibleName(text("Use", "使用"), row.title)} onClick={() => onChoose(row.form)}>{text("Use", "使用")}</Button>
          </article>
        ))}
      </div>
    </section>
  );
}
