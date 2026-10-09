"use client";

/**
 * GitChip — the per-folder git pill in the composer's environment row.
 *
 * Sits right after its folder chip (the project chip, or one working
 * folder chip) when that folder is inside a Git checkout. The pill shows
 * the branch and the uncommitted line counts; its menu:
 *
 *   * opens the uncommitted changes in Review (workspace scope),
 *   * switches or creates a branch in place,
 *   * moves the folder onto another worktree, or creates a new one
 *     beside the repository (`onUseFolder` decides what "use" means:
 *     a draft re-points its project, a working folder is replaced; a
 *     frozen main folder adds the worktree as an extra working folder),
 *   * creates a pull request with `gh` (push + `gh pr create --fill`),
 *     or hands "commit and open a PR" to the agent when there are
 *     uncommitted changes, or opens the branch's existing PR.
 *
 * State is read on demand — on mount, when the menu opens, when a turn
 * ends, when the window regains focus and after any pill's mutation —
 * never polled. Folders sharing one checkout show a single pill
 * (git-chip-registry).
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { SolarIcon } from "@/components/solar-icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { HoverTip } from "@/components/ui/tooltip";
import { buttonVariants } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n";
import { wsRequest } from "@/lib/net/ws-request";
import { closeAllPopovers } from "@/lib/runtime-bridge/ui";
import { useSessionStore } from "@/lib/session-store";
import { useCenterTabs } from "@/lib/tabs/center-tabs-store";
import { desktopBridge } from "@/lib/desktop/bridge-api";
import { cn } from "@/lib/utils";
import { useBoundChat } from "./bound-chat";
import { notifyGitChanged, useGitRepoClaim } from "./git-chip-registry";
import { CHECK_SLOT, CHECK_SLOT_PAD, GROUP_LABEL, MENU_PANEL, MENU_SEPARATOR, itemCls } from "./menu-styles";

export interface GitWorktree {
  path: string;
  branch: string | null;
  detached: boolean;
  is_main: boolean;
  is_current: boolean;
}

export interface GitFolderStatus {
  path: string;
  is_repo: boolean;
  error?: string;
  root?: string;
  repo_name?: string;
  branch?: string | null;
  head?: string | null;
  upstream?: string | null;
  ahead?: number;
  behind?: number;
  changes?: { files: number; untracked: number; conflicts: number; insertions: number; deletions: number };
  is_worktree?: boolean;
  worktrees?: GitWorktree[];
  default_branch?: string | null;
  has_remote?: boolean;
  gh_available?: boolean;
  branches?: string[];
  pr?: { number?: number; url: string; state?: string; title?: string; isDraft?: boolean } | null;
}

function baseName(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function openUrl(url: string) {
  const bridge = desktopBridge();
  if (bridge) bridge.openExternal(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}

export function GitChip({
  path,
  order,
  onUseFolder,
  useFolderLabel,
}: {
  /** The folder this pill describes; null renders nothing. */
  path: string | null;
  /** Claim order among pills on one checkout: project 0, working folders 1+. */
  order: number;
  /** Move this folder slot onto another worktree path. */
  onUseFolder?: (path: string) => void | Promise<void>;
  /** Menu wording for onUseFolder (e.g. "Add as working folder"). */
  useFolderLabel?: { en: string; zh: string };
}) {
  const { text } = useTranslation();
  const id = useId();
  const { sessionId, chatKey } = useBoundChat();
  const openReviewTab = useCenterTabs((s) => s.openReviewTab);
  const running = useSessionStore((s) => (sessionId ? Boolean(s.runningTasks?.[sessionId]) : false));
  const [status, setStatus] = useState<GitFolderStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const generation = useRef(0);

  const refresh = useCallback(async (full = false) => {
    if (!path) return;
    const mine = ++generation.current;
    const data = await wsRequest<{ path: string; status: GitFolderStatus }>(
      "git_folder_status",
      { path, include_branches: full, include_pr: full },
      "git_folder_status",
      (d) => d.path === path,
      full ? 15000 : 6000,
    );
    if (mine !== generation.current || !data?.status) return;
    setStatus((prev) => (
      !full && prev?.root === data.status.root
        ? { ...data.status, branches: prev?.branches, pr: prev?.pr }
        : data.status
    ));
  }, [path]);

  useEffect(() => {
    setStatus(null);
    void refresh();
  }, [refresh]);

  // A turn just ended: the agent may have edited, committed or switched.
  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current && !running) void refresh();
    wasRunning.current = running;
  }, [running, refresh]);

  useEffect(() => {
    const onChanged = (event: Event) => {
      const root = (event as CustomEvent<{ root?: string | null }>).detail?.root;
      if (!root || root === status?.root) void refresh(open);
    };
    const onFocus = () => void refresh(open);
    const onProject = () => void refresh();
    window.addEventListener("op:git-changed", onChanged);
    window.addEventListener("focus", onFocus);
    window.addEventListener("project-changed", onProject);
    return () => {
      window.removeEventListener("op:git-changed", onChanged);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("project-changed", onProject);
    };
  }, [refresh, open, status?.root]);

  useEffect(() => {
    const close = () => setOpen(false);
    window.addEventListener("topbar-close-menus", close);
    return () => window.removeEventListener("topbar-close-menus", close);
  }, []);

  const visible = useGitRepoClaim(id, status?.is_repo ? status.root ?? null : null, order);

  function onOpenChange(next: boolean) {
    if (next) {
      window.dispatchEvent(new Event("topbar-close-menus"));
      closeAllPopovers();
      setError(null);
      setQuery("");
      void refresh(true);
    }
    setOpen(next);
  }

  async function run<T extends { ok: boolean; error?: string | null }>(
    label: string,
    action: string,
    payload: Record<string, unknown>,
    responseType: string,
    timeoutMs: number,
  ): Promise<T | null> {
    setBusy(label);
    setError(null);
    const reply = await wsRequest<T & { path: string }>(
      action, { path, ...payload }, responseType, (d) => d.path === path, timeoutMs,
    );
    setBusy(null);
    if (!reply) {
      setError(text("No reply from the worker.", "后端没有响应。"));
      return null;
    }
    if (!reply.ok) {
      setError(reply.error || text("The git command failed.", "git 命令失败。"));
      return null;
    }
    return reply;
  }

  async function switchBranch(branch: string, create: boolean) {
    const reply = await run<{ ok: boolean; error?: string; status?: GitFolderStatus }>(
      create ? "create" : branch, "git_switch_branch", { branch, create }, "git_switch_branch_result", 60000,
    );
    if (reply?.status) {
      setStatus((prev) => ({ ...reply.status!, pr: undefined, branches: reply.status!.branches ?? prev?.branches }));
      setQuery("");
      notifyGitChanged(reply.status.root);
      void refresh(true);
    }
  }

  async function createWorktree(branch: string) {
    const reply = await run<{ ok: boolean; error?: string; worktree?: GitFolderStatus }>(
      "worktree", "git_create_worktree", { branch }, "git_worktree_created", 120000,
    );
    if (reply?.worktree?.path) {
      notifyGitChanged(status?.root);
      await moveToFolder(reply.worktree.path);
    }
  }

  async function moveToFolder(target: string) {
    if (!onUseFolder) return;
    setBusy("use");
    try {
      await onUseFolder(target);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setBusy(null);
  }

  async function createPr() {
    const reply = await run<{ ok: boolean; error?: string; url?: string }>(
      "pr", "git_create_pr", {}, "git_pr_created", 180000,
    );
    if (reply?.url) {
      openUrl(reply.url);
      void refresh(true);
    }
  }

  function askAgentForPr() {
    const store = useSessionStore.getState();
    const where = status?.repo_name ? ` in ${status.repo_name}` : "";
    store.setComposerInputFor(
      chatKey ?? store.activeChatKey,
      text(
        `Commit the current changes${where} on a feature branch with a clear message, push it, and open a pull request with gh.`,
        `把${status?.repo_name ? ` ${status.repo_name} 中` : ""}当前的修改提交到一个功能分支（写清楚提交信息），推送后用 gh 创建 pull request。`,
      ),
    );
    store.focusComposer();
    setOpen(false);
  }

  const allBranches = status?.branches ?? (status?.branch ? [status.branch] : []);
  const needle = query.trim().toLowerCase();
  const branches = needle ? allBranches.filter((b) => b.toLowerCase().includes(needle)) : allBranches;

  if (!path || !status?.is_repo || !visible) return null;

  const changes = status.changes ?? { files: 0, untracked: 0, conflicts: 0, insertions: 0, deletions: 0 };
  const branchLabel = status.branch ?? status.head ?? text("detached", "游离");
  const typed = query.trim();
  const typedExists = Boolean(typed) && (status.branches ?? []).includes(typed);
  const worktreeByBranch = new Map(
    (status.worktrees ?? []).filter((w) => w.branch && !w.is_current).map((w) => [w.branch!, w]),
  );
  const otherWorktrees = (status.worktrees ?? []).filter((w) => !w.is_current);
  const prBlocked = !status.gh_available
    ? text("Install and sign in to the GitHub CLI (gh) to create pull requests.", "安装并登录 GitHub CLI（gh）后才能创建 PR。")
    : !status.has_remote
      ? text("This repository has no origin remote.", "此仓库没有 origin 远端。")
      : !status.branch
        ? text("Check out a branch first.", "先切换到一个分支。")
        : status.branch === status.default_branch
          ? text(`Switch to a feature branch; you're on ${status.default_branch}.`, `当前在 ${status.default_branch}，请先切到功能分支。`)
          : null;
  const openPr = status.pr && String(status.pr.state ?? "").toUpperCase() === "OPEN" ? status.pr : null;
  const tip = `${status.repo_name ?? baseName(path)} · ${branchLabel}${changes.files ? ` · ${text(`${changes.files} changed`, `${changes.files} 个修改`)}` : ""}`;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <HoverTip label={tip}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(buttonVariants({ variant: "elevated", size: "sm" }), "runtime-badge git-badge", status.is_worktree && "git-badge-worktree")}
            aria-label={text(`Git: ${branchLabel}`, `Git：${branchLabel}`)}
          >
            <SolarIcon name="git-branch" size={14} className="git-icon" />
            <span className="badge-short">{branchLabel}</span>
            {changes.insertions || changes.deletions ? (
              <span className="git-badge-counts">
                <span className="is-add">+{changes.insertions}</span>
                <span className="is-del">−{changes.deletions}</span>
              </span>
            ) : changes.files ? (
              <span className="git-badge-counts"><span>{changes.files}</span></span>
            ) : null}
          </button>
        </PopoverTrigger>
      </HoverTip>
      <PopoverContent side="top" align="start" sideOffset={10} className="w-auto border-0 bg-transparent p-0 shadow-none">
        <div className={`${MENU_PANEL} git-menu min-w-[270px] max-w-[360px]`}>
          <div className={GROUP_LABEL}>
            <span className="min-w-0 flex-1 truncate">{status.repo_name}</span>
            {status.is_worktree ? <span className="git-menu-tag">{text("worktree", "worktree")}</span> : null}
          </div>

          {changes.files ? (
            <div
              className={itemCls(false)}
              title={sessionId ? undefined : text("Send a message first to review changes.", "发送消息后才能审阅修改。")}
              onClick={() => sessionId && (openReviewTab(sessionId, undefined, "workspace"), setOpen(false))}
            >
              <SolarIcon name="file-text" size={14} className="opacity-70" />
              <span className="min-w-0 flex-1 truncate">
                {text(`${changes.files} uncommitted ${changes.files === 1 ? "file" : "files"}`, `${changes.files} 个未提交文件`)}
              </span>
              <span className="git-menu-stat is-add">+{changes.insertions}</span>
              <span className="git-menu-stat is-del">−{changes.deletions}</span>
            </div>
          ) : (
            <div className="git-menu-note">{text("No uncommitted changes", "没有未提交的修改")}</div>
          )}
          {status.upstream && (status.ahead || status.behind) ? (
            <div className="git-menu-note">
              {text(`${status.ahead} ahead, ${status.behind} behind ${status.upstream}`, `比 ${status.upstream} 领先 ${status.ahead}、落后 ${status.behind}`)}
            </div>
          ) : null}

          <div className={MENU_SEPARATOR} />
          <div className={GROUP_LABEL}>{text("Branch", "分支")}</div>
          <input
            className="git-menu-input"
            value={query}
            placeholder={text("Find or create a branch…", "查找或新建分支…")}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && typed && !busy) {
                e.preventDefault();
                void switchBranch(typed, !typedExists);
              }
            }}
            spellCheck={false}
            autoComplete="off"
          />
          <div className="git-menu-branches">
            {branches.slice(0, 40).map((b) => {
              const elsewhere = worktreeByBranch.get(b);
              const current = b === status.branch;
              return (
                <div
                  key={b}
                  className={itemCls(false)}
                  title={elsewhere ? text(`Checked out in ${elsewhere.path}`, `已在 ${elsewhere.path} 检出`) : b}
                  onClick={() => {
                    if (busy || current) return;
                    if (elsewhere) void moveToFolder(elsewhere.path);
                    else void switchBranch(b, false);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">{b}</span>
                  {elsewhere ? <span className="git-menu-tag">{text("worktree", "worktree")}</span> : null}
                  {current ? (
                    <SolarIcon motionPreset="none" name="check-circle" size={14} className={CHECK_SLOT} />
                  ) : (
                    <span className={CHECK_SLOT_PAD} aria-hidden="true" />
                  )}
                </div>
              );
            })}
            {status.branches === undefined ? (
              <div className="git-menu-note">{text("Loading branches…", "正在读取分支…")}</div>
            ) : null}
          </div>
          {typed && !typedExists ? (
            <div className={itemCls(false)} onClick={() => !busy && void switchBranch(typed, true)}>
              <SolarIcon name="add-circle" size={14} className="opacity-70" />
              <span className="min-w-0 flex-1 truncate">{text(`Create branch “${typed}”`, `新建分支“${typed}”`)}</span>
            </div>
          ) : null}

          <div className={MENU_SEPARATOR} />
          <div className={GROUP_LABEL}>{text("Work in", "工作位置")}</div>
          <div className={itemCls(false)} title={status.root}>
            <SolarIcon name={status.is_worktree ? "folder-path-connect" : "folder-open"} size={14} className="opacity-70" />
            <span className="min-w-0 flex-1 truncate">
              {status.is_worktree ? baseName(status.root ?? path) : text("Local checkout", "本地仓库")}
            </span>
            <SolarIcon motionPreset="none" name="check-circle" size={14} className={CHECK_SLOT} />
          </div>
          {onUseFolder ? otherWorktrees.map((w) => (
            <div key={w.path} className={itemCls(false)} title={w.path} onClick={() => !busy && void moveToFolder(w.path)}>
              <SolarIcon name={w.is_main ? "folder-open" : "folder-path-connect"} size={14} className="opacity-70" />
              <span className="min-w-0 flex-1 truncate">
                {w.is_main ? text("Local checkout", "本地仓库") : baseName(w.path)}
                {w.branch ? <span className="git-menu-dim"> · {w.branch}</span> : null}
              </span>
              <span className={CHECK_SLOT_PAD} aria-hidden="true" />
            </div>
          )) : null}
          {onUseFolder ? (
            <div
              className={itemCls(false)}
              title={text(
                "Creates a branch in a new folder beside the repository; this folder's files stay as they are.",
                "在仓库旁边的新目录里建一个分支；当前目录的文件保持不动。",
              )}
              onClick={() => {
                if (busy) return;
                if (typed) void createWorktree(typed);
                else setError(text("Type a branch name above, then choose New worktree.", "先在上面输入分支名，再点新建 worktree。"));
              }}
            >
              <SolarIcon name="add-circle" size={14} className="opacity-70" />
              <span className="min-w-0 flex-1 truncate">
                {typed ? text(`New worktree on “${typed}”`, `在“${typed}”上新建 worktree`) : text("New worktree…", "新建 worktree…")}
              </span>
            </div>
          ) : null}
          {onUseFolder && useFolderLabel ? (
            <div className="git-menu-note">{text(useFolderLabel.en, useFolderLabel.zh)}</div>
          ) : null}

          <div className={MENU_SEPARATOR} />
          {openPr ? (
            <div className={itemCls(false)} title={openPr.title} onClick={() => openUrl(openPr.url)}>
              <SolarIcon name="square-arrow-right-up" size={14} className="opacity-70" />
              <span className="min-w-0 flex-1 truncate">
                {text(`View pull request #${openPr.number ?? ""}`, `查看 PR #${openPr.number ?? ""}`)}
              </span>
            </div>
          ) : (
            <div
              className={cn(itemCls(false), prBlocked && "pointer-events-auto cursor-default opacity-50")}
              title={prBlocked ?? text("Pushes this branch and opens a PR from its commits.", "推送当前分支，并用它的提交创建 PR。")}
              onClick={() => !prBlocked && !busy && void createPr()}
            >
              <SolarIcon name="git-pull-request" size={14} className="opacity-70" />
              <span className="min-w-0 flex-1 truncate">{text("Create pull request", "创建 PR")}</span>
            </div>
          )}
          {changes.files && !openPr ? (
            <div className={itemCls(false)} onClick={askAgentForPr}>
              <SolarIcon name="chat-round-dots" size={14} className="opacity-70" />
              <span className="min-w-0 flex-1 truncate">{text("Commit & open PR with the agent…", "让 agent 提交并创建 PR…")}</span>
            </div>
          ) : null}
          {prBlocked && !openPr ? <div className="git-menu-note">{prBlocked}</div> : null}

          {busy ? <div className="git-menu-note">{text("Working…", "处理中…")}</div> : null}
          {error ? <div className="git-menu-error" role="alert">{error}</div> : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
