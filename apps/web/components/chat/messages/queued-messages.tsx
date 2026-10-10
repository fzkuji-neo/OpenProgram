"use client";

/**
 * Messages typed during a run, as one raised card docked above the input
 * box. Each row is one line: a tag says where the message goes ("This
 * turn" while it is being added to the current turn at its next safe
 * point, "Next turn" while it waits for the run to finish), then the text,
 * then hover actions (add to this turn, retry, edit, remove). Clicking the
 * text expands the full message and its attachments. The heading collapses
 * the card; "Clear all" removes every row that is not being delivered or
 * edited.
 */

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import { useSendQueue, type QueuedMessage } from "@/lib/chat/send-queue";
import { queuedHasAttachments, snapshotQueuedAttachments } from "@/lib/chat/queued-attachments";
import { steerQueuedMessage } from "@/lib/chat/steer-message";
import { CornerDownRight, Pencil, X, Paperclip, ChevronDown, ChevronUp, RotateCcw } from "lucide-react";
import { HoverTip } from "@/components/ui/tooltip";
import { AttachmentStrip } from "../composer/attach/attachment-strip";
import { useComposerAttachments } from "../composer/attach/use-composer-attachments";
import { attachmentsBlockSend } from "../composer/attach/attachment-session-cache";
import { AttachmentChips, parseAttachments } from "./user-attachments";
import styles from "./queued-messages.module.css";

const EMPTY: QueuedMessage[] = [];

type Text = ReturnType<typeof useTranslation>["text"];
type Tone = "steer" | "next" | "wait" | "error";

/** A row is being added to the current turn: its steer request or the
 *  command receipt it waits on is in flight, with no failure recorded. */
function addingToTurn(row: QueuedMessage): boolean {
  return Boolean((row.injecting || row.steerCommand) && !row.steerError);
}

/** The tag, the optional visible note under the line, and the full status
 *  sentence announced to screen readers. */
function rowState(row: QueuedMessage, text: Text): { tone: Tone; tag: string; note?: string; status: string } {
  const locked = Boolean(row.injecting || row.steerCommand);
  const hasFiles = queuedHasAttachments(row);
  const next = text("Next turn", "下一轮");
  const notSent = text("Not sent", "未发送");
  if (row.steerError === "cancelled" && locked) {
    const note = text("Checking delivery after Stop…", "正在确认停止前的发送结果…");
    return { tone: "wait", tag: text("Checking", "确认中"), note, status: note };
  }
  if (row.steerError === "ended") {
    const note = text("The original turn ended", "原来的轮次已结束");
    return { tone: "error", tag: notSent, note, status: text("Not sent · original turn ended", "未发送，原来的轮次已结束") };
  }
  if (row.steerError === "cancelled") {
    const note = text("The turn was stopped", "当前轮已停止");
    return { tone: "error", tag: notSent, note, status: text("Not sent · turn stopped", "未发送，当前轮已停止") };
  }
  if (row.deliveryError) {
    const note = text("Retry or edit", "可重试或编辑");
    return { tone: "error", tag: notSent, note, status: text("Not sent · retry or edit", "未发送，可重试或编辑") };
  }
  if (row.steerError === "unconfirmed") {
    const note = text("Delivery unconfirmed — retry to check", "发送结果待确认，请重试查询");
    return { tone: "wait", tag: text("Unconfirmed", "待确认"), note, status: note };
  }
  if (locked) {
    return { tone: "steer", tag: text("This turn", "插入当前轮"),
      status: text("Waiting to add to current turn…", "等待补充到当前轮…") };
  }
  if (row.steerError === "too_long") {
    const note = text("Over the 4,096-character limit for adding to this turn", "超出插入当前轮的 4,096 字符限制");
    return { tone: "next", tag: next, note,
      status: text("Queued · over the 4,096-character limit for current-turn input", "排队中，超出当前轮补充的 4,096 字符限制") };
  }
  if (row.steerError) {
    const note = text("Couldn't add to this turn", "未能插入当前轮");
    return { tone: "next", tag: next, note, status: text("Queued for the next turn", "已排队，将在下一轮发送") };
  }
  return { tone: "next", tag: next,
    status: hasFiles ? text("Queued with attachments", "附件消息排队中") : text("Queued", "排队中") };
}

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

function RowAction({ label, onClick, disabled, children }: {
  label: string; onClick(): void; disabled?: boolean; children: React.ReactNode;
}) {
  return <HoverTip label={label}>
    <button type="button" className={styles.action} disabled={disabled} onClick={onClick} aria-label={label}>
      {children}
    </button>
  </HoverTip>;
}

function QueueRow({ row, sessionId }: { row: QueuedMessage; sessionId: string }) {
  const { text } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const locked = Boolean(row.injecting || row.steerCommand);
  const hasFiles = queuedHasAttachments(row);
  const fileCount = (row.images?.length ?? 0) + (row.docs?.length ?? 0);
  const parsed = parseAttachments(row.text);
  const state = rowState(row, text);
  const firstLine = parsed.text.split("\n").find(line => line.trim()) ?? "";
  const canRetry = !locked && (row.deliveryError || ["cancelled", "ended"].includes(row.steerError ?? ""));
  const canSteer = !hasFiles && (row.steerCommand || !["cancelled", "ended"].includes(row.steerError ?? ""));
  const steerLabel = row.steerCommand
    ? text("Retry delivery confirmation", "重试确认发送结果")
    : text("Add to this turn", "插入当前轮");
  if (row.editing) {
    return <article className={styles.row} data-queued-message={row.id} data-editing="true"
      aria-label={text("Queued message", "排队消息")}>
      <QueueEditor row={row} sessionId={sessionId} />
      <span role="status" className={styles.srOnly}>{text("Editing · send paused", "编辑中，暂停发送")}</span>
    </article>;
  }
  return <article className={styles.row} data-queued-message={row.id} data-tone={state.tone}
    aria-label={text("Queued message", "排队消息")}>
    <div className={styles.line}>
      <span className={styles.tag} data-tone={state.tone}>
        {state.tone === "steer" || state.tone === "wait" ? <i aria-hidden="true" /> : null}
        {state.tag}
      </span>
      {hasFiles && <span className={styles.files}><Paperclip size={12} aria-hidden="true" />{fileCount}</span>}
      <button type="button" className={styles.text} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        {firstLine || text("Attachments", "附件")}
      </button>
      <div className={styles.actions}>
        <span className="message-timestamp">
          {new Date(row.queuedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
        {canSteer && <RowAction label={steerLabel}
          disabled={row.injecting || (!!row.steerCommand && !row.steerError)}
          onClick={() => void steerQueuedMessage(sessionId, row.id)}><CornerDownRight size={14} /></RowAction>}
        {canRetry && <RowAction label={text("Retry send", "重试发送")}
          onClick={() => useSendQueue.getState().retryDraft(sessionId, row.id)}><RotateCcw size={14} /></RowAction>}
        <RowAction label={text("Edit queued message", "编辑排队消息")} disabled={locked}
          onClick={() => useSendQueue.getState().beginEdit(sessionId, row.id)}><Pencil size={14} /></RowAction>
        <RowAction label={text("Remove from queue", "从队列移除")} disabled={locked}
          onClick={() => useSendQueue.getState().removeDraft(sessionId, row.id)}><X size={14} /></RowAction>
      </div>
    </div>
    {state.note && <div className={styles.note} data-tone={state.tone}>{state.note}</div>}
    <span role="status" className={styles.srOnly}>{state.status}</span>
    {expanded && <div className={styles.detail}>
      {hasFiles && <AttachmentStrip sessionId={sessionId} readOnly pendingImages={row.images ?? []} pendingDocs={row.docs ?? []}
        imageError={null} fileInputRef={inputRef} onFileInputChange={() => {}}
        onRemoveImage={() => {}} onRemoveDoc={() => {}} onDismissError={() => {}} />}
      <AttachmentChips sessionId={sessionId} items={parsed.attachments} />
      {parsed.text && <div className={styles.content}>{parsed.text}</div>}
    </div>}
  </article>;
}

export function QueuedMessages({ sessionId }: { sessionId: string | null }) {
  const { text } = useTranslation();
  const rows = useSendQueue(s => sessionId ? s.queues[sessionId] ?? EMPTY : EMPTY);
  const [collapsed, setCollapsed] = useState(false);
  if (!sessionId || !rows.length) return null;
  const adding = rows.filter(addingToTurn).length;
  const editing = rows.some(row => row.editing);
  const clearable = rows.some(row => !row.injecting && !row.steerCommand && !row.editing);
  return <section className={styles.card} data-queued-messages aria-label={text("Queued messages", "排队消息")}>
    <button type="button" className={styles.heading} disabled={editing} aria-expanded={!collapsed}
      onClick={() => setCollapsed(!collapsed)}>
      <span className={styles.title}>
        {text(`${rows.length} queued ${rows.length === 1 ? "message" : "messages"}`, `${rows.length} 条排队消息`)}
      </span>
      {adding > 0 && <span className={styles.sub}>
        {text(`· ${adding} adding to this turn`, `· ${adding} 条插入当前轮`)}
      </span>}
      <span className={styles.grow} />
      <span className={styles.chevron} aria-hidden="true">
        {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
      </span>
    </button>
    {!collapsed && <>
      <div className={styles.list}>
        {rows.map(row => <QueueRow key={row.id} row={row} sessionId={sessionId} />)}
      </div>
      <div className={styles.foot}>
        <button type="button" className={styles.clear} disabled={!clearable}
          onClick={() => {
            const queue = useSendQueue.getState();
            if (queue.clearDrafts(sessionId)) queue.drain(sessionId);
          }}>
          {text("Clear all", "全部清除")}
        </button>
      </div>
    </>}
  </section>;
}
