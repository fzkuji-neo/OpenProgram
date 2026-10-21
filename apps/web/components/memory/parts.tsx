"use client";

/**
 * Memory page subcomponents — tab button, tree group rows,
 * editor panel, loading skeleton, empty state, placeholder.
 */
import { useRef } from "react";
import { FileText, Folder, FolderOpen } from "lucide-react";

import fileStyles from "@/components/files/files-panel.module.css";
import { RailBadge, RailCount, RailItem } from "@/components/ui/secondary-rail";
import { parseFrontmatter, renderMarkdown } from "./markdown";
import { formatDate } from "./format";
import { DocIcon } from "./icons";
import { useTranslation } from "@/lib/i18n";
import { type AnimatedNavIconHandle, ClockIcon, FileTextIcon, XIcon } from "@/components/animated-icons";
import { ManageEmptyState } from "@/components/ui/manage-page";
import type { EditorState, TopicPage } from "./types";
import styles from "./memory-page.module.css";

/** One Memory section (Topics, Timeline, …) in the rail. */
export function TabButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return <RailItem icon={icon} label={children} active={active} onClick={onClick} />;
}

/** The folder glyph is the disclosure state, as in the Programs tree. */
export function FolderGlyph({ open }: { open: boolean }) {
  return open
    ? <FolderOpen size={15} className={fileStyles.treeIconFolder} />
    : <Folder size={15} className={fileStyles.treeIconFolder} />;
}

export function DocGlyph() {
  return <FileText size={15} className={fileStyles.treeIcon} />;
}

export function TreeGroup({ folder, pages, expanded, onToggle, selected, onSelect, forceOpen }: {
  folder: string;
  pages: TopicPage[];
  expanded: Set<string>;
  onToggle: (f: string) => void;
  selected: TopicPage | null;
  forceOpen?: boolean;
  onSelect: (p: TopicPage) => void;
}) {
  const { locale } = useTranslation();
  const isExpanded = !folder || expanded.has(folder) || Boolean(forceOpen);
  return (
    <>
      {folder && (
        <RailItem
          icon={<FolderGlyph open={isExpanded} />}
          label={folder}
          trailing={<RailCount>{pages.length}</RailCount>}
          aria-expanded={isExpanded}
          onClick={() => onToggle(folder)}
        />
      )}
      {isExpanded && pages.map((page) => (
        <RailItem
          key={page.path}
          depth={folder ? 1 : 0}
          icon={<DocGlyph />}
          label={page.title || page.path.split("/").pop()}
          badge={page.type ? <RailBadge>{page.type}</RailBadge> : undefined}
          trailing={<RailCount>{formatDate(page.mtime, locale)}</RailCount>}
          active={selected?.path === page.path}
          onClick={() => onSelect(page)}
        />
      ))}
    </>
  );
}

export function EditorPanel({ title, badge, meta, state, onChange, onViewMode, onDelete, onPreviewClick, tools, notices, detail, loading, onKeyDown, readOnly }: {
  title: string;
  badge?: React.ReactNode;
  meta: string[];
  state: EditorState;
  onChange: (c: string) => void;
  tools?: React.ReactNode;
  notices?: React.ReactNode;
  detail?: React.ReactNode;
  loading?: boolean;
  readOnly?: boolean;
  onKeyDown?: React.KeyboardEventHandler<HTMLTextAreaElement>;
  onViewMode: (m: EditorState["viewMode"]) => void;
  onDelete?: () => void | Promise<void>;
  onPreviewClick?: (e: React.MouseEvent) => void;
}) {
  const { text } = useTranslation();
  const delIconRef = useRef<AnimatedNavIconHandle>(null);
  const { frontmatter, body } = parseFrontmatter(state.content);
  const lines = state.content.split("\n").length;
  const words = state.content.trim() ? state.content.trim().split(/\s+/).length : 0;
  const previewHtml = state.viewMode === "preview" ? renderMarkdown(body) : "";

  return (
    <div className={styles.editor}>
      <div className={styles.editorHeader}>
        <div className={styles.editorHeaderLeft}>
          <DocIcon className={styles.fileIcon} />
          <div className={styles.editorIdentity}>
            <div className={styles.editorTitleRow}>
              <span className={styles.editorTitle}>{title}</span>
              {badge}
            </div>
            {meta.length > 0 && (
              <div className={styles.editorHeaderMeta}>{meta.map((m, i) => <span key={i}>{m}</span>)}</div>
            )}
          </div>
        </div>
        <div className={styles.editorActions}>
          <div className={styles.modeSwitcher}>
            <button className={`${styles.modeBtn} ${state.viewMode === "edit" ? styles.modeBtnActive : ""}`} onClick={() => onViewMode("edit")}>{text("Edit", "编辑")}</button>
            <button className={`${styles.modeBtn} ${state.viewMode === "preview" ? styles.modeBtnActive : ""}`} onClick={() => onViewMode("preview")}>{text("Preview", "预览")}</button>
          </div>
          {tools}
          {onDelete && (
            <button
              className={styles.dangerBtn}
              onClick={onDelete}
              title={text("Delete topic", "删除主题")}
              aria-label={text("Delete topic", "删除主题")}
              onMouseEnter={() => delIconRef.current?.startAnimation?.()}
              onMouseLeave={() => delIconRef.current?.stopAnimation?.()}
            >
              <XIcon ref={delIconRef} size={13} />
            </button>
          )}
        </div>
      </div>
      {notices}
      {loading ? <LoadingSkeleton /> : detail || (state.viewMode === "edit" ? (
        <textarea
          className={styles.textarea}
          aria-label={text("Memory source", "记忆源文本")}
          value={state.content}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          readOnly={readOnly}
          onKeyDown={onKeyDown}
          placeholder={text("Empty...", "空内容...")}
        />
      ) : (
        <div className={styles.preview} onClick={onPreviewClick}>
          {Object.keys(frontmatter).length > 0 && (
            <div className={styles.frontmatter}>
              {Object.entries(frontmatter).map(([k, v]) => (
                <div key={k} className={styles.fmRow}>
                  <span className={styles.fmKey}>{k}</span>
                  <span className={styles.fmVal}>{v}</span>
                </div>
              ))}
            </div>
          )}
          {body ? (
            <div className={styles.markdown} dangerouslySetInnerHTML={{ __html: previewHtml }} />
          ) : (
            <div className={styles.previewEmpty}>{text("Nothing to preview", "没有可预览内容")}</div>
          )}
        </div>
      ))}
      <div className={styles.editorFooter}>
        <span>{localeTextCount(lines, text("line", "行"), text("lines", "行"))}</span>
        <span>{localeTextCount(words, text("word", "词"), text("words", "词"))}</span>
        <span>{localeTextCount(state.content.length, text("char", "字符"), text("chars", "字符"))}</span>
      </div>
    </div>
  );
}

function localeTextCount(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function LoadingSkeleton() {
  return (
    <div className={styles.treeLoading}>
      {[100, 70, 85, 60].map((w, i) => (
        <div key={i} className={styles.skeleton} style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}

// Both empty treatments use the app-wide ManageEmptyState anatomy: compact
// in a rail (EmptyState); inside the right pane's framed card, matching the
// Topics emptyPanel, for Placeholder.
function emptyIcon(icon: "doc" | "clock") {
  return icon === "doc" ? <FileTextIcon size={20} /> : <ClockIcon size={20} />;
}

export function EmptyState({ icon, text, sub }: { icon: "doc" | "clock"; text: string; sub: string }) {
  return <ManageEmptyState compact icon={emptyIcon(icon)} title={text} description={sub} />;
}

export function Placeholder({ icon, text }: { icon: "doc" | "clock"; text: string }) {
  return (
    <div className={styles.placeholder}>
      <ManageEmptyState icon={emptyIcon(icon)} title={text} />
    </div>
  );
}
