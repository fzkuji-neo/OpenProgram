"use client";
import { useCallback } from "react";
import { Markdown } from "@/lib/format-utils/markdown";
import { absRawFileUrl, rawFileUrl } from "@/lib/files/files-shared";
import { markdownDestination, resolveMarkdownFile } from "@/lib/files/markdown-paths";
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
    const target = resolveMarkdownFile(path, src);
    if (!target) return null;
    return (abs ? absRawFileUrl(target.path, sessionId) : rawFileUrl(projectId, target.path)) + target.fragment;
  }, [abs, path, projectId, sessionId]);

  function onClick(event: React.MouseEvent) {
    const anchor = (event.target as HTMLElement).closest("a[href]");
    if (!anchor) return;
    const href = anchor.getAttribute("href") ?? "";
    const destination = markdownDestination(href);
    if (destination.kind === "rejected") { event.preventDefault(); return; }
    if (destination.kind !== "local") return;
    const target = resolveMarkdownFile(path, href);
    if (!target) { event.preventDefault(); return; }
    event.preventDefault();
    const tabs = useCenterTabs.getState();
    if (!abs) tabs.openFileTab(projectId, target.path);
    else if (sessionId) tabs.openFilePreview(sessionId, { projectId, path: target.path, readOnly: true });
  }

  return <div className={styles.scroll} onClick={onClick}>
    {/* message-content reuses chat.css element styles (headings, lists, tables) */}
    <article className={`${styles.document} message-content`}>
      <Markdown source={source} escapeRawHtml resolveImage={resolveImage} />
    </article>
  </div>;
}
