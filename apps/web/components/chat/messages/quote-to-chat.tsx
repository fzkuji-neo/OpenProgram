"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Quote } from "lucide-react";
import { useSessionStore } from "@/lib/session-store";
import { useTranslation } from "@/lib/i18n";
import styles from "./message-editor.module.css";

export function quoteToChat(sessionId: string, content: string) {
  const selected = content.trim();
  if (!selected) return;
  const store = useSessionStore.getState();
  const draft = store.composerDrafts[sessionId] || "";
  const quote = selected.split("\n").map(line => `> ${line}`).join("\n");
  store.setComposerInputFor(sessionId, `${draft}${draft ? "\n\n" : ""}${quote}\n\n`);
  requestAnimationFrame(() => {
    const host = Array.from(document.querySelectorAll<HTMLElement>("[data-composer-session]"))
      .find(node => node.dataset.composerSession === sessionId);
    const input = host?.querySelector<HTMLTextAreaElement>("textarea");
    input?.focus();
    input?.setSelectionRange(input.value.length, input.value.length);
  });
}

/** One selection listener per transcript, not per message. */
export function SelectionQuote({ sessionId }: { sessionId: string | null }) {
  const { text } = useTranslation();
  const anchor = useRef<HTMLSpanElement>(null);
  const [selection, setSelection] = useState<{ content: string; left: number; top: number } | null>(null);
  useEffect(() => {
    const root = anchor.current?.parentElement;
    if (!root || !sessionId) return;
    const hide = () => setSelection(null);
    const update = () => {
      const selected = window.getSelection();
      if (!selected || selected.isCollapsed || !selected.rangeCount) return hide();
      const element = (node: Node | null) => node instanceof Element ? node : node?.parentElement;
      const start = element(selected.anchorNode)?.closest(".message-content");
      const end = element(selected.focusNode)?.closest(".message-content");
      if (!start || start !== end || !root.contains(start) || start.closest(".is-editing")) return hide();
      const content = selected.toString().trim();
      if (!content) return hide();
      const rect = selected.getRangeAt(0).getBoundingClientRect();
      setSelection({ content, left: Math.max(12, Math.min(rect.left, window.innerWidth - 160)),
        top: rect.top > 48 ? rect.top - 42 : rect.bottom + 6 });
    };
    root.addEventListener("pointerup", update);
    root.addEventListener("keyup", update);
    document.addEventListener("selectionchange", update);
    document.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      root.removeEventListener("pointerup", update); root.removeEventListener("keyup", update);
      document.removeEventListener("selectionchange", update); document.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [sessionId]);
  return <><span ref={anchor} hidden />{selection && sessionId && createPortal(
    <button className={styles.quotePopup} type="button" style={{ left: selection.left, top: selection.top }}
      onPointerDown={e => e.preventDefault()} onClick={() => {
        quoteToChat(sessionId, selection.content); window.getSelection()?.removeAllRanges(); setSelection(null);
      }}><Quote size={15} />{text("Add to chat", "引用到聊天")}</button>, document.body,
  )}</>;
}
