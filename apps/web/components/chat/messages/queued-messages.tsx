"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import { useSendQueue, type QueuedMessage } from "@/lib/chat/send-queue";
import { queuedHasAttachments, snapshotQueuedAttachments } from "@/lib/chat/queued-attachments";
import { steerQueuedMessage } from "@/lib/chat/steer-message";
import { CornerDownRight, Pencil, X, Paperclip, ChevronDown, ChevronRight } from "lucide-react";
import { AttachmentStrip } from "../composer/attach/attachment-strip";
import { useComposerAttachments } from "../composer/attach/use-composer-attachments";
import { attachmentsBlockSend } from "../composer/attach/attachment-session-cache";
import { AttachmentChips, parseAttachments } from "./user-attachments";
import styles from "./queued-messages.module.css";

const EMPTY: QueuedMessage[] = [];

function QueueEditor({ row, sessionId }: { row: QueuedMessage; sessionId: string }) {
  const { text } = useTranslation();
  const [value, setValue] = useState(row.text);
  const [initial] = useState(() => snapshotQueuedAttachments(row));
  const files = useComposerAttachments(`queue:${sessionId}:${row.id}`, initial);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      queueMicrotask(() => {
        if (mounted.current) return;
        const queue = useSendQueue.getState();
        queue.endEdit(sessionId, row.id);
        queue.drain(sessionId);
      });
    };
  }, [sessionId, row.id]);
  const blocked = Boolean(attachmentsBlockSend(files.pendingImages, files.pendingDocs))
    || (!value.trim() && !files.pendingImages.length && !files.pendingDocs.length);
  const cancel = () => useSendQueue.getState().endEdit(sessionId, row.id);
  const save = () => {
    if (blocked) return;
    useSendQueue.getState().updateDraft(sessionId, row.id, {
      text: value.trim(), images: files.pendingImages, docs: files.pendingDocs,
    });
  };
  return <div className={styles.editor} ref={files.composerRootRef}
    onDragOver={files.onDragOver} onDragLeave={files.onDragLeave} onDrop={files.onDrop}>
    <AttachmentStrip sessionId={sessionId} pendingImages={files.pendingImages} pendingDocs={files.pendingDocs}
      imageError={files.imageError} fileInputRef={files.fileInputRef} onFileInputChange={files.onFileInputChange}
      onRemoveImage={files.removeImage} onRemoveDoc={files.removeDoc} onDismissError={() => files.setImageError(null)} />
    <textarea autoFocus aria-label={text("Edit queued message", "编辑排队消息")}
      value={value} rows={3} onChange={event => setValue(event.target.value)}
      onPaste={event => {
        if (event.clipboardData.files.length) {
          event.preventDefault(); void files.addFiles(Array.from(event.clipboardData.files));
        }
      }}
      onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); cancel(); }
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); save(); }
      }} />
    <div className={styles.editorActions}>
      <button type="button" onClick={files.onPickImages}><Paperclip size={14} />{text("Add attachment", "添加附件")}</button>
      <span />
      <button type="button" onClick={cancel}>{text("Cancel", "取消")}</button>
      <button type="button" onClick={save} disabled={blocked}>{text("Save", "保存")}</button>
    </div>
  </div>;
}

function QueueRow({ row, sessionId }: { row: QueuedMessage; sessionId: string }) {
  const { text } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const locked = Boolean(row.injecting || row.steerCommand);
  const hasFiles = queuedHasAttachments(row);
  const parsed = parseAttachments(row.text);
  const status = row.editing ? text("Editing · send paused", "编辑中，暂停发送")
    : row.steerError === "cancelled" && locked ? text("Checking delivery after Stop…", "正在确认停止前的发送结果…")
    : row.steerError === "ended" ? text("Not sent · original turn ended", "未发送，原来的轮次已结束")
    : row.steerError === "cancelled" ? text("Not sent · turn stopped", "未发送，当前轮已停止")
    : row.deliveryError ? text("Not sent · retry or edit", "未发送，可重试或编辑")
    : row.steerError === "unconfirmed" ? text("Delivery unconfirmed — retry to check", "发送结果待确认，请重试查询")
    : row.steerCommand || row.injecting ? text("Waiting to add to current turn…", "等待补充到当前轮…")
    : row.steerError === "too_long" ? text("Queued · over the 4,096-character limit for current-turn input", "排队中，超出当前轮补充的 4,096 字符限制")
    : row.steerError ? text("Queued for the next turn", "已排队，将在下一轮发送")
    : hasFiles ? text("Queued with attachments", "附件消息排队中") : text("Queued", "排队中");
  return <article className={styles.row} data-queued-message={row.id} aria-label={text("Queued message", "排队消息")}>
    {row.editing ? <QueueEditor row={row} sessionId={sessionId} /> : <>
      {hasFiles && <AttachmentStrip sessionId={sessionId} readOnly pendingImages={row.images ?? []} pendingDocs={row.docs ?? []}
        imageError={null} fileInputRef={inputRef} onFileInputChange={() => {}}
        onRemoveImage={() => {}} onRemoveDoc={() => {}} onDismissError={() => {}} />}
      <AttachmentChips sessionId={sessionId} items={parsed.attachments} />
      {parsed.text && <div className={`${styles.content} ${expanded ? styles.expanded : ""}`}>{parsed.text}</div>}
      {(parsed.text.length > 180 || parsed.text.split("\n").length > 3) && <button type="button"
        className={styles.expandText} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        {expanded ? text("Show less", "收起正文") : text("Show more", "展开正文")}
      </button>}
    </>}
    <div className={styles.footer}>
      <span role="status">{status}</span>
      {!row.editing && <div className={styles.actions}>
        <span className="message-timestamp" title={new Date(row.queuedAt).toLocaleString()}>
          {new Date(row.queuedAt).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}
        </span>
        <button type="button" disabled={locked} onClick={() => useSendQueue.getState().beginEdit(sessionId, row.id)}
          title={text("Edit queued message", "编辑排队消息")} aria-label={text("Edit queued message", "编辑排队消息")}><Pencil size={14} /></button>
        {(!locked && (row.deliveryError || ["cancelled", "ended"].includes(row.steerError ?? ""))) && <button type="button" onClick={() => useSendQueue.getState().retryDraft(sessionId, row.id)}
          title={text("Retry send", "重试发送")} aria-label={text("Retry send", "重试发送")}><CornerDownRight size={14} /></button>}
        {!hasFiles && (row.steerCommand || !["cancelled", "ended"].includes(row.steerError ?? "")) && <button type="button" disabled={row.injecting || (!!row.steerCommand && !row.steerError)}
          onClick={() => void steerQueuedMessage(sessionId, row.id)}
          title={row.steerCommand ? text("Retry delivery confirmation", "重试确认发送结果") : text("Add to current turn", "补充到当前轮")}
          aria-label={row.steerCommand ? text("Retry delivery confirmation", "重试确认发送结果") : text("Add to current turn", "补充到当前轮")}><CornerDownRight size={14} /></button>}
        <button type="button" disabled={locked} onClick={() => useSendQueue.getState().removeDraft(sessionId, row.id)}
          title={text("Remove from queue", "从队列移除")} aria-label={text("Remove from queue", "从队列移除")}><X size={14} /></button>
      </div>}
    </div>
  </article>;
}

export function QueuedMessages({ sessionId }: { sessionId: string | null }) {
  const { text } = useTranslation();
  const rows = useSendQueue(s => sessionId ? s.queues[sessionId] ?? EMPTY : EMPTY);
  const [collapsed, setCollapsed] = useState(false);
  if (!sessionId || !rows.length) return null;
  return <section className={styles.group} data-queued-messages aria-label={text("Queued messages", "排队消息")}>
    <button type="button" className={styles.heading} disabled={rows.some(row => row.editing)} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>
      {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
      {text(`${rows.length} pending`, `${rows.length} 条待发送消息`)}
    </button>
    {!collapsed && <div className={styles.list}>
      {rows.map(row => <QueueRow key={row.id} row={row} sessionId={sessionId} />)}
    </div>}
  </section>;
}
