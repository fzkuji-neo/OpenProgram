"use client";

/**
 * /chats — list of past conversations.
 *
 * Shell mirrors /programs and /memory: sticky topbar with title +
 * toolbar (search, New chat), a SecondaryRail on the left with quick
 * date / channel filters, content column on the right showing chats
 * grouped by recency.
 *
 * Data comes from the SAME source as the sidebar Recents list: the
 * session store, which the runtime-bridge keeps authoritative from the
 * `sessions_list` WS event. This page used to open a second WebSocket
 * and maintain its own summary map, which drifted from the sidebar
 * (dropped `archived` / `updated_at`, so the status filter was dead and
 * recency was computed off creation time).
 */
import { useEffect, useMemo, useState } from "react";
import styles from "./chats-page.module.css";
import { SearchInput } from "@/components/ui/search-input";
import { RailCount, RailGroupLabel, RailItem, SecondaryRail } from "@/components/ui/secondary-rail";
import { ManageEmptyState, ManageRow, managePageStyles as shared } from "@/components/ui/manage-page";
import { useTranslation, type Locale } from "@/lib/i18n";
import { parseAttachments } from "@/components/chat/messages/user-attachments";
import { formatRelativeTime } from "@/lib/format-utils/format";
import { pushPath } from "@/lib/shallow-nav";
import { useSessionStore, type ConvSummary } from "@/lib/session-store";
import { useCenterTabs } from "@/lib/tabs/center-tabs-store";
import {
  type BucketKey,
  activityTs,
  bucketIsOlder,
  bucketKey,
  bucketLabel,
  bucketSortKey,
  displayTitle,
  labelFor,
} from "@/components/sidebar/sessions-list/helpers";
import {
  ClockIcon,
  MessageCircleIcon,
} from "@/components/animated-icons";
import { SimpleSelect } from "@/components/ui/select";

type SortKey = "recent" | "oldest" | "title";
type StatusFilter = "all" | "active" | "archived";

type FilterId = "all" | "today" | "past7" | "older";

export function ChatsPage({
  embedded,
  query: queryProp,
  include,
  rail = true,
}: {
  embedded?: boolean;
  query?: string;
  /** Keep only these chats, e.g. one project's. */
  include?: (conv: ConvSummary) => boolean;
  /** The left rail of recency filters; off inside a project, where the
   *  list stays grouped by recency instead. */
  rail?: boolean;
} = {}) {
  const { t, text, locale } = useTranslation();
  // Same store the sidebar Recents list reads — one pipeline, no second
  // WebSocket. Adds / renames / deletes / archive flags land here the
  // moment the runtime-bridge processes `sessions_list`.
  const conversations = useSessionStore((s) => s.conversations);
  const [localQuery, setLocalQuery] = useState("");
  const query = queryProp !== undefined ? queryProp : localQuery;
  const setQuery = setLocalQuery;
  const [filter, setFilter] = useState<FilterId>("all");
  const [sort, setSort] = useState<SortKey>("recent");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // Bucketing is relative to "now"; pin it per render pass so every row
  // in one pass is bucketed against the same instant, and re-pin it on a
  // timer so a page left open overnight doesn't keep yesterday's rows
  // under "Today".
  const [nowTs, setNowTs] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNowTs(Math.floor(Date.now() / 1000)), 60_000);
    return () => clearInterval(id);
  }, []);

  const untitled = t("sidebar.untitled");

  // Per-bucket counts for the nav badges (always computed against the
  // search-filtered list so the counts agree with what's visible).
  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    let arr = Object.values(conversations) as ConvSummary[];
    if (include) arr = arr.filter(include);
    if (q) {
      // Match the label the row actually renders (channel brand +
      // preview fallback), not just the raw title — otherwise searching
      // for text you can see on screen returns nothing.
      arr = arr.filter((c) => labelFor(c, untitled).toLowerCase().includes(q));
    }
    if (statusFilter === "active") {
      arr = arr.filter((c) => !c.archived);
    } else if (statusFilter === "archived") {
      arr = arr.filter((c) => !!c.archived);
    }
    arr = [...arr].sort((a, b) => {
      // "recent" / "oldest" follow last activity, like the sidebar's
      // recency sort — a conversation you replied in today is recent
      // even if it was created months ago.
      if (sort === "recent") return activityTs(b) - activityTs(a);
      if (sort === "oldest") return activityTs(a) - activityTs(b);
      return labelFor(a, untitled).localeCompare(labelFor(b, untitled));
    });
    return arr;
  }, [conversations, include, query, statusFilter, sort, untitled]);

  const counts = useMemo(() => {
    const c: Record<FilterId, number> = { all: searched.length, today: 0, past7: 0, older: 0 };
    for (const x of searched) {
      const k = bucketKey(activityTs(x), nowTs);
      c[bucketIsOlder(k) ? "older" : (k as FilterId)]++;
    }
    return c;
  }, [searched, nowTs]);

  // Apply the active filter on top of the searched list.
  const items = useMemo(() => {
    if (filter === "all") return searched;
    return searched.filter((c) => {
      const k = bucketKey(activityTs(c), nowTs);
      return filter === "older" ? bucketIsOlder(k) : k === filter;
    });
  }, [searched, filter, nowTs]);

  // Group items by recency bucket when showing "All" so the user gets
  // visual date headers — same shape as Functions' category sections.
  const grouped = useMemo(() => {
    if (filter !== "all") return null;
    const out = new Map<BucketKey, ConvSummary[]>();
    for (const c of items) {
      const b = bucketKey(activityTs(c), nowTs);
      if (!out.has(b)) out.set(b, []);
      out.get(b)!.push(c);
    }
    return Array.from(out.entries()).sort((a, b) =>
      bucketSortKey(a[0]).localeCompare(bucketSortKey(b[0])),
    );
  }, [items, filter, nowTs]);

  // Same open path as the sidebar's switchTo: focus-or-create the
  // session's center tab, THEN navigate. Navigating alone left the chat
  // with no tab when the user had closed it, so /s/<id> rendered empty.
  function openChat(c: ConvSummary) {
    useCenterTabs.getState().openSessionTab(c.id, labelFor(c, untitled));
    pushPath(`/s/${c.id}`);
  }

  const navGroups: Array<{
    label: string;
    items: Array<{ id: FilterId; name: string }>;
  }> = [
    {
      label: text("Library", "会话库"),
      items: [
        { id: "all", name: text("All chats", "全部会话") },
      ],
    },
    {
      label: text("By recency", "按时间"),
      items: [
        { id: "today", name: text("Today", "今天") },
        { id: "past7", name: text("Last 7 days", "最近 7 天") },
        { id: "older", name: text("Older", "更早") },
      ],
    },
  ];
  const fixedLabels = {
    today: text("Today", "今天"),
    past7: text("Last 7 days", "最近 7 天"),
  };

  const selects = (
    <>
      <SimpleSelect
        size="sm"
        aria-label={text("Sort", "排序")}
        value={sort}
        onValueChange={setSort}
        options={[
          { value: "recent", label: text("Sort: Recent", "排序：最近") },
          { value: "oldest", label: text("Sort: Oldest", "排序：最早") },
          { value: "title", label: text("Sort: Title", "排序：标题") },
        ]}
      />
      <SimpleSelect
        size="sm"
        aria-label={text("Status", "状态")}
        value={statusFilter}
        onValueChange={setStatusFilter}
        options={[
          // Same `archived` flag as the sidebar's Recents → Status filter;
          // prefixed like the sort select so the trigger says what it filters.
          { value: "all", label: text(`Status: ${t("sidebar.status_all")}`, `状态：${t("sidebar.status_all")}`) },
          { value: "active", label: text(`Status: ${t("sidebar.status_active")}`, `状态：${t("sidebar.status_active")}`) },
          { value: "archived", label: text(`Status: ${t("sidebar.status_archived")}`, `状态：${t("sidebar.status_archived")}`) },
        ]}
      />
    </>
  );

  const view = (
      <div className={styles.view} style={embedded ? { flex: 1, minHeight: 0, height: "auto" } : undefined}>
        {/* Embedded: the hub header already owns title + search, so the
            64px topbar would render as an empty band — the selects move
            to the top of the content column instead. */}
        {!embedded && (
          <div className={styles.topbar}>
            <span className={styles.title}>{t("nav.chats")}</span>
            <div className={styles.toolbar}>
              {queryProp === undefined && (
                <SearchInput
                  className="flex-1 max-w-[320px]"
                  placeholder={text("Search chats...", "搜索会话...")}
                  value={query}
                  onChange={setQuery}
                />
              )}
              {selects}
            </div>
          </div>
        )}

        <div className={rail ? styles.body : `${styles.body} ${styles.bodyNoRail}`}>
          {rail && (
          <SecondaryRail label={text("Chat filters", "会话筛选")}>
            {navGroups.map((group) => (
              <div key={group.label}>
                <RailGroupLabel>{group.label}</RailGroupLabel>
                {group.items.map((it) => (
                  <ChatsNavRow
                    key={it.id}
                    id={it.id}
                    name={it.name}
                    count={counts[it.id]}
                    active={filter === it.id}
                    onSelect={() => setFilter(it.id)}
                  />
                ))}
              </div>
            ))}
          </SecondaryRail>
          )}

          <div className={styles.content}>
            {embedded && (
              <div className={styles.contentToolbar}>
                <span className={styles.contentToolbarLabel}>
                  {navGroups.flatMap((group) => group.items).find((it) => it.id === filter)?.name}
                  <span>{items.length}</span>
                </span>
                {selects}
              </div>
            )}
            {items.length === 0 ? (
              <ManageEmptyState
                compact
                icon={<MessageCircleIcon size={20} />}
                title={query
                  ? text("No chats match your search", "没有匹配的会话")
                  : filter === "all"
                    ? include
                      ? text("No chats in this project yet", "这个项目还没有会话")
                      : text("No conversations yet", "还没有会话")
                    : text("Nothing in this range", "这个时间范围内没有内容")}
                description={query
                  ? text("Try a different search term or status filter.", "换个关键词或状态筛选试试。")
                  : filter === "all"
                    ? include
                      ? text("Chats started in this project appear here, grouped by recency.", "在这个项目里开始的会话会按时间分组显示在这里。")
                      : text(`Use ${t("nav.new_chat")} in the sidebar; conversations appear here grouped by recency.`, `使用侧栏的“${t("nav.new_chat")}”开始；会话会按时间分组显示在这里。`)
                    : text("Pick another range on the left.", "在左侧选择其他时间范围。")}
              />
            ) : grouped ? (
              <>
                {grouped
                  .filter(([, rows]) => rows.length)
                  .map(([b, rows]) => (
                    <div className={styles.section} key={b}>
                      <div className={shared.sectionHeader}>
                        <span>{bucketLabel(b, locale, fixedLabels)}</span>
                        <span>{rows.length}</span>
                      </div>
                      <div className={styles.rowList}>
                        {rows.map((c) => (
                          <ChatRow
                            key={c.id}
                            conv={c}
                            locale={locale}
                            untitled={untitled}
                            onClick={() => openChat(c)}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
              </>
            ) : (
              <div className={styles.rowList}>
                {items.map((c) => (
                  <ChatRow
                    key={c.id}
                    conv={c}
                    locale={locale}
                    untitled={untitled}
                    onClick={() => openChat(c)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
  );

  if (embedded) return view;
  return <div className="main">{view}</div>;
}

function ChatRow({
  conv,
  locale,
  untitled,
  onClick,
}: {
  conv: ConvSummary;
  locale: Locale;
  untitled: string;
  onClick: () => void;
}) {
  // Same label the sidebar renders: channel brand prefix, placeholder
  // titles resolved to the preview, "[attached: …]" markers stripped.
  const title = labelFor(conv, untitled);
  // The second line is the latest question asked, so a row says what the
  // chat is about now. An untitled chat already shows it as its name.
  const latest = displayTitle(conv) && conv.preview ? parseAttachments(String(conv.preview)) : null;
  const asked = latest ? latest.text.trim() || latest.attachments[0]?.filename || "" : "";
  // Shared management row: a real <button> to open, same anatomy as the
  // Projects > Chats list. The count slot is last activity — the same
  // timestamp the list sorts and buckets by, so the row's own time can't
  // contradict its date section.
  return (
    <ManageRow
      icon={<MessageCircleIcon size={16} />}
      name={title}
      description={asked || undefined}
      count={formatRelativeTime(activityTs(conv), locale)}
      onClick={onClick}
    />
  );
}

/** One left-rail filter row. "All chats" shows the chat-bubble glyph; the
 *  "by recency" buckets share the clock. */
function ChatsNavRow({
  id,
  name,
  count,
  active,
  onSelect,
}: {
  id: FilterId;
  name: string;
  count: number;
  active: boolean;
  onSelect: () => void;
}) {
  const Icon = id === "all" ? MessageCircleIcon : ClockIcon;
  return (
    <RailItem
      icon={<Icon size={16} />}
      label={name}
      trailing={<RailCount>{count}</RailCount>}
      active={active}
      onClick={onSelect}
    />
  );
}
