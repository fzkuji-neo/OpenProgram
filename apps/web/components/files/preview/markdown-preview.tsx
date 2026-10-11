"use client";
import { useCallback } from "react";
import { Markdown } from "@/lib/format-utils/markdown";
import { absRawFileUrl, rawFileUrl } from "@/lib/files/files-shared";
import { resolveMarkdownReference } from "@/lib/files/markdown-paths";
import { useCenterTabs } from "@/lib/tabs/center-tabs-store";
import styles from "./markdown-preview.module.css";

/** A markdown file read as a document. Relative images load from the
 *  document's own folder through the same scoped file routes as the file
 *  itself, and a relative link opens that file in its own tab. Raw HTML
 *  stays escaped: a repository file is untrusted. */
export function MarkdownPreview({ source, projectId, path, abs = false, sessionId }: {
  source: string; projectId: string; path: string; abs?: boolean; sessionId?: string;
}) {
  const resolveImage = useCallback((src: string) => {
    const target = resolveMarkdownReference(path, src);
    if (!target) return null;
    return abs ? absRawFileUrl(target, sessionId) : rawFileUrl(projectId, target);
  }, [abs, path, projectId, sessionId]);

  function onClick(event: React.MouseEvent) {
    const anchor = (event.target as HTMLElement).closest("a[href]");
    const target = anchor && resolveMarkdownReference(path, anchor.getAttribute("href") ?? "");
    if (!target) return;
    event.preventDefault();
    const tabs = useCenterTabs.getState();
    if (!abs) tabs.openFileTab(projectId, target);
    else if (sessionId) tabs.openFilePreview(sessionId, { projectId, path: target, readOnly: true });
  }

  return <div className={styles.scroll} onClick={onClick}>
    {/* message-content reuses chat.css element styles (headings, lists, tables) */}
    <article className={`${styles.document} message-content`}>
      <Markdown source={source} escapeRawHtml resolveImage={resolveImage} />
    </article>
  </div>;
}
