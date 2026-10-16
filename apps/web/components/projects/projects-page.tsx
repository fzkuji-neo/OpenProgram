"use client";

/**
 * History, organised by project. Left rail: the projects, the System
 * project first (chats that belong to no project, and the personal memory
 * every project reads). Right: the selected project's Chats, Memory,
 * Settings (defaults + permission rules) and Info. Same-page switching,
 * no route change.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, FolderSearch } from "lucide-react";

import fx from "@/components/functions/functions-page.module.css";
import { SearchInput } from "@/components/ui/search-input";
import { useFolderPicker } from "@/components/ui/folder-picker";
import styles from "./projects-page.module.css";
import { ManageEmptyState, managePageStyles as shared } from "@/components/ui/manage-page";
import { projectName } from "@/lib/projects/project-name";
import { useTranslation } from "@/lib/i18n";
import { EarthIcon, FoldersIcon, FolderPlusIcon } from "@/components/animated-icons";
import { wsRequest } from "@/lib/net/ws-request";
import { ProjectEditor, type EditableProject } from "@/components/sidebar/project-editor";
import { Button } from "@/components/ui/button";
import { ChatsPage } from "@/components/chats/chats-page";
import { MemoryPage } from "@/components/memory";
import { useSessionStore, type ConvSummary } from "@/lib/session-store";
import { PermissionsSection } from "./permissions-section";
import { ProjectConfigSection } from "./project-config-section";

interface Project extends EditableProject {
  id: string;
  name: string;
  path: string;
  is_default: boolean;
  /** Backend-computed: the folder no longer exists on disk. */
  path_missing?: boolean;
  path_replaced?: boolean;
  location_state?: string;
  location_revision?: number;
  migration_error?: string;
  session_count: number;
  unarchived_session_count?: number;
  session_ids?: string[];
  custom_name?: boolean;
  status: string;
}

export type ProjectTab = "chats" | "memory" | "settings" | "info";
const PROJECT_TABS: ProjectTab[] = ["chats", "memory", "settings", "info"];

function tabParam(value: string | null | undefined): ProjectTab | null {
  return PROJECT_TABS.find((tab) => tab === value) ?? null;
}

function cls(...xs: (string | false | undefined)[]) {
  return xs.filter(Boolean).join(" ");
}

/** The home project leads; the rest keep the registry's order. */
function systemFirst(projects: Project[]): Project[] {
  return [...projects].sort((a, b) => Number(b.is_default) - Number(a.is_default));
}

export function ProjectsPage({
  embedded,
  query: queryProp,
  initialTab = "chats",
}: {
  embedded?: boolean;
  query?: string;
  initialTab?: ProjectTab;
} = {}) {
  const { text } = useTranslation();
  const params = useSearchParams();
  const requestedProject = params?.get("project");
  const requestedTab = tabParam(params?.get("tab"));
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<ProjectTab>(requestedTab ?? initialTab);
  const conversations = useSessionStore((state) => state.conversations);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [localQuery, setLocalQuery] = useState("");
  const { pickFolder, folderPickerDialog } = useFolderPicker();
  const query = queryProp !== undefined ? queryProp : localQuery;
  const setQuery = setLocalQuery;

  const refresh = useCallback(async () => {
    for (let i = 0; i < 10; i++) {
      const data = await wsRequest<{ projects: Project[] }>(
        "list_projects", {}, "projects_list",
      );
      if (data) {
        const list = systemFirst(data.projects || []);
        setProjects(list);
        setSelectedId((cur) => cur ?? (list[0]?.id ?? null));
        setLoaded(true);
        return;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    setError(text("Could not load projects", "无法加载项目"));
  }, [text]);

  useEffect(() => {
    function onChanged() { refresh(); }
    window.addEventListener("project-changed", onChanged);
    refresh();
    return () => window.removeEventListener("project-changed", onChanged);
  }, [refresh]);

  useEffect(() => { if (requestedProject) setSelectedId(requestedProject); }, [requestedProject]);
  useEffect(() => { setTab(initialTab); }, [initialTab]);

  const selected = useMemo(
    () => projects.find((p) => p.id === selectedId) || null,
    [projects, selectedId],
  );

  // A chat belongs to the first bound project that lists it; a chat no
  // project claims is the home project's, as on the server.
  const owner = useMemo(() => {
    const map = new Map<string, string>();
    for (const project of projects) {
      if (project.is_default) continue;
      for (const sessionId of project.session_ids || []) {
        if (!map.has(sessionId)) map.set(sessionId, project.id);
      }
    }
    return map;
  }, [projects]);
  const systemId = useMemo(() => projects.find((p) => p.is_default)?.id ?? null, [projects]);
  const projectOf = useCallback(
    (conv: ConvSummary) => owner.get(conv.id) ?? systemId, [owner, systemId],
  );
  const includeSelected = useCallback(
    (conv: ConvSummary) => projectOf(conv) === selectedId, [projectOf, selectedId],
  );
  const chatCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const conv of Object.values(conversations) as ConvSummary[]) {
      if (conv.archived) continue;
      const projectId = projectOf(conv);
      if (projectId) counts.set(projectId, (counts.get(projectId) ?? 0) + 1);
    }
    return counts;
  }, [conversations, projectOf]);

  const label = useCallback((project: Project) => projectName(project), []);

  // 定位缺失项目的新目录：改项目 path、保留 id（relocate_project）。
  const locateProject = useCallback(async (projectId: string, startPath = "") => {
    setError(null);
    try {
      const path = await pickFolder(startPath);
      if (!path) return;
      const current = projects.find((project) => project.id === projectId);
      const d = await wsRequest<{ ok: boolean; error?: string | null }>(
        "relocate_project",
        {
          project_id: projectId,
          path,
          expected_path: current?.path || startPath,
          expected_revision: current?.location_revision,
          replace_identity: true,
        },
        "project_relocated",
      );
      if (d && !d.ok) setError(d.error || text("Could not relocate the project.", "重新定位项目失败。"));
      refresh();
    } catch (e) {
      setError(String(e));
    }
  }, [pickFolder, refresh, text]);

  const addProject = useCallback(async () => {
    setError(null);
    try {
      const path = await pickFolder();
      if (!path) return;
      const d = await wsRequest<{ ok: boolean; project?: Project; error?: string }>(
        "create_project", { path }, "project_created",
      );
      if (d?.error) setError(d.error);
      if (d?.project) setSelectedId(d.project.id);
      refresh();
    } catch (e) {
      setError(String(e));
    }
  }, [pickFolder, refresh]);

  // Arrow/Home/End keyboard model shared with ManageSubnav.
  function moveProjectTab(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % PROJECT_TABS.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + PROJECT_TABS.length) % PROJECT_TABS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = PROJECT_TABS.length - 1;
    else return;
    event.preventDefault();
    setTab(PROJECT_TABS[next]);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button[role=tab]")[next]?.focus();
  }

  const view = (
      <div className={fx.view} style={embedded ? { flex: 1, minHeight: 0, height: "auto" } : undefined}>
        {folderPickerDialog}
        {editing && selected && <ProjectEditor key={selected.id} project={selected} onClose={()=>setEditing(false)} onSaved={updated=>setProjects(items=>items.map(item=>item.id===updated.id?{...item,...updated}:item))}/>}
        {(!embedded || queryProp === undefined) && (
          <div className={fx.topbar}>
            {!embedded && <span className={fx.title}>{text("Projects", "项目")}</span>}
            {queryProp === undefined && (
              <div className={fx.toolbar}>
                <SearchInput
                  className="flex-1 max-w-[320px]"
                  placeholder={text("Search this project...", "搜索这个项目...")}
                  value={query}
                  onChange={setQuery}
                />
              </div>
            )}
          </div>
        )}

        {error && <div className={shared.errorBar} role="alert">{error}</div>}

        <div className={cls(fx.body, styles.body)}>
          {/* 左栏：项目列表（复用 Functions 的 profilesNav） */}
          <div className={cls(fx.profilesNav, styles.rail)}>
            {projects.map((p) => (
              <button
                type="button"
                key={p.id}
                className={cls(fx.profileItem, styles.railItem, p.id === selectedId && fx.active, p.id === selectedId && styles.railItemActive)}
                aria-current={p.id === selectedId ? "true" : undefined}
                onClick={() => setSelectedId(p.id)}
              >
                <span className={fx.profileIcon}>{p.icon || (p.is_default ? <EarthIcon size={16} /> : <FoldersIcon size={16} />)}</span>
                <span className={fx.profileName}>{label(p)}</span>
                {p.hidden && <span className={shared.badge}>{text("Hidden", "已隐藏")}</span>}
                {(p.path_missing || p.path_replaced ||
                  ["missing", "replaced", "migrating", "pending", "error"].includes(p.location_state ?? "")) ? (
                  <AlertTriangle
                    size={14}
                    strokeWidth={2}
                    className={styles.statusSlot}
                    aria-label={text("Folder missing", "目录缺失")}
                  />
                ) : (
                  <span className={styles.statusSlotPad} aria-hidden="true" />
                )}
              </button>
            ))}
            <div className={fx.profileSep} />
            <button
              type="button"
              className={cls(fx.profileItem, styles.railItem, styles.addRow)}
              onClick={addProject}
            >
              <span className={fx.profileIcon}><FolderPlusIcon size={16} /></span>
              <span className={fx.profileName}>{text("Add project folder…", "添加项目文件夹…")}</span>
            </button>
          </div>

          {/* 右栏：选中项目的内容 */}
          <div className={cls(fx.content, styles.content, selected && (tab === "chats" || tab === "memory") ? styles.contentFill : undefined)}>
            {!selected && !loaded ? (
              <div className={shared.empty}>{text("Loading…", "加载中…")}</div>
            ) : !selected ? (
              <ManageEmptyState
                compact
                icon={<FoldersIcon size={20} />}
                title={projects.length ? text("Select a project", "选择一个项目") : text("No projects yet", "还没有项目")}
                description={text("A project is a folder on disk. Its chats, default settings and permission rules travel with it.", "项目对应磁盘上的一个文件夹，其会话、默认设置和权限规则随项目保存。")}
                action={projects.length ? undefined : <Button onClick={addProject}><FolderPlusIcon size={16} aria-hidden />{text("Add project folder…", "添加项目文件夹…")}</Button>}
              />
            ) : (
              <>
                <div className={styles.detailHead}>
                  <span className={styles.detailIcon} aria-hidden="true">{selected.icon || (selected.is_default ? <EarthIcon size={20} /> : <FoldersIcon size={20} />)}</span>
                  <div className={styles.detailHeading}>
                    <h2 className={styles.detailTitle}>{label(selected)}</h2>
                    {selected.is_default ? (
                      <span className={styles.detailNote}>
                        {text("Chats outside any project, and the personal memory every project reads.", "不属于任何项目的会话，以及每个项目都会读的个人记忆。")}
                      </span>
                    ) : (
                      <span className={styles.detailPath}>{selected.path}</span>
                    )}
                  </div>
                  {selected.hidden&&<Button variant="outline" onClick={async()=>{try{const result=await wsRequest<{ok:boolean;error?:string}>("restore_project",{project_id:selected.id},"restore_project_result");if(!result?.ok)throw new Error(result?.error||text("Could not restore project", "无法恢复项目"));await refresh();window.dispatchEvent(new Event("project-changed"));}catch(err){setError(err instanceof Error?err.message:String(err));}}}>{text("Restore to sidebar", "恢复到侧边栏")}</Button>}
                  {!selected.is_default && <Button variant="outline" onClick={()=>setEditing(true)}>{text("Edit project", "编辑项目")}</Button>}
                </div>
                {(selected.path_missing || selected.path_replaced || (selected.location_state && selected.location_state !== "available")) && (
                  <div
                    role="alert"
                    style={{
                      display: "flex", alignItems: "center", gap: 8,
                      margin: "8px 0", fontSize: 12,
                      color: "var(--accent-orange)",
                    }}
                  >
                    <AlertTriangle size={14} strokeWidth={2} aria-hidden="true" />
                    <span>
                      {selected.path_replaced || selected.location_state === "replaced"
                        ? text(
                            "The folder at this location has changed.",
                            "该位置上的文件夹已更换。",
                          )
                        : selected.location_state === "migrating"
                          ? text(
                              "Migrating conversations. Tasks start after completion.",
                              "正在迁移对话。完成前不能启动任务。",
                            )
                            : selected.location_state === "pending" &&
                                selected.migration_error !== "directory identity unavailable"
                              ? text(
                                  "This legacy conversation has not migrated. Reconnect the original drive to finish.",
                                  "这条旧对话尚未迁移。请接回原来的磁盘后再完成。",
                                )
                              : selected.location_state === "pending"
                                ? text(
                                    "This folder needs confirmation. Locate the original folder to continue.",
                                    "该目录需要确认。请定位原来的目录后继续。",
                                  )
                            : selected.location_state === "error"
                              ? text(
                                  selected.migration_error || "Conversation migration failed.",
                                  selected.migration_error || "对话迁移失败。",
                                )
                              : text(
                                  "This folder no longer exists on disk.",
                                  "该目录已不在磁盘上。",
                                )}
                    </span>
                    <button
                      type="button"
                      onClick={() => locateProject(selected.id, selected.path)}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 4,
                        cursor: "pointer", background: "none",
                        border: "1px solid var(--accent-orange)",
                        borderRadius: 6, padding: "2px 8px",
                        color: "var(--accent-orange)", fontSize: 12,
                      }}
                    >
                      <FolderSearch size={13} strokeWidth={2} aria-hidden="true" />
                      {text("Locate folder…", "定位文件夹…")}
                    </button>
                  </div>
                )}

                <div className={styles.tabs} role="tablist" aria-label={text("Project sections", "项目分区")}>
                  {PROJECT_TABS.map((tk, index) => (
                    <button
                      key={tk}
                      type="button"
                      role="tab"
                      id={`project-tab-${tk}`}
                      aria-selected={tab === tk}
                      aria-controls="project-tabpanel"
                      tabIndex={tab === tk ? 0 : -1}
                      onClick={() => setTab(tk)}
                      onKeyDown={(event) => moveProjectTab(event, index)}
                      className={cls(styles.tab, tab === tk && styles.tabActive)}
                    >
                      {tk === "chats"
                        ? <>{text("Chats", "会话")} <span className={shared.tabCount}>{chatCounts.get(selected.id) ?? 0}</span></>
                        : tk === "memory"
                          ? text("Memory", "记忆")
                          : tk === "settings"
                            ? text("Settings", "设置")
                            : text("Info", "信息")}
                    </button>
                  ))}
                </div>

                <div
                  id="project-tabpanel"
                  role="tabpanel"
                  aria-labelledby={`project-tab-${tab}`}
                  className={tab === "chats" || tab === "memory" ? styles.panelFill : undefined}
                >
                {tab === "chats" && (
                  <ChatsPage
                    key={selected.id}
                    embedded
                    rail={false}
                    query={query}
                    include={includeSelected}
                  />
                )}

                {tab === "memory" && (
                  <MemoryPage
                    key={selected.id}
                    embedded
                    query={query}
                    projectId={selected.is_default ? null : selected.id}
                  />
                )}

                {tab === "settings" && (
                  <div className={styles.tabBody}>
                    <div className={styles.sectionTitle}>{text("Default Settings", "默认设置")}</div>
                    <ProjectConfigSection projectId={selected.id} />
                    <div className={styles.sectionTitle} style={{ marginTop: 28 }}>
                      {text("Permission Rules", "权限规则")}
                    </div>
                    <PermissionsSection projectId={selected.id} />
                  </div>
                )}

                {tab === "info" && (
                  <dl className={cls(styles.tabBody, styles.fields)}>
                    <Field label={text("Type", "类型")}>
                      {selected.is_default ? text("System (global)", "系统（全局）") : text("Project folder", "项目文件夹")}
                    </Field>
                    <Field label={selected.is_default ? text("Working folder", "工作目录") : text("Path", "路径")}><code>{selected.path}</code></Field>
                    <Field label={text("Stored in", "存放位置")}><code>{`~/.openprogram/projects/${selected.id}/`}</code></Field>
                    <Field label={text("Status", "状态")}>
                      {({ active: text("Active", "进行中"), paused: text("Paused", "已暂停"), done: text("Done", "已完成") } as Record<string, string>)[selected.status] ?? selected.status}
                    </Field>
                    <Field label={text("Chats", "会话数")}>{chatCounts.get(selected.id) ?? 0}</Field>
                    <Field label="ID"><code>{selected.id}</code></Field>
                  </dl>
                )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
  );

  if (embedded) return view;
  return <div className="main">{view}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.field}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
