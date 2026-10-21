"use client";

/**
 * /context 面板：当前会话的输入 token 构成，两层。
 *
 * 总览：总占用、一根分段条、四类（系统提示 / 工具 / 记忆 / 对话）。
 * 点一类（或分段条上那一段）进入它的详情：这一类自己的分段条和子项，
 * 子项展开看实际发出去的原文；对话详情里的消息点击后跳到聊天中那一条。
 *
 * Snapshot is warmed when the session is focused. This panel never shows
 * a loading spinner — it paints cache (or zeros) immediately.
 */
import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronRight, FoldVertical } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { HoverTip } from "@/components/ui/tooltip";
import { useSessionStore } from "@/lib/session-store";
import { getSocket } from "@/lib/runtime-bridge/state";
import {
  readContextBreakdownCache,
  subscribeContextBreakdownCache,
  type ContextBreakdown as Breakdown,
} from "@/lib/chat/context-breakdown-cache";

interface Props {
  sessionId: string | null;
  /** 当前分支头（DAG 选中的分支）。传入则按该分支算上下文；切分支时变化
   *  会触发重新拉取。缺省时后端回退会话全局 head。*/
  headId?: string | null;
  /** Closes the panel; a message row uses it before jumping to the message. */
  onClose?: () => void;
}

type Text = (en: string, zh: string) => string;

function fmt(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(Math.round(n));
}

function pct(part: number, whole: number): string {
  return whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : "0%";
}

/** One line of a detail view; ``text`` makes it expandable, ``onOpen``
 *  makes it a link. */
interface Item {
  key: string;
  label: string;
  tokens: number;
  hint?: string;
  text?: string;
  onOpen?: () => void;
}

interface Group {
  key: string;
  title?: string;
  items: Item[];
}

interface Category {
  key: "system" | "tools" | "memory" | "messages" | "unclassified";
  label: string;
  tokens: number;
  color: string;
  groups: Group[];
}

/** Names of the system prompt's components (context/components.py). A
 *  component a plugin registers shows under its own name. */
function systemSectionLabel(name: string, text: Text): string {
  switch (name) {
    case "base": return text("Base prompt", "基础提示词");
    case "output_style": return text("Output style", "输出风格");
    case "inline_prompt": return text("Agent system prompt", "Agent 系统提示");
    case "environment": return text("Environment", "环境");
    case "agents_md": return "AGENTS.md";
    case "capabilities": return text("Workflows and tool notes", "工作流与工具说明");
    case "skills": return text("Skills index", "技能索引");
    case "current_date": return text("Date", "日期");
    case "plan_mode": return text("Plan mode", "计划模式");
    case "other": return text("Other", "其他");
    default: return name;
  }
}

function messageKindLabel(kind: string, text: Text): string {
  switch (kind) {
    case "user": return text("Your messages", "你的消息");
    case "assistant": return text("Replies, thinking and tool calls", "回复、思考与工具调用");
    case "summary": return text("Compaction summary", "压缩摘要");
    default: return text("Other", "其他");
  }
}

/** Scroll the transcript to a message and flash it. */
function revealMessage(id: string): void {
  const esc = typeof window.CSS?.escape === "function" ? CSS.escape(id) : id;
  const el = document.querySelector<HTMLElement>(
    `[data-msg-id="${esc}"], [data-msg-ids~="${esc}"]`,
  );
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("dag-flash");
  window.setTimeout(() => el.classList.remove("dag-flash"), 1400);
}

function buildCategories(d: Breakdown, text: Text, onReveal: (id: string) => void): Category[] {
  const systemItems: Item[] = [];
  for (const row of d.system_detail || []) {
    systemItems.push({
      key: row.name, label: systemSectionLabel(row.name, text),
      tokens: row.tokens, text: row.text,
    });
    if (row.name === "capabilities" && (d.skills || 0) > 0) {
      systemItems.push(skillsItem(d, text));
    }
  }
  if ((d.skills || 0) > 0 && !systemItems.some((item) => item.key === "skills")) {
    systemItems.push(skillsItem(d, text));
  }

  const mcpNames = new Set((d.mcp_detail || []).map((row) => row.name));
  const builtin = (d.tools || []).filter((row) => !mcpNames.has(row.name));
  const toolItem = (row: { name: string; tokens: number; description?: string }): Item => ({
    key: row.name, label: row.name, tokens: row.tokens, text: row.description,
  });
  const byTokens = (a: Item, b: Item) => b.tokens - a.tokens;
  const toolGroups: Group[] = [
    { key: "loaded", title: text("Loaded", "已加载"),
      items: builtin.filter((r) => !r.deferred).map(toolItem).sort(byTokens) },
    { key: "deferred", title: text("Loaded on demand (names only)", "按需加载（只发名字）"),
      items: builtin.filter((r) => r.deferred).map(toolItem).sort(byTokens) },
    { key: "mcp", title: "MCP",
      items: (d.mcp_detail || []).map((row) => ({
        ...toolItem(row),
        hint: [row.server, row.deferred ? text("on demand", "按需") : ""]
          .filter(Boolean).join(" · "),
      })).sort(byTokens) },
  ];

  const messages = d.messages_detail;
  const messageGroups: Group[] = [
    { key: "kinds", items: (messages?.groups || []).map((g) => ({
      key: g.kind, label: messageKindLabel(g.kind, text), tokens: g.tokens,
      hint: text(`${g.count} messages`, `${g.count} 条`),
    })) },
    { key: "top", title: text("Largest messages", "最大的消息"),
      items: (messages?.top || []).map((m) => ({
        key: m.id, label: m.preview || m.id, tokens: m.tokens,
        hint: messageKindLabel(m.kind, text), onOpen: () => onReveal(m.id),
      })) },
  ];

  return [
    { key: "system", label: text("System prompt", "系统提示"),
      tokens: (d.system_prompt || 0) + (d.skills || 0),
      color: "var(--context-system-prompt)", groups: [{ key: "all", items: systemItems }] },
    { key: "tools", label: text("Tools", "工具"),
      tokens: (d.tools_schema || 0) + (d.tools_deferred_catalog || 0)
        + (d.mcp_tools || 0) + (d.mcp_tools_deferred || 0),
      color: "var(--context-system-tools)", groups: toolGroups },
    { key: "memory", label: text("Memory", "记忆"), tokens: d.memory || 0,
      color: "var(--context-memory)",
      groups: [{ key: "files", items: (d.memory_detail || []).map((row) => ({
        key: row.path, label: row.path, tokens: row.tokens, text: row.text,
      })) }] },
    { key: "messages", label: text("Conversation", "对话"), tokens: d.messages || 0,
      color: "var(--context-messages)", groups: messageGroups },
    { key: "unclassified", label: text("Unclassified", "未归类"),
      tokens: d.unclassified || 0, color: "var(--context-other)", groups: [] },
  ];
}

function skillsItem(d: Breakdown, text: Text): Item {
  const names = (d.skills_detail || []).map((s) => s.name);
  return {
    key: "skills", label: systemSectionLabel("skills", text), tokens: d.skills || 0,
    hint: names.length ? text(`${names.length} skills`, `${names.length} 个`) : undefined,
    text: names.length ? names.join("\n") : undefined,
  };
}

/** Stacked meter; ``onPick`` makes each segment a button. */
function StackedBar({
  segments,
  total,
  hovered,
  onHover,
  onPick,
}: {
  segments: { key: string; label: string; tokens: number; color: string }[];
  total: number;
  hovered: string | null;
  onHover: (key: string | null) => void;
  onPick?: (key: string) => void;
}) {
  let offset = 0;
  return (
    <div className="relative h-[12px] w-full" onPointerLeave={() => onHover(null)}>
      <span
        className="absolute inset-x-0 top-[3px] h-[6px] rounded-full"
        style={{ background: "var(--usage-track)" }}
      />
      {segments.map((segment) => {
        if (segment.tokens <= 0 || total <= 0) return null;
        const left = (offset / total) * 100;
        offset += segment.tokens;
        const active = hovered === segment.key;
        return (
          <span
            key={segment.key}
            role={onPick ? "button" : undefined}
            aria-label={`${segment.label}: ${fmt(segment.tokens)}`}
            className="absolute transition-[top,height] duration-150"
            style={{
              left: `${left}%`,
              width: `${(segment.tokens / total) * 100}%`,
              minWidth: 2,
              top: active ? 0 : 3,
              height: active ? 12 : 6,
              background: segment.color,
              zIndex: active ? 2 : 1,
              cursor: onPick ? "pointer" : undefined,
            }}
            onPointerEnter={() => onHover(segment.key)}
            onClick={onPick ? () => onPick(segment.key) : undefined}
          />
        );
      })}
    </div>
  );
}

function Swatch({ color }: { color: string }) {
  return (
    <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: color }} />
  );
}

function shade(color: string, index: number): string {
  const strength = Math.max(35, 100 - index * 16);
  return `color-mix(in srgb, ${color} ${strength}%, var(--usage-track))`;
}

function ItemRow({
  item,
  color,
  open,
  onToggle,
  hovered,
  onHover,
}: {
  item: Item;
  color?: string;
  open: boolean;
  onToggle: () => void;
  hovered: boolean;
  onHover: (on: boolean) => void;
}) {
  const expandable = Boolean(item.text);
  const clickable = expandable || Boolean(item.onOpen);
  const Tag = clickable ? "button" : "div";
  return (
    <div className="rounded-[6px]" style={{ background: hovered || open ? "var(--bg-hover)" : undefined }}>
      <Tag
        type={clickable ? "button" : undefined}
        onClick={item.onOpen ?? (expandable ? onToggle : undefined)}
        onPointerEnter={() => onHover(true)}
        onPointerLeave={() => onHover(false)}
        className="flex w-full min-w-0 items-center gap-2 px-1.5 py-[5px] text-left text-[12px]"
        style={{ color: "var(--text-primary)", cursor: clickable ? "pointer" : "default" }}
      >
        {color && <Swatch color={color} />}
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {item.hint && (
          <span className="shrink-0 text-[11px]" style={{ color: "var(--text-muted)" }}>
            {item.hint}
          </span>
        )}
        <span className="shrink-0 tabular-nums" style={{ color: "var(--text-muted)" }}>
          {fmt(item.tokens)}
        </span>
        <span className="w-3 shrink-0" style={{ color: "var(--text-muted)" }}>
          {expandable && (open
            ? <ChevronDown className="h-3 w-3" />
            : <ChevronRight className="h-3 w-3" />)}
        </span>
      </Tag>
      {expandable && open && (
        <pre
          className="scroll-overlay mx-1.5 mb-1.5 max-h-[220px] overflow-auto whitespace-pre-wrap break-words rounded-[6px] px-2 py-1.5 font-mono text-[11px] leading-[1.5]"
          style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)" }}
        >
          {item.text}
        </pre>
      )}
    </div>
  );
}

export function ContextBreakdownPanel({ sessionId, headId, onClose }: Props) {
  const { text } = useTranslation();
  const ringUsed = useSessionStore((s) =>
    sessionId ? s.tokens[sessionId]?.total_used : undefined,
  );
  const ringBasis = useSessionStore((s) =>
    sessionId ? s.tokens[sessionId]?.basis : undefined,
  );
  const lastMeasured = useSessionStore((s) =>
    sessionId ? s.tokens[sessionId]?.context : undefined,
  );
  const ringWindow = useSessionStore((s) =>
    sessionId ? s.contextWindow[sessionId] : undefined,
  );
  const compacting = useSessionStore((s) =>
    Boolean(sessionId && s.compactionUi[sessionId]?.running),
  );
  const recentlyCompacted = useSessionStore((s) => {
    if (!sessionId) return false;
    const order = s.messageOrder[sessionId] || [];
    let hasNewMessage = false;
    for (let i = order.length - 1; i >= 0; i -= 1) {
      const message = s.messagesById[order[i]];
      if (!message) continue;
      if (message.role === "user" || message.role === "assistant") {
        hasNewMessage = true;
        continue;
      }
      if (message.kind !== "compaction" || message.slot === "card") continue;
      if (message.id.startsWith("compaction_failed_")) return false;
      const completed = message.slot === "event"
        || message.id.startsWith("compaction_finished_")
        || (
          message.id.startsWith("compaction_started_")
          && !s.compactionUi[sessionId]?.running
        );
      return completed && !hasNewMessage;
    }
    return false;
  });
  const canCompact = Boolean(sessionId) && !compacting && !recentlyCompacted;
  const [data, setData] = useState<Breakdown | null>(() =>
    readContextBreakdownCache(sessionId, headId),
  );
  const [view, setView] = useState<Category["key"] | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => {
      const cached = readContextBreakdownCache(sessionId, headId);
      if (cached) {
        setData(cached);
        return;
      }
      if (ringUsed != null || ringWindow) {
        setData({
          total_used: ringUsed,
          window: ringWindow,
          context_window: ringWindow,
          basis: ringBasis ?? undefined,
        });
      }
    };
    sync();
    return subscribeContextBreakdownCache(sync);
  }, [sessionId, headId, ringUsed, ringWindow, ringBasis]);

  // 窗口和总占用都用服务端 stats 里的那一份（圆环读的同一个字段）。
  // 分项仍是本次现场算出的 breakdown —— 明细可以是估算，但顶部的总数
  // 必须和圆环同源。
  const win = data?.window || data?.context_window || 0;

  const totalUsed = data?.total_used ?? win - (data?.free_space ?? 0);
  const usedPct = win > 0 ? Math.min(1, totalUsed / win) : 0;

  const categories = useMemo(
    () => buildCategories(data ?? ({} as Breakdown), text, (id) => {
      onClose?.();
      window.setTimeout(() => revealMessage(id), 60);
    }),
    [data, text, onClose],
  );
  const shown = categories.filter((c) => c.tokens > 0 || c.key !== "unclassified");
  const current = view ? categories.find((c) => c.key === view) ?? null : null;

  const openView = (key: string) => {
    const target = categories.find((c) => c.key === key);
    if (!target || target.key === "unclassified") return;
    setView(target.key);
    setHovered(null);
    setExpanded({});
  };

  const compact = () => {
    if (!sessionId || !canCompact) return;
    const sock = getSocket();
    if (sock && sock.readyState === WebSocket.OPEN) {
      sock.send(JSON.stringify({ action: "compact", session_id: sessionId }));
    }
  };
  // Quiet footer action: text-only until hovered, muted while unavailable.
  const compactButton = (
    <button
      type="button"
      aria-disabled={!canCompact}
      aria-busy={compacting}
      onClick={compact}
      className={"inline-flex items-center gap-1 rounded-[6px] px-1.5 py-[3px] text-[11px] transition-colors"
        + (canCompact ? " hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]" : "")}
      style={{
        color: "var(--text-muted)",
        cursor: canCompact ? "pointer" : "default",
        opacity: canCompact ? 1 : 0.55,
      }}
    >
      <FoldVertical className="h-3 w-3" />
      {compacting ? text("Compacting…", "正在压缩…") : text("Compact", "压缩")}
    </button>
  );

  return (
    <div
      className="context-breakdown-panel flex max-h-[70vh] w-[380px] flex-col overflow-hidden"
      style={{
        // Grammar C 卡片：白卡 + 10px 圆角（=输入框刻度）+ 真 border
        // + 投影——弹层统一配方。
        background: "var(--surface-popover)",
        borderRadius: 10,
        border: "1px solid var(--border-popover)",
        boxShadow: "var(--shadow-popover)",
      }}
    >
      <div
        className="scroll-overlay min-h-0 flex-1 overflow-y-auto"
        style={{ padding: "12px 14px" }}
      >
        {data?.error ? (
          <div className="p-4 text-[12px]" style={{ color: "var(--accent-red)" }}>
            {data.error}
          </div>
        ) : current ? (
          <>
            <div className="mb-[10px] flex items-center gap-2">
              <button
                type="button"
                aria-label={text("Back", "返回")}
                onClick={() => { setView(null); setHovered(null); }}
                className="-ml-1 rounded-[6px] p-1 hover:bg-[var(--bg-hover)]"
                style={{ color: "var(--text-secondary)" }}
              >
                <ArrowLeft className="h-3.5 w-3.5" />
              </button>
              <Swatch color={current.color} />
              <span className="flex-1 text-[13px] font-medium" style={{ color: "var(--text-bright)" }}>
                {current.label}
              </span>
              <span className="text-[12px] tabular-nums" style={{ color: "var(--text-muted)" }}>
                {fmt(current.tokens)} · {pct(current.tokens, totalUsed)}
              </span>
            </div>
            {(() => {
              const top = current.groups[0]?.items ?? [];
              const segments = (current.key === "tools"
                ? current.groups.map((g, i) => ({
                  key: g.key, label: g.title || g.key,
                  tokens: g.items.reduce((sum, item) => sum + item.tokens, 0),
                  color: shade(current.color, i * 2),
                }))
                : top.map((item, i) => ({
                  key: item.key, label: item.label, tokens: item.tokens,
                  color: shade(current.color, i),
                })));
              const total = segments.reduce((sum, seg) => sum + seg.tokens, 0);
              return total > 0 && current.key !== "messages" ? (
                <div className="mb-2">
                  <StackedBar segments={segments} total={total} hovered={hovered} onHover={setHovered} />
                </div>
              ) : null;
            })()}
            {current.groups.every((g) => g.items.length === 0) && (
              <div className="py-3 text-center text-[12px]" style={{ color: "var(--text-muted)" }}>
                {text("Nothing recorded for this part yet.", "这一部分还没有记录。")}
              </div>
            )}
            {current.groups.map((group, gi) => group.items.length > 0 && (
              <div key={group.key} className={gi > 0 ? "mt-3" : undefined}>
                {group.title && (
                  <div className="mb-1 flex items-baseline justify-between px-1.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
                    <span>{group.title}</span>
                    <span className="tabular-nums">
                      {fmt(group.items.reduce((sum, item) => sum + item.tokens, 0))}
                    </span>
                  </div>
                )}
                {group.items.map((item, i) => {
                  const id = `${group.key}/${item.key}`;
                  return (
                    <ItemRow
                      key={id}
                      item={item}
                      color={current.key === "tools" || group.key === "top"
                        ? undefined
                        : shade(current.color, i)}
                      open={Boolean(expanded[id])}
                      onToggle={() => setExpanded((e) => ({ ...e, [id]: !e[id] }))}
                      hovered={hovered === item.key || hovered === group.key}
                      onHover={(on) => setHovered(on ? item.key : null)}
                    />
                  );
                })}
              </div>
            ))}
          </>
        ) : (
          <>
            {/* 标题行 —— Claude grammar C：muted 维度名 + 右对齐 BRIGHT 总量。*/}
            <div className="mb-[10px] flex items-baseline justify-between">
              <span className="text-[13px]" style={{ color: "var(--text-muted)" }}>
                {text("Context window", "上下文窗口")}
                {/* 和圆环 tooltip 同一个标记：估算值标 est.，实测不标。*/}
                {data?.basis === "estimated" && (
                  <span className="ml-1 text-[11px]">{text("(est.)", "（估算）")}</span>
                )}
              </span>
              <span className="text-[13px] font-medium" style={{ color: "var(--text-bright)" }}>
                {fmt(totalUsed)} / {fmt(win)} ({(usedPct * 100).toFixed(1)}%)
              </span>
            </div>
            {data?.basis === "estimated" && Boolean(lastMeasured) && (
              <div className="mb-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
                {text("Last request measured", "上次请求实测")} {fmt(lastMeasured || 0)}
              </div>
            )}
            <StackedBar
              segments={[
                ...shown,
                { key: "free", label: text("Free space", "剩余空间"),
                  tokens: Math.max(0, win - totalUsed), color: "transparent" },
              ]}
              total={Math.max(win, totalUsed)}
              hovered={hovered}
              onHover={setHovered}
              onPick={openView}
            />
            <div className="mt-3 space-y-[2px]">
              {shown.map((category) => {
                const clickable = category.key !== "unclassified";
                return (
                  <button
                    key={category.key}
                    type="button"
                    onClick={() => openView(category.key)}
                    onPointerEnter={() => setHovered(category.key)}
                    onPointerLeave={() => setHovered(null)}
                    data-tip={clickable ? undefined : text(
                      "The difference between the total input usage and locally classified estimates. It can change after a request or compaction.",
                      "总输入用量与本地分类估算之和的差额。请求完成或压缩后，这个差额可能变化。",
                    )}
                    className="flex w-full items-center gap-2 rounded-[6px] px-1.5 py-[6px] text-left text-[12px]"
                    style={{
                      background: hovered === category.key ? "var(--bg-hover)" : undefined,
                      color: category.tokens > 0 ? "var(--text-primary)" : "var(--text-muted)",
                      cursor: clickable ? "pointer" : "default",
                    }}
                  >
                    <Swatch color={category.color} />
                    <span className="flex-1">{category.label}</span>
                    <span className="tabular-nums" style={{ color: "var(--text-muted)" }}>
                      {fmt(category.tokens)} · {pct(category.tokens, totalUsed)}
                    </span>
                    <span className="w-3 shrink-0" style={{ color: "var(--text-muted)" }}>
                      {clickable && <ChevronRight className="h-3 w-3" />}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
      {!data?.error && !current && (
        <div className="flex shrink-0 justify-end" style={{ padding: "0 10px 8px" }}>
          {recentlyCompacted ? (
            <HoverTip label={text("Recently compacted", "最近已压缩")}>
              <span className="inline-flex">{compactButton}</span>
            </HoverTip>
          ) : compactButton}
        </div>
      )}
    </div>
  );
}
