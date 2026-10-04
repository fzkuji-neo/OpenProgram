"use client";
import { useEffect, useMemo } from "react";
import { FileTextIcon, ArrowUpRightIcon } from "@/components/animated-icons";
import { useActionIconAnimation } from "./use-action-icon-animation";
import { useTranslation } from "@/lib/i18n";
import { useSessionStore, type ChatMsg } from "@/lib/session-store";
import { useCenterTabs } from "@/lib/tabs/center-tabs-store";
import { useCurrentProject } from "@/lib/files/files-shared";
import { collectFileOutputs, previewTarget, type FileOutput } from "@/lib/chat/file-outputs";
import { fileCapabilities } from "@/lib/documents/file-formats";
import type { ParsedAttachment } from "./user-attachments";
import styles from "./assistant-file-cards.module.css";

function OutputRow({ file, open }: { file: FileOutput; open(): void }) {
  const icon = useActionIconAnimation();
  const { text } = useTranslation();
  return <button type="button" className={styles.row} onClick={open} title={file.path} aria-label={`${file.name} ${text("Open preview", "打开预览")}`} {...icon.handlers}>
    <span className={styles.icon}><FileTextIcon ref={icon.ref} size={21} aria-hidden /></span>
    <span className={styles.label}><strong>{file.name}</strong><small>{text("Open preview", "打开预览")}</small></span>
    <ArrowUpRightIcon size={16} aria-hidden />
  </button>;
}

export function AssistantFileCards({ msg, sessionId, attachments }: { msg: ChatMsg; sessionId?: string; attachments: ParsedAttachment[] }) {
  const focusedSessionId = useSessionStore(state => state.currentSessionId);
  const project = useCurrentProject({ sessionId: sessionId ?? null, chatKey: null });
  const files = useMemo(() => collectFileOutputs(msg.content || "", attachments), [msg.content, attachments]);
  const open = (file: FileOutput, automatic = false) => sessionId && useCenterTabs.getState().openFilePreview(sessionId, previewTarget(file.path, project), automatic);
  useEffect(() => {
    if (!sessionId || !msg.autoPreviewFiles || project === undefined) return;
    // Consume before attempting: switching back, hydration and remount cannot replay the request.
    useSessionStore.getState().updateMessage(sessionId, msg.id, { autoPreviewFiles: false });
    if (sessionId !== focusedSessionId || msg.status !== "done") return;
    const file = files.find(item => fileCapabilities(item.path).preview !== "download");
    if (file) open(file, true);
  }, [sessionId, focusedSessionId, msg.id, msg.status, msg.autoPreviewFiles, files, project]);
  if (!files.length) return null;
  return <div className={styles.files} data-assistant-files>{files.map(file => <OutputRow key={file.path} file={file} open={() => void open(file)} />)}</div>;
}
