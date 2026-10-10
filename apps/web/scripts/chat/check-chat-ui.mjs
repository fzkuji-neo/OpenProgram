import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseHTML } from "linkedom";
import "./check-composer-environment-row.mjs";
import "./check-composer-structure.mjs";

import { readCenterTabStripSource } from "../tabs/center-tab-strip-source.mjs";
import { readChatCss } from "../runtime/_chat-css.mjs";

const root = new URL("../../", import.meta.url);
const source = (path) => readFileSync(new URL(path, root), "utf8");

const welcome = source("components/chat/welcome-screen.tsx");
const welcomeCss = source("components/chat/welcome-screen.module.css");
const messageList = source("components/chat/messages/use-chat-area-stick.ts") + source("components/chat/messages/message-list.tsx");
const messageActions = source("components/chat/messages/message-actions.tsx");
// The strip is split across center-tab-strip.tsx and its submodules;
// read them as one text so the assertions below are unchanged.
const tabs = readCenterTabStripSource();
const tabsCss = source("components/center-tabs/center-tabs.module.css");
const conversations = source("lib/runtime-bridge/conversations.ts");
const chatHandlers = source("lib/runtime-bridge/chat-handlers.ts");
const sessionStore = source("lib/session-store/index.ts");
const assistantBubble = source("components/chat/messages/assistant-bubble.tsx");
const queuedMessages = source("components/chat/messages/queued-messages.tsx");
const composerKeydown = source("components/chat/composer/input/use-composer-keydown.ts");
const userBubble = source("components/chat/messages/user-bubble.tsx");
const runtimeBlock = source("components/chat/messages/runtime-block.tsx");
const attachCard = source("components/chat/messages/attach-card.tsx");
const executionStrip = source("components/chat/messages/execution-strip.tsx");
const executionCss = source("app/styles/chat/execution-strip.css");
const runtimeHelpers = source("lib/runtime-bridge/helpers.ts");
const markdownRenderer = source("lib/runtime-bridge/markdown-render.ts");
const chatVisualSpec = source("../../docs/reference/design/ui/chat-turn-visual-spec.zh.html");
const controlsCluster = source("components/chat/composer/controls/controls-cluster.tsx");
const contextBreakdownPanel = source("components/chat/context-breakdown-panel.tsx");
const contextBadge = source("components/chat/context-badge.tsx");
const composerCss = source("components/chat/composer/composer.module.css");
const workingDirChips = source("components/chat/top-bar/working-dir-chips.tsx");
const chatCss = readChatCss(root);
const baseCss = source("app/styles/base.css");
const globalsCss = source("app/globals.css");
const darkTheme = source("app/styles/themes/dark.css");
const lightTheme = source("app/styles/themes/light.css");
const beigeDarkTheme = source("app/styles/themes/beige-dark.css");
const beigeLightTheme = source("app/styles/themes/beige-light.css");
const auroraTheme = source("app/styles/themes/aurora.css");

// Context statistics use stale-while-revalidate semantics. Once a session
// branch has loaded successfully, reopening its panel must synchronously show
// that value while a fresh request runs in the background.
const contextBreakdownCache = await import("../../lib/chat/context-breakdown-cache.ts");
const cachedBreakdown = { total_used: 12_345, window: 200_000 };
contextBreakdownCache.writeContextBreakdownCache("session-a", "head-a", cachedBreakdown);
assert.deepEqual(
  contextBreakdownCache.readContextBreakdownCache("session-a", "head-a"),
  cachedBreakdown,
);
assert.deepEqual(
  contextBreakdownCache.readContextBreakdownCache("session-a", "head-b"),
  cachedBreakdown,
  "an unknown head falls back to the session-latest snapshot so the panel never flashes empty",
);
assert.equal(contextBreakdownCache.readContextBreakdownCache("session-b", "head-a"), null);
const cachedRefresh = { total_used: 13_000, window: 200_000 };
contextBreakdownCache.writeContextBreakdownCache("session-c", "head-c", cachedRefresh);
assert.deepEqual(
  await contextBreakdownCache.refreshContextBreakdown(
    "session-c",
    "head-c",
    new AbortController().signal,
    async () => { throw new Error("offline"); },
  ),
  cachedRefresh,
  "a failed background refresh must retain the last successful value",
);
let resolveLate;
const lateResponse = new Promise((resolve) => { resolveLate = resolve; });
const staleController = new AbortController();
const staleRefresh = contextBreakdownCache.refreshContextBreakdown(
  "session-stale",
  "head-old",
  staleController.signal,
  () => lateResponse,
);
staleController.abort();
resolveLate({ json: async () => ({ total_used: 99_999, window: 200_000 }) });
assert.equal(await staleRefresh, null, "an aborted old request must not publish its result");
assert.equal(
  contextBreakdownCache.readContextBreakdownCache("session-stale", "head-old"),
  null,
  "an aborted old request must not write the cache",
);
let resolveOlder;
let resolveNewer;
const older = contextBreakdownCache.refreshContextBreakdown(
  "session-race",
  "head-race",
  new AbortController().signal,
  () => new Promise((resolve) => { resolveOlder = resolve; }),
);
const newer = contextBreakdownCache.refreshContextBreakdown(
  "session-race",
  "head-race",
  new AbortController().signal,
  () => new Promise((resolve) => { resolveNewer = resolve; }),
);
resolveNewer({ json: async () => ({ total_used: 200, window: 1_000 }) });
assert.equal((await newer).total_used, 200);
resolveOlder({ json: async () => ({ total_used: 100, window: 1_000 }) });
assert.equal(await older, null, "an older same-key response must be discarded");
assert.equal(
  contextBreakdownCache.readContextBreakdownCache("session-race", "head-race").total_used,
  200,
  "an older same-key response must not overwrite the newer cache value",
);
for (let i = 0; i < 32; i += 1) {
  contextBreakdownCache.writeContextBreakdownCache(`lru-${i}`, null, { total_used: i });
}
assert.equal(contextBreakdownCache.readContextBreakdownCache("lru-0", null).total_used, 0);
contextBreakdownCache.writeContextBreakdownCache("lru-32", null, { total_used: 32 });
assert.equal(
  contextBreakdownCache.readContextBreakdownCache("lru-1", null),
  null,
  "the 33rd value must evict the least-recently-used entry",
);
assert.equal(
  contextBreakdownCache.readContextBreakdownCache("lru-0", null).total_used,
  0,
  "reading an entry must promote it before capacity eviction",
);
assert.equal(contextBreakdownCache.readContextBreakdownCache("lru-2", null).total_used, 2);
assert.equal(contextBreakdownCache.readContextBreakdownCache("lru-31", null).total_used, 31);
assert.equal(contextBreakdownCache.readContextBreakdownCache("lru-32", null).total_used, 32);
let resolveEvictedOlder;
let resolveEvictedNewer;
const evictedOlder = contextBreakdownCache.refreshContextBreakdown(
  "session-evicted-race",
  "head",
  new AbortController().signal,
  () => new Promise((resolve) => { resolveEvictedOlder = resolve; }),
);
for (let i = 0; i < 32; i += 1) {
  contextBreakdownCache.writeContextBreakdownCache(`race-fill-${i}`, null, { total_used: i });
}
const evictedNewer = contextBreakdownCache.refreshContextBreakdown(
  "session-evicted-race",
  "head",
  new AbortController().signal,
  () => new Promise((resolve) => { resolveEvictedNewer = resolve; }),
);
resolveEvictedNewer({ json: async () => ({ total_used: 400, window: 1_000 }) });
assert.equal((await evictedNewer).total_used, 400);
resolveEvictedOlder({ json: async () => ({ total_used: 300, window: 1_000 }) });
assert.equal(await evictedOlder, null);
assert.equal(
  contextBreakdownCache.readContextBreakdownCache("session-evicted-race", "head").total_used,
  400,
  "LRU eviction must not reset same-key request ordering",
);
assert.match(
  contextBreakdownPanel,
  /useState<Breakdown \| null>\(\(\)\s*=>\s*readContextBreakdownCache\(sessionId, headId\),?\s*\)/,
);
assert.match(contextBreakdownPanel, /subscribeContextBreakdownCache\(sync\)/);
assert.doesNotMatch(
  contextBreakdownPanel,
  /refreshContextBreakdown\(/,
  "opening the panel must not start a fetch",
);
assert.doesNotMatch(contextBreakdownPanel, /if \(!sessionId\)[\s\S]{0,300}setLoading\(true\)/);
assert.doesNotMatch(
  contextBreakdownPanel,
  /加载中|Loading…/,
  "the panel must never render a loading state; snapshots warm on session focus",
);
assert.match(
  contextBreakdownPanel,
  /className="scroll-overlay min-h-0 flex-1 overflow-y-auto"/,
  "context breakdown content must scroll without a native scrollbar",
);
assert.match(
  contextBreakdownPanel,
  /className="shrink-0 border-t border-\[var\(--border\)\]"/,
  "the compact action must live outside the scrolling content",
);
assert.match(contextBreakdownPanel, /message\.slot === "event"/);
assert.match(contextBreakdownPanel, /!compacting && !recentlyCompacted/);
assert.match(contextBreakdownPanel, /Recently compacted/);
assert.match(contextBreakdownPanel, /Compacting…/);
assert.match(source("components/chat/context-badge.tsx"), /warmContextBreakdown\(/);
assert.doesNotMatch(contextBadge, /is-recommended|Suggest compacting|compactRecommended/);
assert.doesNotMatch(
  source("app/styles/chat/context-badge.css"),
  /\.is-recommended/,
);
assert.doesNotMatch(
  source("lib/runtime-bridge/chat-handlers.ts"),
  /compaction_recommended/,
);

assert.match(
  contextBadge,
  /<ContextBreakdownPanel\s+key=\{JSON\.stringify\(\[sid, headId \?\? null\]\)\}/,
  "changing the open panel's session/head must synchronously remount it with the new cache key",
);

// Mouse focus and non-tab buttons never draw an outer halo. Top tabs retain a
// theme-owned focus cue, so focus does not impose one fixed product colour.
assert.match(baseCss, /--accent-blue:\s*var\(--theme-accent\);/);
assert.match(globalsCss, /--primary:\s*var\(--accent-blue\);/);
assert.match(globalsCss, /--ring:\s*var\(--focus-ring\);/);
assert.match(
  baseCss,
  /button:focus:not\(\[role="tab"\]\),\s*\[role="button"\]:focus\s*\{[^}]*outline:\s*none\s*!important;[^}]*--tw-ring-shadow:\s*0 0 #0000\s*!important;[^}]*--tw-ring-offset-shadow:\s*0 0 #0000\s*!important;/s,
);
assert.match(
  baseCss,
  /button:focus-visible:not\(\[role="tab"\]\),\s*\[role="button"\]:focus-visible\s*\{[^}]*box-shadow:\s*none\s*!important;[^}]*filter:\s*brightness\(1\.08\);/s,
);
// Text-field focus and compound search borders are verified through the real
// Agents page in tests/e2e/web/test_agents_configuration.py.
for (const themeCss of [darkTheme, beigeDarkTheme]) {
  assert.match(themeCss, /--focus-ring:\s*color-mix\(in srgb, var\(--text-bright\) 50%, transparent\);/);
}
for (const themeCss of [lightTheme, beigeLightTheme]) {
  assert.match(themeCss, /--focus-ring:\s*color-mix\(in srgb, var\(--text-bright\) 45%, transparent\);/);
}
assert.match(auroraTheme, /--focus-ring:\s*color-mix\(in srgb, var\(--accent-cyan\) 60%, transparent\);/);

// Markdown and math rendering are production-bundled dependencies.
assert.match(markdownRenderer, /import \{ marked as npmMarked \} from "marked";/);
assert.match(markdownRenderer, /import renderMathInElement from "katex\/contrib\/auto-render";/);
assert.doesNotMatch(markdownRenderer, /window\.(?:marked|renderMathInElement)/);
assert.doesNotMatch(markdownRenderer, /return "<pre>" \+ escHtml\(str\) \+ "<\/pre>";/);

assert.match(welcome, /src=["{]?["']\/icon\.svg["']/);
assert.doesNotMatch(welcome, /styles\.(?:l1|l2|m|caret)\b/);
assert.doesNotMatch(welcomeCss, /@keyframes\s+logo(Type|Caret)/);
assert.match(welcomeCss, /\.mark\s*\{[^}]*width:\s*34px;[^}]*height:\s*34px;/s);
assert.match(welcomeCss, /\.tagline\s*\{[^}]*font-size:\s*14px;/s);

const scroll = await import("../../lib/chat/chat-scroll.ts");
class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}
const storage = new MemoryStorage();
scroll.writeChatScroll(storage, "chat-a", 120.5);
scroll.writeChatScroll(storage, "chat-b", 480);
assert.equal(scroll.readChatScroll(storage, "chat-a"), 120.5);
assert.equal(scroll.readChatScroll(storage, "chat-b"), 480);
assert.equal(
  scroll.resolveChatScrollTop({
    keyChanged: true,
    seedChanged: false,
    saved: 120.5,
    scrollHeight: 900,
    currentTop: 480,
  }),
  120.5,
  "equal-length chat switches must restore the incoming chat position",
);
// Following a new turn is CONDITIONAL on where the reader is. Being
// yanked to the bottom mid-read is the thing this contract prevents;
// the three cases below are the whole rule.
assert.equal(
  scroll.resolveChatScrollTop({
    keyChanged: false,
    seedChanged: true,
    saved: 120.5,
    scrollHeight: 900,
    currentTop: 880,
    atBottom: true,
  }),
  900,
  "a new turn must follow to the bottom for a reader already at the bottom",
);
assert.equal(
  scroll.resolveChatScrollTop({
    keyChanged: false,
    seedChanged: true,
    saved: 120.5,
    scrollHeight: 900,
    currentTop: 120.5,
    atBottom: false,
  }),
  120.5,
  "a turn arriving while the reader is scrolled up must not move the view",
);
assert.equal(
  scroll.resolveChatScrollTop({
    keyChanged: false,
    seedChanged: true,
    saved: 120.5,
    scrollHeight: 900,
    currentTop: 120.5,
    atBottom: false,
    ownTurn: true,
  }),
  900,
  "the reader's OWN send must follow even from far up the history",
);
assert.equal(
  scroll.resolveChatScrollTop({
    keyChanged: false,
    seedChanged: true,
    saved: 120.5,
    scrollHeight: 900,
    currentTop: 120.5,
  }),
  900,
  "atBottom defaults to true — an untracked caller keeps following, "
    + "rather than silently freezing the view",
);
const area = { scrollTop: 33 };
assert.equal(
  scroll.restoreChatScrollIfCurrent(area, "chat-a", "chat-b", 120.5),
  false,
  "a stale animation-frame callback must not restore the old chat",
);
assert.equal(area.scrollTop, 33);
assert.equal(
  scroll.restoreChatScrollIfCurrent(area, "chat-b", "chat-b", 480),
  true,
);
assert.equal(area.scrollTop, 480);
storage.setItem(scroll.CHAT_SCROLL_STORAGE_KEY, "not-json");
assert.equal(scroll.readChatScroll(storage, "chat-a"), null);
assert.match(messageList, /const chatKey = useSessionStore\(\(s\) => s\.activeChatKey\);/);
// The hook needs the own-send signal to tell "I sent this" from "this
// arrived at me", and must hand back the jump-to-latest affordance —
// without it a reader who scrolls up has no way back to the tail.
assert.match(
  messageList,
  /useChatAreaStick\(\s*chatKey,\s*lastId,\s*paintRows,?\s*\)/,
);
assert.match(messageList, /const \{ detached, jumpToLatest \} = useChatAreaStick/);
assert.match(messageList, /className="jump-latest"/);
assert.match(messageList, /previousKeyRef\.current !== chatKey/);
assert.match(
  messageList,
  /becameVisible && !keyChanged && saved != null/,
  "showing an already opened singleton must restore its saved reading position",
);
assert.doesNotMatch(conversations, /agentic_scroll/);
assert.doesNotMatch(chatHandlers, /agentic_scroll/);
assert.doesNotMatch(conversations, /restoreChatScrollIfCurrent|readChatScroll/,
  "session data reload must leave viewport restoration to the history and follow hooks");
assert.match(chatHandlers, /writeChatScroll\(sessionStorage, chatKey, area\.scrollTop\)/);

// Snapshot progress is covered through the public stream/history reducer in
// tests/chat/stream-delta-raf.test.mjs and the timestamp checks in
// check-provisional-send.mjs. Do not assert the old empty-row implementation.

// ── Agentic runtime cards are matched by ORDER, never by a `_rt_` id ──
// `_wrap_agentic_runtime_block` persists no placeholder row, so no id
// of the form `<msg_id>_rt_<tool_call_id>` is ever minted. Matching on
// one was dead code that silently degraded to FIFO.
assert.doesNotMatch(
  assistantBubble,
  /_rt_/,
  "runtime children carry no tool_call_id back-reference — a `_rt_` id "
    + "match is dead code; keep the ordered claim explicit instead",
);
assert.doesNotMatch(
  assistantBubble,
  /runtimeByToolId/,
  "runtimeByToolId was always empty; the ordered fifo is the real path",
);

// ── MessageList must not re-render on every streaming delta ──────────
// `updateMessage` returns a fresh `messagesById` each token, so
// subscribing to the whole map re-renders the list — and re-maps every
// id — per delta. Only the last row's role is actually needed.
assert.doesNotMatch(
  messageList,
  /useSessionStore\(\(s\) => s\.messagesById\)/,
  "MessageList must select the one field it needs, not the whole "
    + "messagesById map (re-renders on every streaming token)",
);
assert.match(messageList, /s\.messagesById\[lastId\]\?\.role/);
assert.match(messageList, /showPending = runningTask !== null && lastRole === "user"/);

// ── Markdown must not widen the chat column ─────────────────────────
// A wide table or one long unbroken token used to push #chatArea into
// horizontal scroll. marked emits a bare <table> with no wrapper, so
// the table itself has to be the scroll box — which needs
// `display:block`, since a display:table box ignores overflow-x.
const mdTable = chatCss.slice(
  chatCss.indexOf(".message-content table {"),
  chatCss.indexOf(".message-content th,"),
);
assert.ok(mdTable, ".message-content table rule not found");
for (const decl of ["display: block", "overflow-x: auto", "max-width: 100%"]) {
  assert.match(
    mdTable,
    new RegExp(decl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    `.message-content table needs \`${decl}\` or a wide table overflows `
      + "the bubble and scrolls the whole chat area sideways",
  );
}
const mdContent = chatCss.slice(
  chatCss.indexOf(".message-content {"),
  chatCss.indexOf(".message-content pre {"),
);
assert.match(
  mdContent,
  /overflow-wrap: anywhere/,
  "`word-wrap: break-word` never breaks a single unbroken token (long "
    + "URL / hash / base64) — `.message-content` needs overflow-wrap: anywhere",
);
const mdCode = chatCss.slice(
  chatCss.indexOf(".message-content code {"),
  chatCss.indexOf(".message-content pre code"),
);
assert.match(mdCode, /overflow-wrap: anywhere/, "inline code must wrap too");

assert.match(tabs, /role="tablist"/);
assert.match(tabs, /role="tab"/);
assert.match(tabs, /aria-selected=\{active\}/);
assert.match(tabs, /const \[focusedTabId, setFocusedTabId\] = useState/);
assert.match(tabs, /tabIndex=\{tabStop \? 0 : -1\}/);
assert.match(tabs, /onTabListKeyDown/);
const rovingFocus = tabs.slice(
  tabs.indexOf("function onTabListKeyDown"),
  tabs.indexOf("function onTabListWheel"),
);
assert.match(rovingFocus, /"ArrowLeft"/);
assert.match(rovingFocus, /"ArrowRight"/);
assert.match(rovingFocus, /"Home"/);
assert.match(rovingFocus, /"End"/);
assert.match(rovingFocus, /items\[nextIndex\]\.focus\(\)/);
assert.doesNotMatch(
  rovingFocus,
  /items\[nextIndex\]\.click\(\)/,
  "roving focus must not activate the focused tab",
);
const compoundStart = tabs.indexOf("function CompoundTabItem");
const tabItemStart = tabs.indexOf("function TabItem");
assert.ok(compoundStart >= 0 && tabItemStart > compoundStart);
const compound = tabs.slice(compoundStart, tabItemStart);
const tabItem = tabs.slice(tabItemStart);
assert.match(compound, /role="presentation"/);
assert.match(compound, /active \? styles\.compoundTabActive : ""/);
assert.doesNotMatch(compound, /active \? styles\.tabActive : ""/);
assert.equal(compound.match(/role="tab"/g)?.length, 1);
assert.doesNotMatch(compound, /group\.memberIds\.map|<TabItem/);
assert.doesNotMatch(compound, /enteringIds|styles\.tabEnter/);
assert.match(compound, /memberTabs\.filter\(\(tab\) => closingIds\.has\(tab\.id\)\)/);
assert.match(compound, /onClose\(event, memberTabs\)/);
assert.match(compound, /closingTabs\.forEach\(onExited\)/);
assert.match(tabItem, /className=\{styles\.tabTarget\}[\s\S]*role="tab"/);
assert.match(tabItem, /data-tab-id=\{tab\.id\}/);
assert.match(tabItem, /e\.shiftKey && e\.key === "F10"/);
assert.match(tabItem, /onContextMenu=/);
assert.match(
  tabItem,
  /className=\{styles\.tabTarget\}[\s\S]*<\/div>[\s\S]*<button[\s\S]*className=\{styles\.tabClose\}/,
);
assert.match(tabs, /className=\{styles\.tabTarget\}[\s\S]*role="tab"/);
assert.match(tabs, /<button[\s\S]*className=\{styles\.tabClose\}[\s\S]*tabIndex=\{active \? 0 : -1\}/);
const tabTargetStart = tabs.indexOf("className={styles.tabTarget}");
const tabTargetEnd = tabs.indexOf("</div>", tabTargetStart);
const closeButtonStart = tabs.indexOf("<button", tabTargetStart);
assert.ok(tabTargetStart >= 0 && tabTargetEnd > tabTargetStart);
assert.ok(
  closeButtonStart > tabTargetEnd,
  "the close button must be a sibling of the role=tab target",
);
assert.match(tabsCss, /\.tab:has\(\.tabTarget:focus-visible\)/);
assert.match(tabsCss, /\.tab:has\(\.tabTarget:focus-visible\)\s*\{[^}]*outline:\s*2px solid var\(--focus-ring\)/s);
assert.match(tabsCss, /\.compoundTab:has\(\.compoundTarget:focus-visible\)\s*\{[^}]*outline:\s*2px solid var\(--focus-ring\)/s);
assert.doesNotMatch(tabsCss, /\.tabClose:focus-visible/);

const menuStart = tabs.indexOf("role=\"menu\"");
assert.ok(menuStart >= 0, "compound tab actions must use an ARIA menu");
const menu = tabs.slice(menuStart);
assert.match(menu, /<button[\s\S]*type="button"[\s\S]*role="menuitem"/);
for (const label of [
  "Move left",
  "Move right",
  "New split view with this tab",
  "Remove from group",
  "Move to new window",
]) {
  assert.match(menu, new RegExp(label));
}
assert.match(menu, /disabled=\{!canMoveToNewWindow\}/);
assert.match(tabs, /role="status"/);
assert.match(tabs, /aria-live="polite"/);
assert.match(tabs, /function returnFocusToMenuInvoker/);
assert.match(
  tabs,
  /querySelectorAll<HTMLElement>\(\s*'\[role="tab"\]\[data-tab-id\]'/,
);
assert.match(tabs, /if \(e\.key !== "Escape"\) return;[\s\S]*setTabMenu\(null\)/);
assert.match(tabsCss, /\.tabMenu\s*\{/);
assert.match(tabsCss, /\.tabMenuItem\s*\{/);

// A split pane can be narrow while the application viewport remains wide, so
// the composer controls must compact through their own inline-size container.
assert.match(controlsCluster, /name="dumbbell-large-minimalistic"/);
assert.match(controlsCluster, /styles\.compactEffortIcon/);
assert.match(controlsCluster, /styles\.effortValue/);
assert.match(controlsCluster, /effortLevelColor\(thinkingOptions, thinking\)/);
assert.match(
  controlsCluster,
  /className=\{styles\.compactEffortIcon\}[\s\S]*style=\{\{ color: thinking === "max" \? "#8E6BD9" : effortColor \}\}/,
);
assert.match(
  controlsCluster,
  /className=\{`\$\{cn\(buttonVariants\(\{ variant: "elevated", size: "sm" \}\)\)\} \$\{styles\.effortText\}`\}[\s\S]*style=\{thinking === "max" \? \{ color: "#8E6BD9" \} : undefined\}/,
);
// The row's Buttons transition every property, so a live row that just left
// compact mode reports compact widths mid-transition. The need is measured on
// a hidden, transition-free copy, never by toggling the live row.
const compactControlsHook = source("components/chat/composer/controls/use-compact-controls-row.ts");
assert.match(compactControlsHook, /row\.cloneNode\(true\)/);
assert.match(compactControlsHook, /probe\.remove\(\)/);
assert.doesNotMatch(compactControlsHook, /row\.dataset\.measuring/);
assert.match(compactControlsHook, /attributeFilter: \["class"\]/);
assert.match(compactControlsHook, /loadingdone/);
assert.match(composerCss, /\.controlsRow\[data-measuring\] \*\s*\{[^}]*transition:\s*none !important/);
const compactControlsStart = composerCss.indexOf("/* Narrow composer control labels");
const compactControlsEnd = composerCss.indexOf(
  "/* The options (+) dropdown",
  compactControlsStart,
);
assert.ok(
  compactControlsStart >= 0 && compactControlsEnd > compactControlsStart,
  "narrow composer controls must have a bounded compact block",
);
const compactControls = composerCss.slice(compactControlsStart, compactControlsEnd);
assert.match(compactControls, /\.controlsRow\[data-compact="true"\]/);
assert.doesNotMatch(compactControls, /@container \(max-width/);
assert.match(compactControls, /\.permission-badge[\s\S]*\.badge-details/);
assert.match(compactControls, /\.agent-badge[\s\S]*\.badge-details/);
assert.match(compactControls, /\.effortValue/);
assert.match(compactControls, /position:\s*absolute/);
assert.match(compactControls, /\.permission-badge\s*>\s*:has\(svg\)[\s\S]*display:\s*inline-flex\s*!important/);
assert.match(compactControls, /\.compactEffortIcon[\s\S]*display:\s*inline-flex/);
assert.match(compactControls, /\.permission-badge[\s\S]*width:\s*28px/);
assert.match(compactControls, /\.agent-badge[\s\S]*width:\s*28px/);
assert.doesNotMatch(compactControls, /\.(?:permission-badge|agent-badge|effort-pill-host)[^{]*\{[^}]*display:\s*none/s);

assert.match(workingDirChips, /className="workdir-remove"/);
assert.match(workingDirChips, /aria-label=\{text\("Remove folder", "移除文件夹"\)\}/);
assert.match(workingDirChips, /tabIndex=\{0\}/);
const { effortLevelColor } = await import("../../lib/effort-color.ts");
const effortOptions = ["low", "medium", "high", "max"].map((value) => ({ value }));
const nonMaxColors = effortOptions
  .filter(({ value }) => value !== "max")
  .map(({ value }) => effortLevelColor(effortOptions, value));
assert.equal(
  new Set(nonMaxColors).size,
  nonMaxColors.length,
  "every non-max effort level must retain a distinct compact-icon color",
);

// Bottom-row controls are shadcn Buttons (the app's `elevated` variant): the TSX carries
// buttonVariants, and the CSS hands the legacy base rules back to those
// layered utilities (revert-layer) instead of drawing its own chip.
assert.match(controlsCluster, /cn\(buttonVariants\(\{ variant: "elevated", size: "icon-sm" \}\)\)\} \$\{styles\.plusBtn\}/);
const surfaceControlsStart = composerCss.indexOf("/* Every control in this row is a shadcn Button (buttonVariants");
const surfaceControlsEnd = composerCss.indexOf(
  "/* Narrow composer control labels",
  surfaceControlsStart,
);
assert.ok(
  surfaceControlsStart >= 0 && surfaceControlsEnd > surfaceControlsStart,
  "composer control surfaces must have one bounded style block",
);
const surfaceControls = composerCss.slice(surfaceControlsStart, surfaceControlsEnd);
for (const selector of [".plusBtn", ".toolChip", ".effortText"]) {
  assert.match(surfaceControls, new RegExp(`\\.controlsRow \\${selector}[^{]*\\{[^}]*background:\\s*revert-layer`, "s"));
}
assert.doesNotMatch(
  surfaceControls,
  /var\(--chip-bg\)/,
  "bottom-row controls must not paint their own chip fill over the Button",
);
assert.match(controlsCluster, /styles\.effortText\}`\}\s*aria-expanded=\{thinkingMenuOpen\}/);

const { runtimeConclusion, runtimeSummaryLabel } = await import(
  "../../components/chat/messages/runtime-summary.ts"
);
const { convToChatMsgs } = await import("../../lib/chat/conv-mapper.ts");
const directRunAfterAssistant = convToChatMsgs([
  { id: "assistant-1", role: "assistant", content: "parent reply" },
  {
    id: "direct-run",
    role: "assistant",
    type: "status",
    display: "runtime",
    function: "auto_workflow",
    status: "completed",
    caller: "",
    predecessor: "assistant-1",
    content: "",
  },
]);
assert.equal(
  directRunAfterAssistant.length,
  2,
  "a direct runtime run must stay top-level when only predecessor points at an assistant",
);
assert.equal(directRunAfterAssistant[0].runtimeChildren, undefined);
assert.equal(directRunAfterAssistant[1].id, "direct-run");
assert.equal(directRunAfterAssistant[1].display, "runtime");

const assistantOwnedRun = convToChatMsgs([
  { id: "assistant-1", role: "assistant", content: "parent reply" },
  {
    id: "owned-run",
    role: "assistant",
    type: "status",
    display: "runtime",
    function: "research_agent",
    status: "completed",
    caller: "assistant-1",
    predecessor: "assistant-1",
    content: "",
  },
]);
assert.equal(assistantOwnedRun.length, 1);
assert.equal(assistantOwnedRun[0].runtimeChildren?.length, 1);
assert.equal(assistantOwnedRun[0].runtimeChildren?.[0].id, "owned-run");
assert.equal(assistantOwnedRun[0].runtimeChildren?.[0].calledBy, "assistant-1");

const startedAt = 1_700_000_000;
assert.equal(
  runtimeSummaryLabel({
    fnName: "auto_workflow",
    status: "running",
    timestamp: startedAt,
    now: (startedAt + 130) * 1000,
    tree: { name: "root", children: [{ name: "read_file" }] },
  }),
  "auto_workflow · Running… · 02:10 · 2 steps",
);
assert.equal(
  runtimeSummaryLabel({
    fnName: "auto_workflow",
    status: "completed",
    tree: { duration_ms: 166_000, output: " 2 files\nprocessed " },
  }),
  "auto_workflow · Completed · 02:46 · 2 files processed",
);
assert.equal(
  runtimeSummaryLabel({
    fnName: "auto_workflow",
    status: "error",
    tree: { duration_ms: 82_000, error: "Permission denied" },
  }),
  "auto_workflow · Error · 01:22 · Permission denied",
);
assert.equal(
  runtimeSummaryLabel({
    fnName: "auto_workflow",
    status: "cancelled",
    tree: { duration_ms: 42_000, error: "cancelled by user", children: [{}, {}] },
  }),
  "auto_workflow · Cancelled · 00:42 · 3 steps",
);
for (const [payloadStatus, expectedStatus] of [
  ["capped", "Stopped"],
  ["interrupted", "Interrupted"],
  ["cancelled", "Cancelled"],
  ["failed", "Error"],
]) {
  for (const outerStatus of ["completed", "done"]) {
    assert.match(
      runtimeSummaryLabel({
        fnName: "auto_workflow",
        status: outerStatus,
        tree: {
          duration_ms: 42_000,
          output: JSON.stringify({ status: payloadStatus, summary: "Partial result" }),
        },
      }),
      new RegExp(`^auto_workflow · ${expectedStatus} · 00:42 ·`),
      `workflow payload status ${payloadStatus} must override generic outer status ${outerStatus}`,
    );
  }
}
assert.match(
  runtimeSummaryLabel({
    fnName: "auto_workflow",
    status: "running",
    tree: {
      output: JSON.stringify({ status: "failed", summary: "stale terminal payload" }),
    },
  }),
  /^auto_workflow · Running… ·/,
  "the live outer status must take precedence over a stale terminal payload",
);

for (const [payload, expected, objectOutput] of [
  [
    { status: "succeeded", success: false, summary: "The Page title is OpenProgram." },
    "gui_agent · Succeeded · 00:00 · The Page title is OpenProgram.",
    true,
  ],
  [
    { status: "failed", success: true, summary: "No accessible built-in Page is open." },
    "gui_agent · Failed · 00:00 · No accessible built-in Page is open.",
  ],
  [
    {
      status: "infeasible",
      success: true,
      summary: "Login is required.",
      handoff_instruction: "Sign in, then retry this GUI task.",
    },
    "gui_agent · Needs takeover · 00:00 · Sign in, then retry this GUI task.",
  ],
]) {
  assert.equal(
    runtimeSummaryLabel({
      fnName: "gui_agent",
      status: "completed",
      tree: {
        duration_ms: 225,
        output: objectOutput ? payload : JSON.stringify(payload),
      },
    }),
    expected,
    "the GUI task outcome must replace the internal completed transport status",
  );
}
assert.match(
  runtimeSummaryLabel({
    fnName: "gui_agent",
    status: "completed",
    tree: {
      duration_ms: 225,
      output: JSON.stringify({ status: "cancelled", success: false }),
    },
  }),
  /^gui_agent · Cancelled · 00:00 ·/,
  "a returned GUI cancellation must remain distinct from failure and error",
);
for (const output of [
  '{"status":',
  { status: "mystery" },
  { success: false },
]) {
  assert.match(
    runtimeSummaryLabel({
      fnName: "gui_agent",
      status: "completed",
      tree: { output },
    }),
    /^gui_agent · Error ·/,
    "a terminal GUI node without a valid task outcome must not display Completed",
  );
}
assert.match(
  runtimeSummaryLabel({
    fnName: "gui_agent",
    status: "running",
    tree: {
      output: JSON.stringify({
        status: "failed",
        success: false,
        summary: "stale terminal payload",
      }),
    },
  }),
  /^gui_agent · Running… ·/,
  "a running GUI node must not expose a stale terminal payload",
);
assert.match(
  runtimeSummaryLabel({
    fnName: "gui_agent",
    status: "error",
    tree: {
      error: "Worker crashed",
      output: JSON.stringify({
        status: "succeeded",
        success: true,
        summary: "stale successful payload",
      }),
    },
  }),
  /^gui_agent · Error · .*Worker crashed$/,
  "a runtime exception must remain distinct from a returned task failure",
);
assert.match(
  runtimeSummaryLabel({
    fnName: "gui_agent",
    status: "completed",
    tree: {
      error: "Persisted runner error",
      output: { status: "succeeded", success: true, summary: "stale success" },
    },
  }),
  /^gui_agent · Error · .*Persisted runner error$/,
  "a stored tree error must take precedence over a returned GUI outcome",
);
assert.match(
  runtimeSummaryLabel({
    fnName: "status_probe",
    status: "completed",
    tree: { output: JSON.stringify({ status: "failed" }) },
  }),
  /^status_probe · Completed ·/,
  "an arbitrary function's status field is data unless that function declares the outcome contract",
);
for (const fnName of ["status_probe", "auto_workflow"]) {
  for (const outerStatus of ["succeeded", "infeasible"]) {
    assert.match(
      runtimeSummaryLabel({
        fnName,
        status: outerStatus,
        tree: { output: "business result" },
      }),
      new RegExp(`^${fnName} · Completed ·`),
      "GUI-only result labels must not alter other Function cards",
    );
  }
}

assert.deepEqual(
  runtimeConclusion({
    fnName: "auto_workflow",
    status: "completed",
    tree: {
      output: JSON.stringify({
        status: "completed",
        task: "Review two papers",
        items: [
          { status: "completed" },
          { status: "completed" },
          { status: "failed" },
        ],
        revisions: [{}, {}],
        summary_kind: "workflow_handoff_v1",
        summary: "Produced the final survey.",
        return_result: false,
      }),
    },
  }),
  {
    label: "Conclusion",
    meta: "Completed 3 calls: 2 succeeded, 1 failed, with 2 automatic repairs.",
    summary: "Produced the final survey.",
    tone: "success",
  },
);
assert.deepEqual(
  runtimeConclusion({
    fnName: "auto_workflow",
    status: "interrupted",
    tree: { error: "Worker restarted" },
  }),
  {
    label: "Conclusion",
    meta: "Workflow was interrupted.",
    summary: "Worker restarted",
    tone: "error",
  },
);
assert.deepEqual(
  runtimeConclusion({
    fnName: "auto_workflow",
    status: "completed",
    tree: {
      output: JSON.stringify({
        status: "interrupted",
        summary_kind: "workflow_handoff_v1",
        summary: "Partial result",
      }),
    },
  }),
  {
    label: "Conclusion",
    meta: "Workflow was interrupted.",
    summary: "Partial result",
    tone: "error",
  },
);
const fullWorkflowSummary = "第一部分已完成并生成研究综述。".repeat(100);
const fullConclusion = runtimeConclusion({
  fnName: "auto_workflow",
  status: "completed",
  tree: {
    output: JSON.stringify({
      status: "completed",
      summary: fullWorkflowSummary,
    }),
  },
});
assert.ok(fullConclusion);
assert.equal(
  fullConclusion.summary,
  "",
  "legacy workflow payloads must not expose the raw task result as a handoff",
);
assert.deepEqual(
  runtimeConclusion({
    fnName: "auto_workflow",
    status: "completed",
    tree: {
      output: JSON.stringify({
        status: "completed",
        summary_kind: "workflow_handoff_v1",
        summary: "完成文件分析并保存到 report.md。",
        return_result: true,
        result: "用户明确要求直接返回的完整正文",
      }),
    },
  }),
  {
    label: "Conclusion",
    meta: "Workflow completed.",
    summary: "完成文件分析并保存到 report.md。",
    result: "用户明确要求直接返回的完整正文",
    tone: "success",
  },
);
assert.deepEqual(
  runtimeConclusion({
    fnName: "auto_workflow",
    status: "error",
    tree: { error: "Permission denied" },
  }),
  {
    label: "Conclusion",
    meta: "Workflow failed.",
    summary: "Permission denied",
    tone: "error",
  },
);
assert.deepEqual(
  runtimeConclusion({
    fnName: "auto_workflow",
    status: "cancelled",
    tree: { output: JSON.stringify({ items: [{ status: "completed" }] }) },
  }),
  {
    label: "Conclusion",
    meta: "Workflow was cancelled after 1 recorded call.",
    summary: "",
    tone: "cancelled",
  },
);
assert.deepEqual(
  runtimeConclusion({
    fnName: "auto_workflow",
    status: "completed",
    tree: {
      output: JSON.stringify({
        status: "cancelled",
        items: [{ status: "completed" }],
        summary: "Partial result",
      }),
    },
  }),
  {
    label: "Conclusion",
    meta: "Workflow was cancelled after 1 recorded call.",
    summary: "",
    tone: "cancelled",
  },
);
assert.deepEqual(
  runtimeConclusion({
    fnName: "auto_workflow",
    status: "completed",
    tree: { output: "Legacy workflow result" },
  }),
  {
    label: "Conclusion",
    meta: "Workflow completed.",
    summary: "",
    tone: "success",
  },
);
assert.equal(runtimeConclusion({
  fnName: "auto_workflow",
  status: "running",
  tree: { output: "partial" },
}), null);
assert.equal(runtimeConclusion({
  fnName: "extract_pdf_tables",
  status: "completed",
  tree: { output: "done" },
}), null);

assert.match(
  runtimeBlock,
  /<ExecutionStrip[\s\S]*label=\{summaryLabel\}[\s\S]*streaming=\{streaming\}[\s\S]*after=\{runtimeAfter\}/,
);
assert.match(
  runtimeBlock,
  /<\/ExecutionStrip>[\s\S]*conclusion \? \([\s\S]*className=\{`runtime-program-conclusion is-\$\{conclusion\.tone\}`\}/,
  "workflow conclusion must remain outside the collapsible execution trace",
);
assert.match(
  runtimeBlock,
  /conclusion\.result \? \([\s\S]*runtime-program-conclusion-result/,
  "an explicitly requested direct result must render separately from the workflow handoff",
);
assert.match(
  runtimeBlock,
  /const retryPayload[\s\S]*node_id: msg\.id[\s\S]*surfaceOriginForChat\(sessionId, true\)[\s\S]*retryPayload\.surface_ref = surface[\s\S]*wsSend\(retryPayload\)/,
  "Retry must submit the exact code node and retain a legacy Page fallback",
);
const runtimeAfterBlock = runtimeBlock.slice(
  runtimeBlock.indexOf("const runtimeAfter ="),
  runtimeBlock.indexOf("// LLM-initiated calls keep"),
);
assert.doesNotMatch(
  runtimeAfterBlock,
  /\{footer\}/,
  "the top-level message footer must not be passed into ExecutionStrip.after",
);
const topLevelProgram = runtimeBlock.slice(
  runtimeBlock.indexOf("// The function marker identifies"),
);
const topExecution = topLevelProgram.indexOf("<ExecutionStrip");
const topConclusion = topLevelProgram.indexOf("conclusion ? (");
const topFooter = topLevelProgram.indexOf("{footer}");
assert.ok(
  topExecution >= 0 && topConclusion > topExecution && topFooter > topConclusion,
  "the top-level footer must remain visible at the message bottom, after Conclusion",
);
assert.match(
  chatCss,
  /\.message\.assistant \.message-actions-footer\s*\{[^}]*margin-top:\s*14px/s,
  "assistant messages define the optically balanced 14px body-to-footer gap",
);
assert.match(
  chatCss,
  /\.message-actions\s*\{[^}]*opacity:\s*0/s,
  "chat message timestamps and actions must stay hidden without hover",
);
assert.match(
  chatCss,
  /\.message:hover \.message-actions,\s*\.attach-card:hover \.message-actions,\s*\.message-actions:focus-within\s*\{[^}]*opacity:\s*1/s,
  "chat message timestamps and actions must appear together on hover or keyboard focus",
);
assert.doesNotMatch(
  chatCss,
  /\.message \.message-actions-footer \.message-actions\s*\{[^}]*opacity:\s*1/s,
  "chat message footers must not force the timestamp visible without hover",
);
assert.match(
  queuedMessages,
  /className="message-timestamp"[\s\S]*new Date\(row\.queuedAt\)\.toLocaleTimeString/,
  "queued user messages must show their enqueue timestamp before dispatch",
);
assert.match(queuedMessages, /Add to this turn/);
assert.doesNotMatch(queuedMessages, /onStopAndSend|Stop current and send/);
assert.match(queuedMessages, /Waiting to add to current turn…/);
// Queue vs steer is chosen per send, not by a standing mode: Enter adds to
// the current turn, Cmd/Ctrl+Enter queues for the next. The queue card
// tags each row with where it goes and offers Clear all.
assert.doesNotMatch(controlsCluster, /While running|runningMessageMode/);
assert.match(composerKeydown, /submit\(e\.metaKey \|\| e\.ctrlKey \? "queue" : "steer"\)/);
assert.match(queuedMessages, /"This turn"/);
assert.match(queuedMessages, /"Next turn"/);
assert.match(queuedMessages, /clearDrafts\(sessionId\)/);
assert.doesNotMatch(userBubble, /Steered|已注入/);
assert.match(assistantBubble, /seg\.kind === "steering"/);
assert.match(chatHandlers, /data\.turn_continues !== true/);
assert.match(
  messageActions,
  /export function MessageTimestamp[\s\S]*className="message-timestamp"[\s\S]*aria-label=\{fullTime\}[\s\S]*tabIndex=\{0\}/,
  "all message kinds must share one keyboard-focusable timestamp renderer",
);
{
  const actionButton = messageActions.slice(
    messageActions.indexOf("export function ActionButton"),
    messageActions.indexOf("export function MessageTimestamp"),
  );
  assert.match(
    messageActions,
    /buttonVariants\(\{ variant: "ghost", size: "icon-xs" \}\)/,
    "message actions use the official ghost round icon button",
  );
  assert.match(actionButton, /<HoverTip label=\{<TipBody title=\{title\} \/>\}>/);
  assert.match(actionButton, /<HoverTip label=\{<TipBody title=\{label\} \/>\}>/);
  assert.match(actionButton, /aria-label=\{title\}/);
  assert.doesNotMatch(actionButton, /^\s+title=\{/m, "message actions must not use native title tooltips");
  assert.match(actionButton, /\{\.\.\.handlers\}/, "the whole button keeps driving the animated icon");
  const editor = source("components/chat/messages/message-editor.tsx");
  assert.match(editor, /<HoverTip label=\{<TipBody title=\{text\("Add images or files"/);
  assert.match(editor, /variant="ghost" size="icon-sm"[\s\S]*<SolarIcon name="paperclip"/);
  assert.match(editor, /variant="elevated" size="sm" onClick=\{onDone\}/);
  assert.doesNotMatch(editor, /<(?:button|Button)\b[^>]*\stitle=\{/, "the edit box must not use native title tooltips");
}
assert.match(
  chatCss,
  /@media\s*\(hover:\s*none\)[\s\S]*\.message \.message-actions,[\s\S]*\.attach-card \.message-actions[\s\S]*opacity:\s*1/,
  "touch devices must expose timestamps without relying on hover",
);
assert.match(
  executionCss,
  /@media\s*\(hover:\s*none\)[\s\S]*\.runtime-card-host \.message-actions,[\s\S]*\.tl-step-act[\s\S]*opacity:\s*1/,
  "touch devices must also expose top-level runtime and sub-agent timestamps",
);
assert.match(
  assistantBubble,
  /streaming \? \([\s\S]*<MessageTimestamp timestamp=\{msg\.timestamp\}/,
  "a streaming assistant must render its start timestamp",
);
assert.match(
  messageList,
  /function PendingReplyIndicator[\s\S]*<MessageTimestamp timestamp=\{timestamp \?\? fallbackTimestamp\}/,
  "the pre-reply pending indicator must render a timestamp immediately",
);
const pendingReplyIndicator = messageList.slice(
  messageList.indexOf("function PendingReplyIndicator"),
  messageList.indexOf("function TranscriptSkeleton"),
);
assert.match(
  pendingReplyIndicator,
  /className="pending-body"(?:(?!<\/div>)[\s\S])*<MessageTimestamp timestamp=\{timestamp \?\? fallbackTimestamp\}/,
  "the transient retry indicator must keep its timestamp on the thinking row",
);
assert.doesNotMatch(
  pendingReplyIndicator,
  /message-actions-footer/,
  "the transient retry indicator must not create a normal message footer",
);
assert.match(
  messageList,
  /msg\.role === "system"[\s\S]*<MessageTimestamp timestamp=\{msg\.timestamp\}/,
  "transient system messages must render their store timestamp",
);
const systemEventRow = messageList.slice(
  messageList.indexOf("function SystemEventRow"),
  messageList.indexOf("function dispatch"),
);
assert.match(
  systemEventRow,
  /className="message system-event"[\s\S]*system-event-text/,
  "compaction / snip event rows must render as a centered divider",
);
assert.doesNotMatch(
  systemEventRow,
  /message-actions-footer/,
  "event divider rows must not keep a right-side timestamp column",
);
assert.match(
  conversations,
  /slot: "card"/,
  "session load must rebuild a fold card from the active summary",
);
assert.match(
  messageList,
  /function CompactionCard/,
  "the covered-segment boundary is a summary card, not only a divider",
);
assert.match(
  messageList,
  /compaction-card-bar/,
  "info and originals toggle share one row above the card",
);
assert.match(
  messageList,
  /<span className="compaction-card-info">/,
  "the compacted-count line is inert text, not a control",
);
assert.match(
  messageList,
  /<MessageRail hiddenKey=\{/,
  "the rail must drop folded covered originals from its ticks",
);
assert.doesNotMatch(
  messageList,
  /clientHeight \/ 3/,
  "opening originals must not jump by a third of the viewport",
);
assert.match(
  messageList,
  /className="text-hit/,
  "compaction text controls share the text-hit hover class",
);
assert.doesNotMatch(
  messageList,
  /compaction-card-orig/,
  "the card must not host the originals toggle",
);
assert.match(
  messageList,
  /compaction-card-more/,
  "clamped summary recap needs a Show all control",
);
assert.match(
  messageList,
  /… Show all/,
  "the recap expander reads as a continuation of the truncated line",
);
assert.doesNotMatch(
  messageList,
  /setOpen/,
  "the summary card has no hide-the-body state",
);
assert.match(
  messageList,
  /compaction-orig-fold/,
  "covered originals animate inside a height fold",
);
assert.match(
  chatCss,
  /\.compaction-orig-fold\[data-open="0"\] \.compaction-orig-fold-inner\s*\{[\s\S]*?content-visibility:\s*hidden/,
  "folded originals skip layout; the 0fr close stays on the grid parent",
);
assert.match(
  chatCss,
  /\.compaction-orig-fold\[data-open="1"\] \.compaction-orig-fold-inner\s*\{[\s\S]*?content-visibility:\s*visible/,
  "showing originals must lift the skip immediately",
);
assert.doesNotMatch(
  messageList,
  /react-virtuoso|react-window|@tanstack\/react-virtual/,
  "the transcript must not unload history behind a virtualizer",
);
assert.match(
  chatCss,
  /\.message\.system-event[\s\S]*animation:\s*none[\s\S]*opacity:\s*1/,
  "event dividers must not stay stuck at the msgAppear from-opacity",
);
assert.match(
  chatCss,
  /\.compaction-card-bar[\s\S]*flex-wrap:\s*nowrap/,
  "compaction info and originals toggle stay on one row",
);
assert.match(
  chatCss,
  /\.text-hit:hover[\s\S]*text-decoration-color:\s*currentColor/,
  "clickable compaction text must underline on hover",
);
assert.match(
  runtimeBlock,
  /const footer = \([\s\S]*<MessageTimestamp timestamp=\{msg\.timestamp\}/,
  "nested and top-level runtime rows must both render their start timestamp",
);
const nestedRuntimeBranch = runtimeBlock.slice(
  runtimeBlock.indexOf("if (nested)"),
  runtimeBlock.indexOf("// The function marker identifies"),
);
assert.match(
  nestedRuntimeBranch,
  /\{footer\}/,
  "the nested runtime return path must mount the shared timestamp footer",
);
assert.match(
  attachCard,
  /attach-card-time[\s\S]*<MessageTimestamp timestamp=\{msg\.timestamp\}/,
  "attach cards must render their message timestamp",
);
assert.match(
  executionStrip,
  /export function SubAgentStep[\s\S]*<MessageTimestamp timestamp=\{card\.timestamp\}/,
  "sub-agent timeline rows must render their own timestamp",
);
assert.match(
  chatVisualSpec,
  /\.reply-footer\{[^}]*margin-top:14px[^}]*opacity:0[^}]*\}[\s\S]*\.reply-message:hover \.reply-footer,\.reply-footer:focus-within\{opacity:1\}[\s\S]*class="reply-footer"[\s\S]*class="ts">16:33</,
  "the visual specification must hide the whole assistant footer until hover or keyboard focus",
);
assert.match(
  chatCss,
  /\.runtime-actions-footer\s*\{[^}]*margin-top:\s*14px/s,
  "workflow Conclusion-to-footer spacing must match assistant messages",
);
assert.match(
  chatCss,
  /\.runtime-actions-footer\s*\{[^}]*padding-left:\s*0(?:px)?\s*;/s,
  "workflow header, Conclusion, and footer must share the exact same left edge",
);
assert.match(
  chatVisualSpec,
  /\.run-footer\{[^}]*margin-top:14px/s,
  "the visual specification must show the shared 14px footer spacing",
);
assert.match(
  chatVisualSpec,
  /<div class="tl-collapse"><div class="tl-collapse-inner">[\s\S]*?<\/div><\/div>\s*<\/div>\s*<section class="runtime-program-conclusion">[\s\S]*?<\/section>\s*<div class="run-footer">/,
  "the visual specification must keep collapse, Conclusion, and footer in that order",
);
assert.doesNotMatch(
  chatVisualSpec,
  /<div class="step(?:\s[^"]*)?"[^>]*>\s*<span class="step-icon/,
  "timeline icons must be anchored inside the row head, not centered against the whole subtree",
);
assert.match(
  chatVisualSpec,
  /<div class="step-head"><span class="step-icon/,
  "the visual specification must mirror StepRow's production DOM hierarchy",
);
assert.doesNotMatch(
  chatVisualSpec,
  /\.step-head:hover\s+\.step-icon/,
  "the proposed timeline design must not restore per-icon hover rings",
);
assert.match(
  chatVisualSpec,
  /\.step-title\.link:hover\{[^}]*text-decoration:underline/,
  "detail titles must retain their underline affordance",
);
assert.doesNotMatch(
  chatVisualSpec,
  />详情<\/button>/,
  "details must remain on the underlined title, not a duplicate row action",
);
const designTileRule = chatVisualSpec.match(/\.step-icon\{([^}]*)\}/)?.[1] ?? "";
assert.match(
  designTileRule,
  /border-radius:7px;[^}]*color:var\(--tone\)/s,
  "the design must draw tone-tinted rounded icon tiles",
);
assert.doesNotMatch(
  chatVisualSpec,
  /step-disclosure/,
  "the design must not add a separate disclosure arrow",
);
assert.doesNotMatch(
  chatVisualSpec,
  /fold-hint|⋯\s*\d+\s*步/,
  "timeline rows must not show inconsistent descendant-step counts",
);
const designDocument = parseHTML(chatVisualSpec).document;
const designFunctionIcons = [
  ...designDocument.querySelectorAll(".step-icon.k-function svg"),
];
assert.ok(designFunctionIcons.length > 0, "the design must include function timeline icons");
// The mock draws the same Solar Bold Duotone sledgehammer the app vendors.
const solarBodies = source("components/solar-icons/bodies.ts");
const solarSledgehammerPath = JSON.parse(
  solarBodies.match(/\n  "sledgehammer": ("(?:[^"\\]|\\.)*"),/)?.[1] ?? '""',
).match(/ d="([^"]+)"/)?.[1];
assert.ok(solarSledgehammerPath, "bodies.ts must vendor the Solar sledgehammer");
for (const [index, icon] of designFunctionIcons.entries()) {
  assert.equal(
    icon.querySelector("path")?.getAttribute("d"),
    solarSledgehammerPath,
    `design function icon ${index + 1} must use the Solar sledgehammer`,
  );
}
for (const [index, head] of [...designDocument.querySelectorAll(".step-head")].entries()) {
  assert.ok(
    [...head.querySelectorAll(":scope > .step-act > .btn")]
      .some((button) => button.textContent?.trim() === "复制"),
    `design timeline row ${index + 1} must expose Copy`,
  );
}
assert.match(
  chatVisualSpec,
  /\[data-step-toggle\][\s\S]*event\.key!==['"]Enter['"][\s\S]*event\.key!==['"] ['"]/,
  "the interactive design sample must support Enter and Space expansion",
);
assert.match(
  chatVisualSpec,
  /event\.target\.closest\(['"]button,\.step-title\.link['"]\)/,
  "clicking a detail title must not also expand or collapse its row",
);
const designTimelineActionRule = chatVisualSpec.match(/\.step-act\{([^}]*)\}/)?.[1] ?? "";
assert.doesNotMatch(
  designTimelineActionRule,
  /transition\s*:/,
  "the design sample must switch timeline row actions immediately",
);
const designRailRule = chatVisualSpec.match(/\.mini\{([^}]*)\}/)?.[1] ?? "";
assert.match(designRailRule, /left:\s*10px/);
assert.doesNotMatch(designRailRule, /right\s*:/);
assert.match(chatVisualSpec, /<h2><span class="num">6<\/span>左缘消息导航/);
const subagentCurrentStart = chatVisualSpec.indexOf("Sub-agent 实时显示现状");
const subagentCurrentEnd = chatVisualSpec.indexOf("<!-- ═══════ 5. 父子分支导航");
assert.ok(
  subagentCurrentStart >= 0 && subagentCurrentEnd > subagentCurrentStart,
  "the visual specification must document the current sub-agent lifecycle",
);
const subagentCurrentState = chatVisualSpec.slice(subagentCurrentStart, subagentCurrentEnd);
for (const state of ["T0 · 父级 RUNNING", "T1 · 子代理开始", "T2 · 子代理结束", "T3 · 父级 TERMINAL", "T4 · 用户重新展开"]) {
  assert.match(subagentCurrentState, new RegExp(state));
}
assert.match(subagentCurrentState, /const \[open, setOpen\] = useState\(false\)/);
assert.match(subagentCurrentState, /id="replay-subagent"[\s\S]*id="demo-subagent-row"/);
assert.match(
  subagentCurrentState,
  /id="demo-subagent-row"[\s\S]*class="step-act"[\s\S]*切换 ↗/,
  "the reopened sub-agent record must retain the ordinary timeline-row switch action",
);
assert.match(
  chatVisualSpec,
  /subagentLabel\.textContent='auto_workflow · 已完成';\s*setSubagentOpen\(false\)/,
  "the slow replay must demonstrate the execution trace remaining collapsed at terminal state",
);
assert.match(
  chatVisualSpec,
  /setSubagentOpen\(true\);\s*subagentRow\.className='step demo-subagent is-mounted';\s*subagentStatus\.textContent='T4：用户重新展开，仍是同一条时间线行'/,
  "the slow replay must demonstrate that manual reopening preserves the timeline row",
);
const branchNavigationStart = chatVisualSpec.indexOf("Sub-agent 父子分支导航");
const branchNavigationEnd = chatVisualSpec.indexOf("<!-- ═══════ 6. 消息导航");
assert.ok(
  branchNavigationStart >= 0 && branchNavigationEnd > branchNavigationStart,
  "the visual specification must draw the parent/child branch navigation",
);
const branchNavigation = chatVisualSpec.slice(branchNavigationStart, branchNavigationEnd);
for (const contract of [
  'data-branch-destination="child">切换 ↗',
  'data-branch-destination="latest">返回主对话',
  'data-branch-destination="caller">切回调用处 ↗',
  'id="branch-landing-latest"',
  'id="branch-landing-caller"',
]) {
  assert.ok(branchNavigation.includes(contract), `missing navigation design contract: ${contract}`);
}
assert.match(
  branchNavigation,
  /class="tl open branch-parent-strip"[\s\S]*class="step" id="branch-parent-call"[\s\S]*class="step-head"[\s\S]*class="step-act"/,
  "returning to the parent must preserve the ordinary timeline-row structure",
);
assert.doesNotMatch(branchNavigation, /class="branch-call"/);
assert.doesNotMatch(chatVisualSpec, /\.branch-call(?:\{|\.|:|#|\[)/);
assert.match(
  chatVisualSpec,
  /is-return-flash'[\s\S]*setTimeout\(\(\)=>branchParentCall\.classList\.remove\('is-return-flash'\),1200\)/,
  "the calling row may flash briefly after return but must not keep a card treatment",
);
assert.match(
  chatVisualSpec,
  /branchContinuation\.hidden=destination==='caller'/,
  "the design must demonstrate that the exact-caller return omits later parent messages",
);
function assertPlainConclusionRules(css) {
  const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter(([_, selectors]) =>
    selectors.split(",").some((selector) => {
      const finalCompound = selector.trim().split(/[\s>+~]+/).at(-1) ?? "";
      return /\.runtime-program-conclusion(?![\w-])/.test(finalCompound);
    }),
  );
  assert.ok(rules.length > 0, "workflow Conclusion outer CSS rules must exist");
  for (const [_, selector, declarations] of rules) {
    assert.doesNotMatch(
      declarations,
      /(?:border|padding)-(?:left|inline-start)(?:-[\w-]+)?\s*:/,
      `${selector.trim()} must render as ordinary chat content, not a blockquote`,
    );
  }
}
assertPlainConclusionRules(chatCss);
assert.throws(
  () => assertPlainConclusionRules(
    `${chatCss}\n.runtime-program-conclusion.is-error { border-inline-start: 2px solid red; padding-inline-start: 14px; }`,
  ),
  /must render as ordinary chat content/,
  "the Conclusion style contract must reject error/cancelled quote-style variants",
);
assert.throws(
  () => assertPlainConclusionRules(
    `${chatCss}\n.is-error.runtime-program-conclusion:hover { border-inline-start: 2px solid red; }`,
  ),
  /must render as ordinary chat content/,
  "the Conclusion style contract must not depend on class order or pseudo-state",
);
assert.doesNotThrow(
  () => assertPlainConclusionRules(
    `${chatCss}\n.runtime-program-conclusion .message-content ul { padding-inline-start: 20px; }`,
  ),
  "semantic Markdown list indentation must remain valid inside Conclusion",
);
assert.match(
  chatCss,
  /\.runtime-program-conclusion-summary\.message-content,\s*\.runtime-program-conclusion-result\.message-content\s*\{[^}]*padding:\s*0/s,
  "workflow summary and direct result must share the same plain-content alignment",
);
assert.match(runtimeBlock, /className="runtime-program-avatar"[\s\S]*>ƒ<\/div>/);
assert.match(runtimeBlock, /if \(nested\)/, "nested LLM tool calls must keep their current rendering");
assert.match(executionStrip, /aria-expanded=\{open\}/);
const timelineBaseIconRule = chatCss.match(/\.tl-step-icon\s*\{([^}]*)\}/)?.[1] ?? "";
assert.match(
  timelineBaseIconRule,
  /position:\s*absolute;[^}]*left:\s*-34px;[^}]*top:\s*50%;[^}]*transform:\s*translateY\(-50%\);[^}]*width:\s*24px;[^}]*height:\s*24px/s,
  "the top-level timeline tile must sit in the 34px indent, centred on its row",
);
assert.match(
  timelineBaseIconRule,
  /border-radius:\s*7px;[^}]*color:\s*var\(--tone\);[^}]*var\(--bg-primary\)/s,
  "timeline tiles must be tone-tinted rounded squares that mask the rail behind them",
);
assert.match(
  chatCss,
  /\.tl-body::before\s*\{[^}]*left:\s*11\.5px;[^}]*width:\s*1px/s,
  "the top-level rail must stay centred behind the 24px tile",
);
assert.match(
  chatCss,
  /\.tl-sub::before\s*\{[^}]*left:\s*9\.5px;[^}]*width:\s*1px/s,
  "the nested rail must stay centred behind the 20px tile",
);
assert.match(
  chatCss,
  /\.tl-sub\s+\.tl-step-icon\s*\{[^}]*left:\s*-30px;[^}]*width:\s*20px;[^}]*height:\s*20px/s,
  "the nested timeline tile geometry must stay fixed",
);
for (const [kind, color, light, dark] of [
  ["thinking", "timeline-thinking", "#7c3aed", "#b78cff"],
  ["function", "timeline-function", "#d14a1f", "#ff9a66"],
  ["llm", "timeline-llm", "#00849a", "#45d7e8"],
  ["subagent", "timeline-subagent", "#0b8a4b", "#4bd58a"],
]) {
  assert.match(
    chatCss,
    new RegExp(`--${color}:\\s*light-dark\\(${light},\\s*${dark}\\)`),
    `${kind} timeline icons must use the vivid light/dark palette`,
  );
  assert.match(
    chatCss,
    new RegExp(`\\.tl-step-icon\\.k-${kind}\\s*\\{[^}]*--tone:\\s*var\\(--${color}\\)`),
    `${kind} timeline rows must retain their type tone`,
  );
}
for (const tone of ["shell", "edit", "read", "search", "web", "agent", "memory", "plan", "media", "system", "function"]) {
  assert.match(
    chatCss,
    new RegExp(`\\.tl-step-icon\\.t-${tone}\\s*\\{[^}]*--tone:`),
    `per-tool tone ${tone} must define a tile colour`,
  );
}
assert.match(
  chatCss,
  /\.tl-step-icon\.is-running::after\s*\{[^}]*conic-gradient[^}]*animation:\s*tlOrbit/s,
  "running steps must keep their glyph and show an orbiting sweep",
);
const timelineRowCollapseRule = chatCss.match(
  /\.tl-step > \.tl-collapse\s*\{([^}]*)\}/,
)?.[1] ?? "";
assert.match(
  timelineRowCollapseRule,
  /opacity:\s*0;[^}]*transform:\s*translateY\(-3px\);[^}]*pointer-events:\s*none;[^}]*grid-template-rows 0\.22s cubic-bezier\(0\.2,\s*0\.7,\s*0\.2,\s*1\)[\s\S]*opacity 0\.14s ease/s,
  "row details must animate from a clipped zero-height state",
);
assert.match(
  chatCss,
  /\.tl-step > \.tl-collapse\.is-open\s*\{[^}]*opacity:\s*1;[^}]*transform:\s*translateY\(0\);[^}]*pointer-events:\s*auto/s,
  "row details must share the open state with the marker animation",
);
assert.match(
  chatCss,
  /\.tl-collapse\s*\{[^}]*transition:\s*grid-template-rows 0\.18s ease/s,
  "the whole execution strip must retain its existing 180ms transition",
);
assert.match(
  baseCss,
  /@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?transition-duration:\s*0\.01ms !important;/,
  "timeline motion must inherit the product reduced-motion duration",
);
assert.match(
  executionStrip,
  /return afterTwoAnimationFrames\(\(\) => setShown\(true\)\);/,
  "Collapse must cancel both staged animation frames when a row closes quickly",
);
assert.match(
  chatCss,
  /\.tl\s*\{[^}]*--timeline-line:\s*light-dark\(rgba\(36, 36, 32, 0\.22\),\s*rgba\(226, 225, 218, 0\.28\)\);/s,
  "the timeline line must stay subdued in both light and dark themes",
);
assert.doesNotMatch(
  chatCss,
  /--timeline-fill|var\(--timeline-fill\)/,
  "expandable markers must not fall back to a neutral grey fill",
);
const timelineIconCssRules = [...chatCss.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter(([_, selectors]) =>
  selectors.includes(".tl-step-icon"),
);
for (const [_, selectors] of timelineIconCssRules) {
  assert.equal(
    selectors.split(",").some((selector) => selector.includes(":hover")),
    false,
    "timeline step icons must not gain a hover-only ring",
  );
}
assert.match(
  chatVisualSpec,
  /\.tl-body::before\{[^}]*left:11\.5px;[^}]*width:1px/s,
  "the design must preserve the top-level rail centre",
);
assert.match(
  chatVisualSpec,
  /\.tl-sub \.step-icon\{left:-30px;width:20px;height:20px/,
  "the design must preserve the nested tile geometry",
);
assert.match(
  executionStrip,
  /\+ \(toggleable \? " is-toggleable" : ""\)/,
  "only expandable rows must mark their existing icon as toggleable",
);
assert.match(
  executionStrip,
  /import \{ SolarIcon, type SolarIconName \} from "@\/components\/solar-icons";/,
  "timeline row tiles must draw Solar Bold Duotone glyphs",
);
assert.match(
  executionStrip,
  /: icon === "llm" \? "cpu" : "sledgehammer"\);/,
  "generic function rows must fall back to the Solar sledgehammer",
);
assert.match(
  executionStrip,
  /<SolarIcon name=\{glyphName\} size=\{13\} motionPreset="none" \/>/,
  "timeline tiles are static: the row is not a hover-animated control",
);
assert.doesNotMatch(
  executionStrip,
  /\b(?:Brain|Wrench|LucideIcon)\b/,
  "timeline tiles must not fall back to lucide line glyphs",
);
assert.doesNotMatch(
  executionStrip,
  /\bWrenchIcon\b/,
  "the timeline must not retain the animated wrench",
);
assert.doesNotMatch(
  executionStrip,
  /else if \(detail\) useSessionStore\.getState\(\)\.showDetail\(detail\)/,
  "clicking outside the underlined title must not open details",
);
assert.doesNotMatch(
  executionStrip,
  /tl-step-disclosure|tl-fold-hint|\bsubCount\b/,
  "timeline rows must not render a separate arrow or descendant-step count",
);
assert.doesNotMatch(
  chatCss,
  /tl-step-disclosure|tl-fold-hint/,
  "timeline CSS must not retain obsolete arrow or step-count styles",
);
assert.match(
  executionStrip,
  /const copyValue = copyText \?\? \[title, target, note\][\s\S]*\.join\(" · "\)/,
  "every timeline row must have a deterministic copy value",
);
assert.match(
  executionStrip,
  /<span className="tl-step-act">\s*<button type="button" className="tl-btn" onClick=\{copy\}>/,
  "every timeline row must render Copy before row-specific actions",
);
const timelineActionRule = chatCss.match(/\.tl-step-act\s*\{([^}]*)\}/)?.[1] ?? "";
assert.doesNotMatch(
  timelineActionRule,
  /transition\s*:/,
  "timeline row actions must switch immediately when the pointer changes rows",
);
assert.doesNotMatch(
  chatCss,
  /\.tl-step-head:focus-within\s+\.tl-step-act/,
  "pointer focus must not leave actions visible on a row after hover moves away",
);
assert.match(
  chatCss,
  /\.tl-step-head:has\(:focus-visible\)\s+\.tl-step-act/,
  "keyboard focus must still reveal timeline row actions",
);
assert.match(
  chatCss,
  /\.tl-toggle\s*\{[^}]*display:\s*inline-flex[^}]*align-items:\s*center[^}]*height:\s*28px[^}]*margin:\s*0 0 1\.5px[^}]*padding:\s*0/s,
);
assert.match(runtimeBlock, /<TreeStep node=\{tree\} defaultKidsOpen\s*\/>/);
assert.doesNotMatch(
  executionStrip,
  /<TreeStep key=\{c\.path \|\| i\} node=\{c\} defaultKidsOpen=\{defaultKidsOpen\}/,
  "manual workflow expansion must stop after one tree level",
);
assert.match(chatCss, /\.runtime-card-host\s*\{[^}]*margin:\s*20px 8px/s);
assert.match(
  chatCss,
  /\.runtime-program-run\s*\{[^}]*grid-template-columns:\s*28px minmax\(0, 1fr\)[^}]*align-items:\s*start/s,
);
assert.match(chatCss, /\.runtime-program-avatar\s*\{[^}]*width:\s*28px[^}]*height:\s*28px[^}]*border-radius:\s*8px/s);
assert.match(chatCss, /\.runtime-program-content\s*\{[^}]*min-width:\s*0/s);
function assertNoSummaryVerticalOffset(css, sourceLabel) {
  for (const [, selector, declarations] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (!/\.runtime-program-avatar|\.runtime-program-content|\.tl-toggle|\.tl-chev/.test(selector)) continue;
    assert.doesNotMatch(
      declarations,
      /(?:^|;)\s*(?:top|bottom|translate|vertical-align|align-self|place-self|margin-top|margin-block(?:-start|-end)?|padding-top|padding-block(?:-start|-end)?|inset-block(?:-start|-end)?)\s*:/,
      `${sourceLabel} must not vertically offset the Function summary`,
    );
    assert.doesNotMatch(
      declarations,
      /(?:^|;)\s*transform\s*:[^;]*translate/i,
      `${sourceLabel} must not translate the Function summary`,
    );
  }
}
assertNoSummaryVerticalOffset(chatCss, "production CSS");
assert.throws(() => assertNoSummaryVerticalOffset(
  ".runtime-program-avatar { transform: translateY(1px); }",
  "avatar offset mutation",
));
assert.throws(() => assertNoSummaryVerticalOffset(
  ".runtime-program-content > .tl > .tl-toggle > span { bottom: -1px; }",
  "label offset mutation",
));
assert.match(
  chatVisualSpec,
  /class="runtime-program-run"[\s\S]*class="runtime-program-avatar"[\s\S]*class="runtime-program-content"[\s\S]*class="tl-toggle"/,
  "the interactive design sample must show the production Function summary structure",
);
assertNoSummaryVerticalOffset(chatVisualSpec, "interactive design sample");

const zh = (en, cn) => cn;
assert.equal(
  runtimeSummaryLabel({
    fnName: "auto_workflow",
    status: "running",
    timestamp: startedAt,
    now: (startedAt + 8) * 1000,
    tree: { name: "root", children: [{ name: "read_file" }] },
    text: zh,
  }),
  "auto_workflow · 运行中… · 00:08 · 2 步",
);
assert.equal(
  runtimeSummaryLabel({
    fnName: "auto_workflow",
    status: "completed",
    tree: { duration_ms: 12_000 },
    text: zh,
  }),
  "auto_workflow · 已完成 · 00:12 · 1 步",
);
for (const [status, summary, expected] of [
  ["succeeded", "已确认页面标题。", "gui_agent · 成功 · 00:00 · 已确认页面标题。"],
  ["failed", "没有可访问的内置页面。", "gui_agent · 失败 · 00:00 · 没有可访问的内置页面。"],
  ["infeasible", "需要登录。", "gui_agent · 需要接手 · 00:00 · 请先登录。"],
]) {
  assert.equal(
    runtimeSummaryLabel({
      fnName: "gui_agent",
      status: "completed",
      tree: {
        duration_ms: 225,
        output: {
          status,
          success: status === "succeeded",
          summary,
          ...(status === "infeasible" ? { handoff_instruction: "请先登录。" } : {}),
        },
      },
      text: zh,
    }),
    expected,
  );
}

console.log("chat-ui checks passed");
