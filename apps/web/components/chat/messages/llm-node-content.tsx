"use client";

/**
 * Ordered chat-like content for a nested LLM DAG node.
 * Reuses markdown / thinking fold / function-row visuals.
 * tool_ref rows point at real tree children — no duplicated tool results.
 */
import { memo, useMemo, useState } from "react";
import { useExecutionStreamStore } from "@/lib/execution-stream/store";
import type { StreamAttempt, StreamBlock } from "@/lib/execution-stream/types";
import { useTranslation } from "@/lib/i18n";
import { useSessionStore, type DetailNode } from "@/lib/session-store";
import { renderMarkdown, useMarkdownReady } from "./markdown";
import type { TNode } from "./tree-types";

function findChild(root: TNode | undefined, id: string | undefined): TNode | undefined {
  if (!root || !id) return undefined;
  const stack: TNode[] = [root];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.path === id || n.name === id) return n;
    for (const c of n.children || []) stack.push(c);
  }
  return undefined;
}

function MarkdownBody({ text, running }: { text: string; running?: boolean }) {
  useMarkdownReady();
  if (!text) return null;
  return (
    <div
      className={"llm-nc-md chat-text" + (running ? " is-running" : "")}
      style={{ whiteSpace: "normal", fontFamily: "inherit" }}
      dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
    />
  );
}

function ThinkingFold({ text, running }: { text: string; running?: boolean }) {
  const { text: tr } = useTranslation();
  const [open, setOpen] = useState(false);
  if (!text) return null;
  const preview = text.trim().split("\n").filter(Boolean).slice(-1)[0] || text;
  return (
    <div className="llm-nc-think">
      <button type="button" className="llm-nc-think-h" onClick={() => setOpen((v) => !v)}>
        <span>{tr("Thinking", "思考摘要")}</span>
        <span className="llm-nc-muted">
          {running ? tr("streaming…", "生成中…") : open ? "▾" : "▸"}
        </span>
      </button>
      {open ? (
        <div className="llm-nc-think-b">{text}</div>
      ) : (
        <div className="llm-nc-think-preview">{preview.slice(0, 120)}</div>
      )}
    </div>
  );
}

function ToolRefRow({
  block,
  treeRoot,
}: {
  block: StreamBlock;
  treeRoot?: TNode;
}) {
  const { text: tr } = useTranslation();
  const [open, setOpen] = useState(false);
  const child = findChild(treeRoot, block.ref_node_id)
    || findChild(treeRoot, block.tool_call_id);
  const name = block.tool_name || child?.name || block.tool_call_id || "tool";
  const status = child?.status
    || (block.status === "finished" ? "completed" : "running");
  const running = status === "running" || status === "pending";
  const err = status === "error" || !!child?.error;

  function openDetail(e: React.MouseEvent) {
    e.stopPropagation();
    if (!child && !block.ref_node_id) return;
    const detail: DetailNode = {
      path: child?.path || block.ref_node_id || block.tool_call_id || name,
      name,
      status: status || "completed",
      params: child?.params,
      output: child?.output ?? child?.raw_reply,
      error: child?.error,
      node_type: child?.node_type,
      duration_ms: child?.duration_ms,
    };
    useSessionStore.getState().showDetail(detail);
  }

  return (
    <div className={"llm-nc-tool" + (err ? " is-error" : "")}>
      <div className="llm-nc-tool-h">
        <button type="button" className="llm-nc-tool-toggle" onClick={() => setOpen((v) => !v)}>
          <span className="llm-nc-tool-name">{open ? "▾" : "▸"} {name}</span>
        </button>
        <button type="button" className="llm-nc-link" onClick={openDetail}>
          {running ? tr("running…", "执行中") : err ? tr("error", "错误") : tr("done", "已完成")}
        </button>
      </div>
      {open ? (
        <div className="llm-nc-tool-b">
          {child?.params ? (
            <pre className="llm-nc-pre">{JSON.stringify(
              Object.fromEntries(
                Object.entries(child.params).filter(([k]) => k !== "runtime" && k !== "callback"),
              ),
              null,
              2,
            )}</pre>
          ) : (
            <div className="llm-nc-muted">{tr("Parameters on execution node", "参数见执行节点")}</div>
          )}
          {child?.error ? (
            <div className="llm-nc-err">{String(child.error)}</div>
          ) : child?.output != null ? (
            <pre className="llm-nc-pre">{typeof child.output === "string"
              ? child.output
              : JSON.stringify(child.output, null, 2)}</pre>
          ) : running ? (
            <div className="llm-nc-muted">{tr("Waiting for result…", "等待结果…")}</div>
          ) : null}
          {(child?.children || []).map((c, i) => (
            <div key={c.path || i} className="llm-nc-nested">
              {(c.node_type === "exec" || c.name === "LLM") ? (
                <LlmNodeContent nodeId={c.path} treeRoot={c} compact />
              ) : (
                <div className="llm-nc-muted">{c.name || c.node_type}</div>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function groupBlocks(blocks: StreamBlock[]): Array<
  | { type: "single"; block: StreamBlock }
  | { type: "parallel"; groupId: string; blocks: StreamBlock[] }
> {
  const out: Array<
    | { type: "single"; block: StreamBlock }
    | { type: "parallel"; groupId: string; blocks: StreamBlock[] }
  > = [];
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    if (b.kind === "tool_ref" && b.group_id) {
      const gid = b.group_id;
      const batch: StreamBlock[] = [];
      while (i < blocks.length && blocks[i].kind === "tool_ref" && blocks[i].group_id === gid) {
        batch.push(blocks[i]);
        i += 1;
      }
      if (batch.length > 1) out.push({ type: "parallel", groupId: gid, blocks: batch });
      else out.push({ type: "single", block: batch[0] });
      continue;
    }
    out.push({ type: "single", block: b });
    i += 1;
  }
  return out;
}

function AttemptBody({
  attempt,
  treeRoot,
}: {
  attempt: StreamAttempt;
  treeRoot?: TNode;
}) {
  const { text: tr } = useTranslation();
  const blocks = [...(attempt.blocks || [])].sort(
    (a, b) => (a.block_index ?? 0) - (b.block_index ?? 0),
  );
  const grouped = groupBlocks(blocks);
  if (!grouped.length) {
    return <div className="llm-nc-muted">{tr("No content yet", "暂无内容")}</div>;
  }
  return (
    <div className="llm-nc-attempt">
      {grouped.map((item, idx) => {
        if (item.type === "parallel") {
          return (
            <div key={item.groupId || idx} className="llm-nc-par">
              <div className="llm-nc-par-t">
                {tr("Parallel calls", "并行调用")} · {item.blocks.length}
              </div>
              {item.blocks.map((b) => (
                <ToolRefRow key={b.block_id} block={b} treeRoot={treeRoot} />
              ))}
            </div>
          );
        }
        const b = item.block;
        if (b.kind === "reasoning_summary") {
          if (b.omitted_by_policy) {
            return (
              <div key={b.block_id} className="llm-nc-muted">
                {tr("Thinking not saved", "此思考内容未保存")}
              </div>
            );
          }
          return (
            <ThinkingFold
              key={b.block_id}
              text={b.content || ""}
              running={b.status === "running"}
            />
          );
        }
        if (b.kind === "text") {
          return (
            <MarkdownBody
              key={b.block_id}
              text={b.content || ""}
              running={b.status === "running"}
            />
          );
        }
        if (b.kind === "tool_ref") {
          return <ToolRefRow key={b.block_id} block={b} treeRoot={treeRoot} />;
        }
        if (b.kind === "refusal") {
          return (
            <div key={b.block_id} className="llm-nc-err">
              {b.content || tr("Model refused", "模型拒绝")}
            </div>
          );
        }
        // tool_arguments / unsupported: skip or muted
        return null;
      })}
    </div>
  );
}

export const LlmNodeContent = memo(function LlmNodeContent({
  nodeId,
  treeRoot,
  fallbackText,
  fallbackThinking,
  compact,
}: {
  nodeId?: string;
  treeRoot?: TNode;
  fallbackText?: string | null;
  fallbackThinking?: string | null;
  compact?: boolean;
}) {
  const { text: tr } = useTranslation();
  const stream = useExecutionStreamStore((s) =>
    nodeId ? s.getByNodeId(nodeId) : undefined,
  );

  const selected = useMemo(() => {
    if (!stream) return null;
    const id = stream.selected_attempt_id || stream.current_attempt_id;
    return (
      stream.attempts.find((a) => a.attempt_id === id)
      || stream.attempts[stream.attempts.length - 1]
      || null
    );
  }, [stream]);

  const older = useMemo(() => {
    if (!stream || !selected) return [];
    return stream.attempts.filter((a) => a.attempt_id !== selected.attempt_id);
  }, [stream, selected]);

  if (!stream || !selected || selected.blocks.length === 0) {
    // Fallback for nodes without live stream (closed before protocol / legacy).
    return (
      <div className={"llm-nc" + (compact ? " is-compact" : "")}>
        {fallbackThinking ? <ThinkingFold text={fallbackThinking} /> : null}
        {fallbackText ? <MarkdownBody text={fallbackText} /> : (
          !fallbackThinking ? (
            <div className="llm-nc-muted">{tr("No text output", "无文本输出")}</div>
          ) : null
        )}
      </div>
    );
  }

  return (
    <div className={"llm-nc" + (compact ? " is-compact" : "")}>
      {older.map((a) => (
        <details key={a.attempt_id} className="llm-nc-old">
          <summary>
            {tr("Earlier attempt", "更早尝试")} #{a.attempt_index + 1}
            {a.reason ? ` · ${a.reason}` : ""} · {a.status}
          </summary>
          <AttemptBody attempt={a} treeRoot={treeRoot} />
        </details>
      ))}
      <AttemptBody attempt={selected} treeRoot={treeRoot} />
    </div>
  );
});
