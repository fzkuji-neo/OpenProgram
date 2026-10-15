"use client";

/**
 * Sub-agents card: the agents this turn spawned, one tab each. A tab opens
 * that agent's own conversation (its prompt, steps and replies, live while
 * it runs) inside the card, so the turn's transcript keeps only its own
 * reply. Same raised surface as the file-change and error cards.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  type AnimatedNavIconHandle,
  ArrowUpRightIcon,
} from "@/components/animated-icons";
import { SolarIcon } from "@/components/solar-icons";
import { buttonVariants } from "@/components/ui/button";
import {
  agentJobFor,
  loadSubAgentTranscript,
  promptBody,
  subAgentChatKey,
} from "@/lib/chat/sub-agent-transcripts";
import type { ExecutionCommand } from "@/lib/execution/execution-debugger";
import { useTranslation } from "@/lib/i18n";
import { sendRuntimeCommand } from "@/lib/runtime-bridge/session-load";
import { useSessionStore, type ChatMsg } from "@/lib/session-store";
import { cn } from "@/lib/utils";

import { AssistantBubble } from "./assistant-bubble";

const LIVE = new Set(["running", "pending", "queued"]);
const TERMINAL = new Set(["completed", "errored", "failed", "cancelled"]);

/** Commands go out as they are; a `load_session` goes through the managed
 *  session read, since the transcript applies only the reply to a read it
 *  registered. */
function wsSend(payload: unknown): void {
  sendRuntimeCommand(payload);
}

type Agent = {
  card: ChatMsg;
  key: string;
  jobId?: string;
  headId?: string;
  name: string;
  status: string;
};

function agentsOf(cards: ChatMsg[], fallbackName: string): Agent[] {
  return cards.map((card) => {
    const attach = card.attach || {};
    const jobId = attach.job_id || undefined;
    const headId = attach.head_id || undefined;
    return {
      card,
      key: jobId || headId || card.id,
      jobId,
      headId,
      name: (attach.label || "").trim() || (headId || "").slice(0, 8) || fallbackName,
      status: attach.status || "completed",
    };
  });
}

function StatusDot({ status }: { status: string }) {
  const tone = LIVE.has(status) || status === "cancelling"
    ? "--neutral pulse-opacity"
    : status === "errored" || status === "failed"
      ? "--err"
      : status === "cancelled" ? "is-cancelled" : "--ok";
  return <span className={`indicator-dot sm ${tone}`} aria-hidden="true" />;
}

function PromptTurn({ msg }: { msg: ChatMsg }) {
  const { text } = useTranslation();
  const [open, setOpen] = useState(false);
  const prompt = promptBody(msg.content || "");
  if (!prompt.text) return null;
  return (
    <button
      type="button"
      className="sub-agent-prompt"
      data-open={open ? "1" : "0"}
      aria-expanded={open}
      onClick={() => setOpen((value) => !value)}
    >
      <span className="sub-agent-prompt-label">
        {prompt.message ? text("Message", "消息") : text("Task", "任务")}
      </span>
      <span className="sub-agent-prompt-text">{prompt.text}</span>
    </button>
  );
}

function Turn({ id, sessionId }: { id: string; sessionId: string }) {
  const msg = useSessionStore((s) => s.messagesById[id]);
  if (!msg) return null;
  if (msg.role === "user") return <PromptTurn msg={msg} />;
  return <AssistantBubble msg={msg} sessionIdOverride={sessionId} embedded />;
}

function Transcript({ agent, sessionId, onTip }: {
  agent: Agent;
  sessionId: string;
  onTip: (key: string, tip: string) => void;
}) {
  const { text } = useTranslation();
  const chatKey = subAgentChatKey(sessionId, agent.key);
  const order = useSessionStore((s) => s.messageOrder[chatKey]);
  const [loading, setLoading] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  // A running agent opens at its newest output; a finished one at its task.
  const followRef = useRef(LIVE.has(agent.status));
  const { jobId, headId, key } = agent;

  useEffect(() => {
    let live = true;
    const load = () => {
      setLoading(true);
      void loadSubAgentTranscript(sessionId, key, { jobId, headId })
        .then((tip) => { if (live && tip) onTip(key, tip); })
        .finally(() => { if (live) setLoading(false); });
    };
    load();
    // A finished turn of this agent (its first one, or a later message sent
    // to it) is now on the server; read the branch again.
    const onStatus = (event: WindowEventMap["op:job-status"]) => {
      const detail = event.detail;
      if (!detail?.job_id || detail.session_id !== sessionId) return;
      if (!TERMINAL.has(detail.status || "")) return;
      if (agentJobFor(detail.job_id) === key) load();
    };
    window.addEventListener("op:job-status", onStatus);
    return () => {
      live = false;
      window.removeEventListener("op:job-status", onStatus);
    };
  }, [sessionId, key, jobId, headId, onTip]);

  // Stay at the newest output while it streams, unless the reader scrolled up.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body || typeof ResizeObserver === "undefined") return;
    const content = body.firstElementChild;
    if (!content) return;
    const observer = new ResizeObserver(() => {
      if (followRef.current) body.scrollTop = body.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [chatKey]);

  const ids = order ?? [];
  return (
    <div
      ref={bodyRef}
      className="sub-agents-body"
      role="tabpanel"
      onScroll={(event) => {
        const body = event.currentTarget;
        followRef.current = body.scrollHeight - body.scrollTop - body.clientHeight < 24;
      }}
    >
      <div className="sub-agents-turns">
        {ids.length === 0 && agent.card.attach?.prompt ? (
          <PromptTurn msg={{ id: `${agent.card.id}_prompt`, role: "user", content: agent.card.attach.prompt }} />
        ) : null}
        {ids.map((id) => <Turn key={id} id={id} sessionId={sessionId} />)}
        {ids.length === 0 ? (
          <div className="sub-agents-empty" role="status">
            {loading
              ? text("Loading…", "加载中…")
              : LIVE.has(agent.status)
                ? text("Waiting for output…", "等待输出…")
                : text("No output.", "没有输出。")}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function SubAgentsCard({ cards, sessionId }: { cards: ChatMsg[]; sessionId: string }) {
  const { text } = useTranslation();
  const [selected, setSelected] = useState<string | null>(null);
  // Each agent's newest reply, from its loaded branch: later messages to the
  // agent move it past the head its spawn card recorded.
  const [tips, setTips] = useState<Record<string, string>>({});
  const onTip = useCallback((key: string, tip: string) => {
    setTips((value) => (value[key] === tip ? value : { ...value, [key]: tip }));
  }, []);
  const goIconRef = useRef<AnimatedNavIconHandle>(null);
  const agents = agentsOf(cards, text("Sub-agent", "子代理"));
  const current = agents.find((agent) => agent.key === selected) ?? null;

  const running = agents.filter((agent) => LIVE.has(agent.status) || agent.status === "cancelling").length;
  const failed = agents.filter((agent) => agent.status === "errored" || agent.status === "failed").length;
  const cancelled = agents.filter((agent) => agent.status === "cancelled").length;
  const done = agents.length - running - failed - cancelled;
  const note = [
    running ? text(`${running} running`, `${running} 个运行中`) : "",
    failed ? text(`${failed} failed`, `${failed} 个失败`) : "",
    cancelled ? text(`${cancelled} cancelled`, `${cancelled} 个已取消`) : "",
    done ? text(`${done} done`, `${done} 个完成`) : "",
  ].filter(Boolean).join(" · ");

  const attach = current?.card.attach;
  const cancelTarget = attach && LIVE.has(attach.status || "") && attach.execution_id
    && typeof attach.status_version === "number"
    ? { executionId: attach.execution_id, version: attach.status_version }
    : null;
  const target = current ? tips[current.key] || current.headId : undefined;

  return (
    <div className="sub-agents-card" data-open={current ? "1" : "0"}>
      <div className="sub-agents-head">
        <span className="sub-agents-logo" aria-hidden="true">
          <SolarIcon name="bot" size={18} motionPreset="none" />
        </span>
        <span className="sub-agents-title">
          {text(`${agents.length} sub-agent${agents.length === 1 ? "" : "s"}`, `${agents.length} 个子代理`)}
        </span>
        <span className="sub-agents-note">{note}</span>
        {current ? (
          <span className="sub-agents-actions">
            {cancelTarget ? (
              <button
                type="button"
                className={cn(buttonVariants({ variant: "elevated", size: "sm" }), "sub-agents-action")}
                onClick={() => wsSend({
                  type: "execution.command",
                  action: "execution.cancel",
                  command_id: crypto.randomUUID(),
                  execution_id: cancelTarget.executionId,
                  expected_version: cancelTarget.version,
                  payload: {},
                } satisfies ExecutionCommand)}
              >
                {text("Cancel", "取消")}
              </button>
            ) : null}
            {target ? (
              <button
                type="button"
                className={cn(buttonVariants({ variant: "elevated", size: "sm" }), "sub-agents-action")}
                data-tip={text(
                  "Open this agent's conversation; the banner there leads back",
                  "打开这个子代理的对话；那里的横幅可以切回来",
                )}
                onMouseEnter={() => goIconRef.current?.startAnimation?.()}
                onMouseLeave={() => goIconRef.current?.stopAnimation?.()}
                onClick={() => {
                  wsSend({ action: "checkout_branch", session_id: sessionId, head_msg_id: target });
                  wsSend({ action: "load_session", session_id: sessionId });
                }}
              >
                <span>{text("Go to agent", "进入子代理")}</span>
                <ArrowUpRightIcon ref={goIconRef} size={14} />
              </button>
            ) : null}
          </span>
        ) : null}
      </div>
      <div className="sub-agents-tabs" role="tablist" aria-label={text("Sub-agents", "子代理")}>
        {agents.map((agent) => (
          <button
            type="button"
            role="tab"
            key={agent.key}
            className="sub-agents-tab"
            aria-selected={agent.key === selected}
            onClick={() => setSelected((value) => (value === agent.key ? null : agent.key))}
          >
            <StatusDot status={agent.status} />
            <span className="sub-agents-tab-name">{agent.name}</span>
          </button>
        ))}
      </div>
      {current ? (
        <Transcript key={current.key} agent={current} sessionId={sessionId} onTip={onTip} />
      ) : null}
    </div>
  );
}
