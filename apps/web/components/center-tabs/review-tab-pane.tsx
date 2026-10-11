"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { FileTypeIcon } from "@/components/files/file-type-icon";
import { FileViewer } from "@/components/files/file-viewer";

import { FeatherIcon } from "@/components/animated-icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CHECK_SLOT,
  CHECK_SLOT_PAD,
  MENU_ITEM_STATES,
  MENU_PANEL,
  MENU_SEPARATOR,
  itemCls,
} from "@/components/chat/top-bar/menu-styles";
import { useTranslation } from "@/lib/i18n";
import { ReviewDiff } from "./review-diff";
import { canPreview } from "./review-diff-rows.ts";
import styles from "./review-tab-pane.module.css";

import type {
  DiffState,
  LinkedImpact,
  ReviewCategory,
  ReviewFile,
  ReviewScope,
  ReviewSort,
  ScopeState,
} from "./review-tab-types";
import { requestReviewScope } from "./use-review-scope";
import { requestReviewDiff } from "./use-review-diff";

export function ReviewTabPane({
  sessionId,
  assistantMsgId,
  initialScope = "turn",
  initialPath,
}: {
  sessionId: string;
  assistantMsgId?: string;
  initialScope?: ReviewScope;
  initialPath?: string;
}) {
  const { text } = useTranslation();
  const [scope, setScope] = useState<ReviewScope>(initialScope);
  const [selectedPath, setSelectedPath] = useState(initialPath ?? "");
  const [fileCursor, setFileCursor] = useState<string | null>(null);
  const [diffCursor, setDiffCursor] = useState<string | null>(null);
  const [diffHistory, setDiffHistory] = useState<string[]>([]);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [category, setCategory] = useState<ReviewCategory>("All");
  // Documents and images can be read rendered; the choice carries over
  // to the next file that supports it.
  const [view, setView] = useState<"changes" | "preview">("changes");
  // The protocol supports query/sort, but this pane currently keeps the
  // default values without adding controls to the existing toolbar layout.
  const query = "";
  const sort: ReviewSort = "path";
  const staleRecoveryRef = useRef<string | null>(null);
  const diffCursorRecoveryRef = useRef<string | null>(null);
  const [scopeState, setScopeState] = useState<ScopeState>({
    loading: true,
    status: "loading",
    files: [],
    file_count: 0,
    added: null,
    removed: null,
    linked_impacts: [],
  });
  const [diffState, setDiffState] = useState<DiffState>({ loading: false });

  const clearReviewForStale = useCallback(() => {
    setSelectedPath("");
    setFileCursor(null);
    setDiffCursor(null);
    setDiffHistory([]);
    setDiffState({ loading: false });
    setScopeState((current) => ({
      ...current,
      loading: true,
      status: "loading",
      files: [],
      file_count: 0,
      added: null,
      removed: null,
      snapshot_id: undefined,
      cursor: null,
      next_cursor: null,
      prev_cursor: null,
      page: undefined,
      error: undefined,
    }));
  }, []);

  useEffect(() => {
    staleRecoveryRef.current = null;
    diffCursorRecoveryRef.current = null;
    setScope(initialScope);
    setSelectedPath(initialPath ?? "");
    setFileCursor(null);
    setDiffCursor(null);
    setDiffHistory([]);
    setScopeState((current) => ({ ...current, snapshot_id: undefined }));
  }, [initialScope, initialPath, sessionId, assistantMsgId]);

  useEffect(() => {
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent).detail ?? {};
      if (detail.sessionId === sessionId) {
        staleRecoveryRef.current = null;
        setRefreshNonce((value) => value + 1);
      }
    };
    window.addEventListener("turn-files-history-changed", refresh);
    return () => window.removeEventListener("turn-files-history-changed", refresh);
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || (scope === "turn" && !assistantMsgId)) {
      setScopeState({
        loading: false,
        status: "error",
        files: [],
        file_count: 0,
        added: null,
        removed: null,
        linked_impacts: [],
        error: text("Review source is unavailable", "审阅来源不可用"),
      });
      return;
    }
    setScopeState((current) => ({ ...current, loading: true, error: undefined }));
    const controller = new AbortController();
    void (async () => {
const data = await requestReviewScope({
        sessionId,
        assistantMsgId,
        scope,
        category,
        query,
        sort,
        cursor: fileCursor,
        snapshotId: scopeState.snapshot_id,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (!data) {
        setScopeState((current) => ({
          ...current,
          loading: false,
          status: "error",
          error: text("Review request disconnected", "审阅请求连接已断开"),
          category,
          query,
          sort,
        }));
        return;
      }
      const stale = data.status === "stale" || data.error === "STALE_SNAPSHOT";
      if (stale) {
        const recoveryKey = `${scope}\u0000${category}\u0000${query}\u0000${sort}\u0000${fileCursor ?? ""}`;
        const retry = staleRecoveryRef.current !== recoveryKey;
        staleRecoveryRef.current = recoveryKey;
        clearReviewForStale();
        if (retry) {
          setRefreshNonce((value) => value + 1);
          return;
        }
        setScopeState((current) => ({
          ...current,
          loading: false,
          status: "stale",
          error: data.error ?? "STALE_SNAPSHOT",
        }));
        return;
      }
      const files: ReviewFile[] = data.files ?? [];
      setScopeState({
        loading: false,
        status: data.status ?? "error",
        source: data.source,
        files,
        file_count: data.file_count ?? files.length,
        added: data.added ?? null,
        removed: data.removed ?? null,
        snapshot_id: data.status === "ready" ? data.snapshot_id : undefined,
        cursor: data.cursor ?? null,
        next_cursor: data.next_cursor,
        prev_cursor: data.prev_cursor,
        page: data.page ?? 1,
        error: data.error as string | undefined,
        linked_impacts: (data.linked_impacts as LinkedImpact[] | undefined) ?? [],
        category: data.category as ReviewCategory | undefined,
        query: data.query as string | undefined,
        sort: data.sort as ReviewSort | undefined,
      });
      setSelectedPath((current) => {
        if (current && files.some((file) => file.path === current)) return current;
        return files[0]?.path ?? "";
      });
    })();
    return () => {
      controller.abort();
    };
  }, [assistantMsgId, category, clearReviewForStale, fileCursor, query, refreshNonce, scope, sessionId, sort, text]);

  useEffect(() => {
    if (!selectedPath || !scopeState.snapshot_id || scopeState.status !== "ready") {
      setDiffState({ loading: false });
      return;
    }
    setDiffState({ loading: true, path: selectedPath });
    const controller = new AbortController();
    const snapshotId = scopeState.snapshot_id;
    void (async () => {
      const data = await requestReviewDiff({
        sessionId,
        assistantMsgId,
        scope,
        category,
        query,
        sort,
        path: selectedPath,
        cursor: diffCursor,
        snapshotId,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (!data) {
        setDiffState({
          loading: false,
          path: selectedPath,
          error: text("Diff request disconnected", "差异请求连接已断开"),
        });
        return;
      }
      if (data.error === "STALE_SNAPSHOT") {
        const recoveryKey = `${scope}\u0000${category}\u0000${query}\u0000${sort}\u0000${selectedPath}\u0000${diffCursor ?? ""}`;
        const retry = staleRecoveryRef.current !== recoveryKey;
        staleRecoveryRef.current = recoveryKey;
        clearReviewForStale();
        if (retry) setRefreshNonce((value) => value + 1);
        else {
          setScopeState((current) => ({
            ...current,
            loading: false,
            status: "stale",
            error: data.error,
          }));
        }
        return;
      }
      if (data.error === "STALE_CURSOR") {
        const recoveryKey = `${scope}\u0000${category}\u0000${query}\u0000${sort}\u0000${selectedPath}`;
        const retry = diffCursorRecoveryRef.current !== recoveryKey;
        diffCursorRecoveryRef.current = recoveryKey;
        setDiffCursor(null);
        setDiffHistory([]);
        if (retry) {
          setDiffState({ loading: true, path: selectedPath });
        } else {
          setDiffState({ loading: false, path: selectedPath, error: data.error });
        }
        return;
      }
      diffCursorRecoveryRef.current = null;
      setDiffState({
        loading: false,
        path: selectedPath,
        diff: data.diff as string | undefined ?? "",
        diff_state: data.diff_state as string | undefined ?? "unavailable",
        cursor: data.cursor as string | null | undefined ?? null,
        next_cursor: data.next_cursor as string | null | undefined,
        prev_cursor: data.prev_cursor as string | null | undefined,
        line_count: data.line_count as number | undefined,
        error: data.error as string | undefined,
      });
    })();
    return () => {
      controller.abort();
    };
  }, [
    assistantMsgId,
    category,
    diffCursor,
    query,
    scope,
    scopeState.snapshot_id,
    selectedPath,
    sessionId,
    sort,
    text,
    clearReviewForStale,
  ]);

  const selected = useMemo(
    () => scopeState.files.find((file) => file.path === selectedPath),
    [scopeState.files, selectedPath],
  );
  const selectedIndex = scopeState.files.findIndex((file) => file.path === selectedPath);
  const previewable = selected ? canPreview(selected) : false;
  const showPreview = view === "preview" && previewable;
  const sourceLabel = scopeState.source === "git"
    ? "Git workspace"
    : text("Mutation journal", "修改日志");
  const categoryLabels: Record<ReviewCategory, string> = {
    All: text("All types", "全部类型"),
    Code: text("Code", "代码"),
    Tests: text("Tests", "测试"),
    Docs: text("Docs", "文档"),
    Large: text("Large", "大文件"),
  };

  const chooseScope = (value: ReviewScope) => {
    setScope(value);
    setSelectedPath("");
    setFileCursor(null);
    setDiffCursor(null);
    setDiffHistory([]);
    setScopeState((current) => ({ ...current, snapshot_id: undefined }));
  };
  const chooseCategory = (value: ReviewCategory) => {
    setCategory(value);
    staleRecoveryRef.current = null;
    setSelectedPath("");
    setFileCursor(null);
    setDiffCursor(null);
    setDiffHistory([]);
    setScopeState((current) => ({ ...current, snapshot_id: undefined }));
  };
  const chooseFile = (path: string) => {
    setSelectedPath(path);
    setDiffCursor(null);
    setDiffHistory([]);
  };
  const filePages = scopeState.prev_cursor != null || scopeState.next_cursor != null;
  const diffPages = Boolean(selectedPath) && !showPreview
    && (diffHistory.length > 0 || diffState.next_cursor != null);

  return (
    <div className={styles.page} data-testid="review-tab-pane">
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <span className={styles.logo} aria-hidden="true"><FeatherIcon size={16} /></span>
          <h1>{text("Review", "审阅")}</h1>
          <span className={styles.source}>{sourceLabel}</span>
          {scopeState.linked_impacts.length ? (
            <span
              className={styles.linkedImpacts}
              title={scopeState.linked_impacts
                .map((impact) => `${impact.job_id ?? "actor"} · ${impact.status ?? impact.relation ?? "linked"}`)
                .join("\n")}
            >
              {text(
                `${scopeState.linked_impacts.length} linked`,
                `${scopeState.linked_impacts.length} 个关联任务`,
              )}
            </span>
          ) : null}
          <div className={styles.totals} aria-label={text("Change totals", "修改统计")}>
            <span>{text(`${scopeState.file_count} files`, `${scopeState.file_count} 个文件`)}</span>
            <i>+{scopeState.added ?? "—"}</i>
            <em>−{scopeState.removed ?? "—"}</em>
          </div>
        </div>
        <div className={styles.controlRow}>
          <div className={styles.scopeTabs} role="tablist" aria-label={text("Review scope", "审阅范围")}>
            {([
              ["turn", text("This turn", "本轮")],
              ["branch", text("Current branch", "当前分支")],
              ["workspace", text("Workspace", "工作区")],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={scope === value}
                className={scope === value ? styles.scopeActive : styles.scope}
                onClick={() => chooseScope(value)}
                disabled={value === "turn" && !assistantMsgId}
              >
                {label}
              </button>
            ))}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className={styles.menuButton} aria-label={text("File category", "文件分类")}>
                {categoryLabels[category]}
                <ChevronDown size={14} aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className={MENU_PANEL}>
              {(["All", "Code", "Tests", "Docs", "Large"] as const).map((value) => (
                <DropdownMenuItem
                  key={value}
                  className={`${itemCls(false)} ${MENU_ITEM_STATES}`}
                  onSelect={() => chooseCategory(value)}
                >
                  <span className="min-w-0 flex-1 truncate">{categoryLabels[value]}</span>
                  {category === value
                    ? <Check size={14} className={CHECK_SLOT} aria-hidden="true" />
                    : <span className={CHECK_SLOT_PAD} />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className={styles.body}>
        <aside className={styles.files} aria-label={text("Changed files", "修改的文件")}>
          {scopeState.loading ? (
            <div className={styles.empty}>{text("Loading files…", "正在加载文件…")}</div>
          ) : scopeState.error ? (
            <div className={styles.empty}>{scopeState.error}</div>
          ) : scopeState.files.length === 0 ? (
            <div className={styles.empty}>{text("No changes in this scope", "此范围没有修改")}</div>
          ) : scopeState.files.map((file) => (
            <button
              type="button"
              key={file.path}
              className={file.path === selectedPath ? styles.fileActive : styles.file}
              aria-current={file.path === selectedPath ? "true" : undefined}
              onClick={() => chooseFile(file.path)}
            >
              <FileTypeIcon name={file.path} />
              <span className={styles.fileText}>
                <span className={styles.fileName}>{fileName(file.rel)}</span>
                {fileFolder(file.rel) ? <span className={styles.fileFolder}>{fileFolder(file.rel)}</span> : null}
              </span>
              <span className={styles.counts}>
                <i>+{file.added ?? "—"}</i>
                <em>−{file.removed ?? "—"}</em>
              </span>
            </button>
          ))}
          {!scopeState.loading && filePages ? (
            <div className={styles.pagination}>
              <button
                type="button"
                disabled={scopeState.prev_cursor == null}
                onClick={() => setFileCursor(scopeState.prev_cursor ?? null)}
              >
                {text("Previous", "上一页")}
              </button>
              <span>{scopeState.page ?? 1}</span>
              <button
                type="button"
                disabled={scopeState.next_cursor == null}
                onClick={() => setFileCursor(scopeState.next_cursor ?? null)}
              >
                {text("Next", "下一页")}
              </button>
            </div>
          ) : null}
        </aside>

        <main
          className={styles.diff}
          data-mounted-diff-count={selectedPath ? "1" : "0"}
          data-mounted-diff-lines={diffState.line_count ?? 0}
        >
          {selected ? (
            <div className={styles.fileHeader}>
              <div className={styles.fileTitle}>
                <FileTypeIcon name={selected.path} />
                <h2>{fileName(selected.rel)}</h2>
                {selected.op === "add" || selected.op === "delete" ? (
                  <span className={selected.op === "add" ? styles.badgeAdded : styles.badgeDeleted}>
                    {selected.op === "add" ? text("New file", "新文件") : text("Deleted", "已删除")}
                  </span>
                ) : null}
                <span className={styles.fileActions}>
                  {previewable ? (
                    <span className={styles.viewTabs} role="tablist" aria-label={text("View", "查看方式")}>
                      {([
                        ["changes", text("Changes", "改动")],
                        ["preview", text("Preview", "预览")],
                      ] as const).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          role="tab"
                          aria-selected={(value === "preview") === showPreview}
                          className={(value === "preview") === showPreview ? styles.viewActive : styles.view}
                          onClick={() => setView(value)}
                        >
                          {label}
                        </button>
                      ))}
                    </span>
                  ) : null}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className={`${styles.menuButton} ${styles.switcher}`}
                        aria-label={text("Choose file", "选择文件")}
                      >
                        {`${selectedIndex + 1} / ${scopeState.files.length}`}
                        <ChevronDown size={14} aria-hidden="true" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className={MENU_PANEL}>
                      {scopeState.files.map((file) => (
                        <DropdownMenuItem
                          key={file.path}
                          className={`${itemCls(false)} ${MENU_ITEM_STATES}`}
                          onSelect={() => chooseFile(file.path)}
                        >
                          <FileTypeIcon name={file.path} />
                          <span className="min-w-0 flex-1 truncate">{file.rel}</span>
                          <span className={styles.counts}>
                            <i>+{file.added ?? "—"}</i>
                            <em>−{file.removed ?? "—"}</em>
                          </span>
                          {file.path === selectedPath
                            ? <Check size={14} className={CHECK_SLOT} aria-hidden="true" />
                            : <span className={CHECK_SLOT_PAD} />}
                        </DropdownMenuItem>
                      ))}
                      {filePages ? (
                        <>
                          <DropdownMenuSeparator className={MENU_SEPARATOR} />
                          <DropdownMenuItem
                            className={`${itemCls(false)} ${MENU_ITEM_STATES}`}
                            disabled={scopeState.prev_cursor == null}
                            onSelect={() => setFileCursor(scopeState.prev_cursor ?? null)}
                          >
                            {text("Previous page", "上一页")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className={`${itemCls(false)} ${MENU_ITEM_STATES}`}
                            disabled={scopeState.next_cursor == null}
                            onSelect={() => setFileCursor(scopeState.next_cursor ?? null)}
                          >
                            {text("Next page", "下一页")}
                          </DropdownMenuItem>
                        </>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </span>
              </div>
              <div className={styles.fileMeta}>
                {[
                  fileFolder(selected.rel),
                  selected.actor_ids?.length || selected.actor_id
                    ? text(
                      `Actor ${(selected.actor_ids ?? [selected.actor_id]).filter(Boolean).join(", ")}`,
                      `执行者 ${(selected.actor_ids ?? [selected.actor_id]).filter(Boolean).join("、")}`,
                    )
                    : null,
                  selected.producer_turn_id
                    ? text(`Turn ${selected.producer_turn_id.slice(0, 8)}`, `来源轮次 ${selected.producer_turn_id.slice(0, 8)}`)
                    : null,
                  selected.turn_ids && selected.turn_ids.length > 1
                    ? text(`${selected.turn_ids.length} turns`, `${selected.turn_ids.length} 轮`)
                    : null,
                ].filter(Boolean).map((part) => <span key={part as string}>{part}</span>)}
                <span className={styles.counts}>
                  <i>+{selected.added ?? "—"}</i>
                  <em>−{selected.removed ?? "—"}</em>
                </span>
              </div>
            </div>
          ) : null}
          <div className={styles.diffBody}>
            {!selectedPath ? (
              <div className={styles.empty}>
                {scopeState.files.length
                  ? text("Select a file to inspect", "选择文件以查看差异")
                  : scopeState.loading
                    ? text("Loading files…", "正在加载文件…")
                    : scopeState.error ?? text("No changes in this scope", "此范围没有修改")}
              </div>
            ) : showPreview && selected ? (
              <div className={styles.preview}><FileViewer projectId="" path={selected.path} abs sessionId={sessionId} /></div>
            ) : diffState.loading ? (
              <div className={styles.empty}>{text("Loading diff…", "正在加载差异…")}</div>
            ) : diffState.error ? (
              <div className={styles.empty}>{diffState.error}</div>
            ) : diffState.diff_state === "large" || diffState.diff_state === "large_line" ? (
              <div className={styles.empty}>{text("Diff exceeds the bounded preview size", "差异超过预览大小限制")}</div>
            ) : diffState.diff_state === "binary" ? (
              <div className={styles.empty}>{text("Binary file", "二进制文件")}</div>
            ) : diffState.diff ? (
              <ReviewDiff diff={diffState.diff} op={selected?.op} />
            ) : (
              <div className={styles.empty}>{text("No textual changes", "没有文本改动")}</div>
            )}
            {diffPages ? (
              <div className={styles.diffPagination}>
                <button
                  type="button"
                  disabled={diffHistory.length === 0 || diffState.loading}
                  onClick={() => {
                    const prior = diffHistory[diffHistory.length - 1] ?? null;
                    setDiffHistory((history) => history.slice(0, -1));
                    setDiffCursor(prior);
                  }}
                >
                  {text("Previous", "上一页")}
                </button>
                <button
                  type="button"
                  disabled={diffState.next_cursor == null || diffState.loading}
                  onClick={() => {
                    if (diffCursor) {
                      setDiffHistory((history) => [...history, diffCursor]);
                    }
                    setDiffCursor(diffState.next_cursor ?? null);
                  }}
                >
                  {text("Next", "下一页")}
                </button>
              </div>
            ) : null}
          </div>
        </main>
      </div>
    </div>
  );
}

function fileName(rel: string): string {
  return rel.split("/").pop() || rel;
}

function fileFolder(rel: string): string {
  const index = rel.lastIndexOf("/");
  return index > 0 ? rel.slice(0, index + 1) : "";
}
