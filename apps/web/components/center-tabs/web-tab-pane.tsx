"use client";

/**
 * WebTabPane — center-column content of a web tab (kind "web").
 *
 * Two rendering backends behind one tab contract ({url, title} in the
 * center-tabs store):
 *
 *  - Desktop shell (window.openprogramDesktop present): a native
 *    Electron WebContentsView positioned by the main process over the
 *    body area of this pane. The pane renders only the toolbar plus an
 *    empty body div whose viewport rect joins the renderer's complete
 *    visible-bounds collection. Real back/forward/reload, no
 *    framing restrictions, so no hint bar.
 *
 *  - Browser fallback: a 40px address toolbar (mono URL input · reload
 *    · open-external) over a sandboxed <iframe>, with a persistent
 *    slim hint bar in between — many sites refuse framing
 *    (X-Frame-Options / CSP frame-ancestors) and a cross-origin load
 *    failure is not reliably detectable from here, so the
 *    open-externally escape hatch stays always visible. No
 *    back/forward buttons: iframe history is unreliable cross-origin.
 */
import { memo, useEffect, useId, useRef, useState } from "react";
import { canvasDragging, onCanvasDragChange } from "@/lib/tabs/canvas-drag";
import type { KeyboardEvent, ReactNode } from "react";
import { ArrowLeft, ArrowRight, ChevronDown, ChevronUp, ExternalLink, House, MessageSquarePlus, PictureInPicture2, RotateCw, Search, Star, X } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import {
  desktopBridge,
  destroyStaleWebViews,
  ensureWebView,
  installDesktopMenuHandlers,
  registerVisibleWebTabBounds,
  removeVisibleWebTabBounds,
  setWebTabReady,
  type DesktopBridge,
} from "@/lib/desktop/desktop-bridge";
import { useTranslation } from "@/lib/i18n";
import { showToast } from "@/lib/format-utils/toast";
import { useSessionStore } from "@/lib/session-store";
import { appendToComposer } from "@/components/chat/messages/quote-to-chat";
import { pageCommentText, pickedElementName, type PickedElement } from "@/lib/browser/page-comment";
import { browserPageShortcut } from "@/lib/browser/browser-layout";
import {
  isBookmarked,
  subscribeBookmarks,
  toggleBookmark,
  updateBookmarkFavicon,
} from "@/lib/tabs/bookmarks";
import { normalizeWebUrl, useCenterTabs } from "@/lib/tabs/center-tabs-store";
import {
  collapseWebTabToPip,
  pipCollapseTargetFor,
  useWebTabPip,
} from "@/lib/browser/web-tab-pip-store";
import {
  browserTakeoverKind,
  controlResourceFromSession,
  displayedControlState,
  revealPendingApproval,
  setControlNotice,
  toggleShowActions,
} from "@/lib/browser/browser-control";
import {
  listedBrowserResources,
  previewTabId,
  useBrowserResourceStore,
} from "@/lib/chat/session-resources";
import { isWebTabOccluded, measureWebTabBounds } from "@/lib/browser/web-tab-bounds";
import styles from "./center-tabs.module.css";
import { webToolbarButton } from "./toolbar-button";
import { BookmarksLibraryButton, BrowserMenu } from "./browser-controls";
import { BookmarkBar } from "./bookmark-bar";
import { AddressField, addressStarButton, ToolbarTip } from "./browser-chrome";
import { ActionCueTravel, BrowserControlBar } from "./browser-control-bar";
import {
  controlSurfaceVisible,
  cueCancelKey,
  prefersCueReducedMotion,
} from "@/lib/browser/browser-action-cue";
import {
  liveOperationMarker,
  operationHistory,
  resumeErrorFor,
  showActionsEnabled,
  useBrowserControlStore,
} from "@/lib/browser/browser-control";

export const WebTabPane = memo(function WebTabPane({ tabId, url, suspended = false }: { tabId: string; url: string; suspended?: boolean }) {
  // Bridge presence is fixed for the lifetime of the page (preload
  // ran or it didn't), so branching in render is stable. Web tabs
  // never server-render (the tabs store is empty during SSR).
  const bridge = desktopBridge();
  const menuOwnerId = useId();
  if (bridge) {
    return <DesktopWebTabPane bridge={bridge} tabId={tabId} url={url} menuOwnerId={menuOwnerId} suspended={suspended} />;
  }
  return <IframeWebTabPane tabId={tabId} url={url} menuOwnerId={menuOwnerId} />;
});

function BookmarkButton({ tabId, url, title }: { tabId: string; url: string; title: string }) {
  const { text } = useTranslation();
  const faviconUrl = useCenterTabs(state => state.tabs.find(tab => tab.id === tabId)?.faviconUrl);
  useEffect(() => updateBookmarkFavicon(url, faviconUrl), [url, faviconUrl]);
  const [bookmarked, setBookmarked] = useState(() => isBookmarked(url));

  useEffect(() => {
    const refresh = () => setBookmarked(isBookmarked(url));
    refresh();
    return subscribeBookmarks(refresh);
  }, [url]);

  const label = text(bookmarked ? "Remove bookmark" : "Bookmark", bookmarked ? "移除书签" : "添加书签");
  return (
    <ToolbarTip label={label}>
      <button
        type="button"
        className={addressStarButton()}
        data-on={bookmarked || undefined}
        onClick={() => toggleBookmark({ url, title, faviconUrl })}
        aria-label={label}
      >
        <Star size={13} fill={bookmarked ? "currentColor" : "none"} />
      </button>
    </ToolbarTip>
  );
}

function findButton() {
  return cn(buttonVariants({ variant: "ghost", size: "icon-xs" }), "rounded-full");
}

function resourceForLiveTab(tabId: string) {
  const row = listedBrowserResources().find(item => previewTabId(item) === tabId);
  return row ? controlResourceFromSession(row) : null;
}


function usePipCollapseTarget(tabId: string) {
  const tabs = useCenterTabs((s) => s.tabs);
  const groups = useCenterTabs((s) => s.groups);
  const boundOwnerId = useWebTabPip((s) => (s.tabId === tabId ? s.ownerTabId : null));
  return boundOwnerId ?? pipCollapseTargetFor(tabId, { tabs, groups });
}

function CollapseToPipButton({ tabId }: { tabId: string }) {
  const { text } = useTranslation();
  const tabs = useCenterTabs((s) => s.tabs);
  const boundOwnerId = useWebTabPip((s) => (s.tabId === tabId ? s.ownerTabId : null));
  const targetId = usePipCollapseTarget(tabId);
  if (!targetId) return null;
  const targetTitle = tabs.find((tab) => tab.id === targetId)?.title
    || text("that session", "该会话");
  const label = boundOwnerId
    ? text(
      `Return to the floating window in “${targetTitle}”`,
      `返回「${targetTitle}」的悬浮窗`,
    )
    : text(`Float over “${targetTitle}”`, `浮动到「${targetTitle}」`);
  return (
    <ToolbarTip label={label}>
      <button
        type="button"
        className={webToolbarButton()}
        onClick={() => collapseWebTabToPip(tabId)}
        aria-label={label}
      >
        <PictureInPicture2 size={14} />
      </button>
    </ToolbarTip>
  );
}

function WebPaneStage({
  children,
}: {
  children: ReactNode;
}) {
  return <div className={styles.webStage}>{children}</div>;
}

function IframeAgentLayer({
  tabId,
  resource,
  navKey,
}: {
  tabId: string;
  resource: ReturnType<typeof resourceForLiveTab>;
  navKey: string;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  useBrowserControlStore(s => s.markers);
  useBrowserControlStore(s => s.showActions);
  const marker = resource ? liveOperationMarker(resource.resourceId, { generation: resource.generation }) : null;
  const point = marker?.point ? { x: marker.point.x, y: marker.point.y } : null;
  const state = resource ? displayedControlState(resource) : undefined;
  if (!controlSurfaceVisible(state) && !point) return null;
  return (
    <div ref={stageRef} className={styles.browserFloatLayer} data-tab={tabId}>
      <ActionCueTravel
        point={point}
        resourceKey={resource?.resourceId || tabId}
        operationKey={marker?.id}
        cancelKey={cueCancelKey({
          resourceId: resource?.resourceId || tabId,
          generation: resource?.generation || 0,
          geometryRevision: marker?.geometry_revision,
          navKey,
        })}
        reducedMotion={prefersCueReducedMotion()}
      />
      <BrowserControlBar resource={resource} compact surface="float" />
    </div>
  );
}

function HomeButton({ tabId }: { tabId: string }) {
  const { text } = useTranslation();
  const label = text("Home", "主页");

  return (
    <ToolbarTip label={label}>
      <button
        type="button"
        className={webToolbarButton(styles.webToolbarMedium)}
        onClick={() => useCenterTabs.getState().replaceWebTabWithNewTabPage(tabId)}
        aria-label={label}
      >
        <House size={14} />
      </button>
    </ToolbarTip>
  );
}

/* ---- Desktop shell: native WebContentsView ------------------------- */

function DesktopWebTabPane({
  suspended,
  bridge,
  tabId,
  url,
  menuOwnerId,
}: {
  suspended: boolean;
  bridge: DesktopBridge;
  tabId: string;
  url: string;
  menuOwnerId: string;
}) {
  const { text } = useTranslation();
  const updateWebTab = useCenterTabs((s) => s.updateWebTab);
  const title = useCenterTabs((s) => s.tabs.find((tab) => tab.id === tabId)?.title || url);
  useBrowserResourceStore(s => s.ingestClock);
  useBrowserControlStore(s => s.showActions);
  useBrowserControlStore(s => s.pending);
  useBrowserControlStore(s => s.resumeError);
  useBrowserControlStore(s => s.history);
  const connected = useBrowserResourceStore(s => s.connected);
  const control = resourceForLiveTab(tabId);
  useEffect(() => {
    const setOverlay = bridge.webTab.setControlOverlay;
    if (!setOverlay) return;
    if (!control || !controlSurfaceVisible(displayedControlState(control))) {
      setOverlay(tabId, null);
      return;
    }
    const state = displayedControlState(control);
    const takeoverKind = browserTakeoverKind(state);
    const pauseLabel = takeoverKind === "reveal"
      ? text("Review request", "查看请求")
      : takeoverKind === "resume"
        ? text("Continue Agent", "让 Agent 继续")
        : takeoverKind === "yielding"
          ? text("Pausing…", "正在暂停…")
          : takeoverKind === "retry"
            ? text("Retry pause", "重试暂停")
            : text("I will operate", "我来操作");
    const status = state === "yielding" ? text("Pausing…", "正在暂停…")
      : state === "waiting" ? text("Needs your confirmation", "需要你确认")
      : state === "paused" ? text("Paused", "已暂停")
      : state === "stop_unconfirmed" ? text("Could not pause. Try again", "暂停失败，请重试")
      : state === "unknown" ? (connected
        ? text("Could not confirm status", "无法确认状态")
        : text("Connection lost", "连接已断开"))
      : text("Active", "活动中");
    const history = operationHistory(control.resourceId);
    const historyItems = history.length === 0
      ? [{ id: "empty", label: text("No operations yet.", "尚无操作。"), disabled: true }]
      : history.map(item => ({
        id: item.id,
        label: `${item.action} · ${item.phase}${item.error ? ` · ${item.error}` : ""}`,
        disabled: true,
      }));
    const payload = {
      resourceId: control.resourceId,
      generation: control.generation,
      conversationSessionId: control.conversationSessionId,
      controlState: state,
      showActions: showActionsEnabled(),
      connected: !!connected,
      status,
      pauseLabel,
      showLabel: text("Show actions", "显示操作"),
      historyLabel: text("Operation history", "操作历史"),
      notice: resumeErrorFor(control.resourceId)
        || (state === "stop_unconfirmed" || state === "unknown" ? status : undefined),
      pauseDisabled: state === "yielding" || state === "unknown" || !connected,
      resumeDisabled: !connected || (state !== "paused" && state !== "waiting"),
      showTakeover: takeoverKind === "reveal",
      expandLabel: text("Show controls", "显示操作按钮"),
      foldLabel: text("Fold", "收起"),
      dismissLabel: text("Dismiss", "关闭"),
      dragLabel: text("Small draggable Agent button. Click to expand. Drag to move.", "可拖动的 Agent 按钮。点击展开。拖动移动。"),
      historyItems,
    };
    setOverlay(tabId, payload);
  }, [bridge, tabId, control, connected, text]);
  useEffect(() => {
    const setOverlay = bridge.webTab.setControlOverlay;
    if (!setOverlay) return;
    return () => { setOverlay(tabId, null); };
  }, [bridge, tabId]);
  useEffect(() => {
    return bridge.webTab.onControlOverlayEvent?.((event) => {
      if (!control) return;
      if (event.type === "stale") {
        setControlNotice(control.resourceId, text("Status changed. Try again", "状态已更新，请重试"));
        return;
      }
      if (event.type !== "pause" && event.type !== "resume" && event.type !== "toggle-show" && event.type !== "reveal") return;
      if (event.id !== control.resourceId && event.id !== tabId) return;
      if (event.generation !== control.generation) {
        setControlNotice(control.resourceId, text("Status changed. Try again", "状态已更新，请重试"));
        return;
      }
      if (event.type === "reveal") revealPendingApproval(control);
      if (event.type === "toggle-show") toggleShowActions();
    }) ?? (() => {});
  }, [bridge, tabId, control]);
  // 历史遗留的白屏竞态可能把 store 里的 url 冲成空串；tab id 本身带着
  // 原始 URL（"w:<url>"），空 url 时从 id 找回，老 tab 自愈。
  const effectiveUrl =
    url || (tabId.startsWith("w:") ? tabId.slice(2) : "");
  const [address, setAddress] = useState(effectiveUrl);
  const [loading, setLoading] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findResult, setFindResult] = useState({ activeMatchOrdinal: 0, matches: 0 });
  const canFind = typeof bridge.webTab.find === "function"
    && typeof bridge.webTab.stopFind === "function";
  const canComment = typeof bridge.webTab.pickElement === "function"
    && typeof bridge.webTab.cancelPick === "function";
  // Comment mode: "picking" while the page waits for a click, then the
  // picked element and the comment being written about it.
  const [comment, setComment] = useState<{ picking: true } | { picking: false; element: PickedElement } | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const pickSeq = useRef(0);
  const commentRef = useRef<HTMLInputElement>(null);
  const canZoom = typeof bridge.webTab.zoom === "function";
  const canPrint = typeof bridge.webTab.print === "function";
  const collapseTarget = usePipCollapseTarget(tabId);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [frozenImage, setFrozenImage] = useState<string | null>(null);
  const [frozen, setFrozen] = useState(false);

  const addressRef = useRef<HTMLInputElement>(null);
  const findRef = useRef<HTMLInputElement>(null);
  // Last URL the native view is known to be at (our navigate calls +
  // onState reports). The store-url effect below only steers the view
  // on real drift, so onState → updateWebTab echoes never re-navigate.
  const viewUrlRef = useRef(effectiveUrl);

  // View lifecycle. Native visibility is published by the bounds effect
  // below as one collection for every mounted web pane. Destroy lives
  // elsewhere — the store subscription installed by
  // installDesktopMenuHandlers destroys views as their tabs close,
  // and the mount-time reconcile sweeps anything that slipped through.
  useEffect(() => {
    installDesktopMenuHandlers();
    destroyStaleWebViews(
      bridge,
      useCenterTabs.getState().tabs.map((t) => t.id),
    );
    ensureWebView(bridge, tabId, viewUrlRef.current);
    // A pane always shows the page at user zoom. Clear any leftover PiP
    // layout zoom here instead of relying on the PiP's unmount cleanup
    // ordering — a stale factor would render the page as a tiny replica.
    bridge.webTab.setPipZoom?.(tabId, null);
    return () => {
      setWebTabReady(tabId, false);
    };
  }, [bridge, tabId]);

  // Bounds: renderer reports the body's viewport-relative CSS px and
  // main converts them to native DIP using the sender's current zoom.
  // Preserve fractional values until main performs the final rounding.
  // Report on mount, resize, and any ancestor scroll.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    // Freezing swaps the native view for a snapshot. Keep the live view on
    // screen until the snapshot exists (or briefly times out), so a drag or
    // a narrow pane never flashes an empty "paused" card first.
    let disposed = false, capturing = false, hidden = false;
    const hide = () => {
      if (disposed || hidden || !capturing) return;
      hidden = true;
      setFrozen(true);
      removeVisibleWebTabBounds(bridge, tabId); setWebTabReady(tabId, false);
    };
    const report = () => {
      // A canvas drag freezes the page whatever its size, so it skips the
      // measure: every frame's restyle would otherwise force a layout here.
      const dragFrozen = canvasDragging() || suspended;
      const bounds = dragFrozen ? null : measureWebTabBounds(el);
      if (!bounds || bounds.width < 320 || bounds.height < 172) {
        if (!capturing) {
          capturing = true;
          const timer = window.setTimeout(hide, 160);
          void Promise.resolve(bridge.webTab.capture?.(tabId, "presentation"))
            .then(image => { if (!disposed && image) setFrozenImage(image); })
            .catch(() => {})
            .finally(() => { window.clearTimeout(timer); hide(); });
        }
        if (hidden) { removeVisibleWebTabBounds(bridge, tabId); setWebTabReady(tabId, false); }
        return;
      }
      capturing = false;
      if (hidden) { hidden = false; setFrozen(false); }
      const occluded = isWebTabOccluded(
        bounds,
        document.querySelectorAll(
          '[role="dialog"], [role="menu"], [role="listbox"], .branches-merge-modal-backdrop, [data-native-view-occluder="true"]',
        ),
      );
      if (occluded || bounds.width <= 0 || bounds.height <= 0) {
        removeVisibleWebTabBounds(bridge, tabId);
        setWebTabReady(tabId, false);
        return;
      }
      registerVisibleWebTabBounds(bridge, tabId, bounds);
      setWebTabReady(tabId, true);
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    const mo = new MutationObserver(report);
    mo.observe(document.body, { subtree: true, childList: true, attributes: true });
    const offCanvasDrag = onCanvasDragChange(report);
    window.addEventListener("resize", report);
    window.addEventListener("scroll", report, true);
    return () => {
      disposed = true;
      offCanvasDrag();
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", report);
      window.removeEventListener("scroll", report, true);
      removeVisibleWebTabBounds(bridge, tabId);
    };
  }, [bridge, tabId, suspended]);

  // Main → renderer state: address bar (unless the user is typing in
  // it), tab title, loading spinner, history-button enablement. URL
  // changes also flow into the store so the tab persists (and later
  // remounts restore) the page actually being viewed.
  useEffect(() => {
    return bridge.webTab.onState((state) => {
      if (state.id !== tabId) return;
      // 空串一律忽略（加载初期 getURL/getTitle 为空；写进 store 会把
      // url 冲空、面板被 app-shell 卸载 → 白屏）。主进程侧已过滤，这里
      // 是第二道保险。
      if (state.url) {
        viewUrlRef.current = state.url;
        if (document.activeElement !== addressRef.current) {
          setAddress(state.url);
        }
        updateWebTab(tabId, { url: state.url });
      }
      if (state.title) updateWebTab(tabId, { title: state.title });
      // 空串是有意义的（导航到无 favicon 的页面 → 清图标），不能按真值过滤。
      if (state.faviconUrl !== undefined) {
        updateWebTab(tabId, { faviconUrl: state.faviconUrl });
      }
      if (state.loading !== undefined) setLoading(state.loading);
      if (state.canGoBack !== undefined) setCanGoBack(state.canGoBack);
      if (state.canGoForward !== undefined) setCanGoForward(state.canGoForward);
    });
  }, [bridge, tabId, updateWebTab]);

  useEffect(() => bridge.webTab.onFindResult?.((result) => {
    if (result.id === tabId) setFindResult(result);
  }), [bridge, tabId]);

  useEffect(() => bridge.webTab.onCommand?.((command) => {
    if (command.id !== tabId) return;
    if (command.command === "find") {
      setFindOpen(true);
      window.requestAnimationFrame(() => findRef.current?.focus());
    } else if (command.command === "focus-address") {
      focusAddress();
    }
  }), [bridge, tabId]);

  useEffect(() => () => {
    bridge.webTab.stopFind?.(tabId, "clearSelection");
    bridge.webTab.cancelPick?.(tabId);
  }, [bridge, tabId]);

  // A page that navigates away takes its element picker with it.
  useEffect(() => {
    pickSeq.current += 1;
    setComment(null);
  }, [url]);

  // Store url changed by someone else (session restore, future agent
  // navigation) → steer the view. Our own updates (navigate() below,
  // onState echoes) already advanced viewUrlRef, so they no-op here.
  useEffect(() => {
    if (!url || url === viewUrlRef.current) return; // 空串不算漂移
    viewUrlRef.current = url;
    bridge.webTab.navigate(tabId, url);
    if (document.activeElement !== addressRef.current) setAddress(url);
  }, [bridge, tabId, url]);

  function navigate() {
    const normalized = normalizeWebUrl(address);
    if (!normalized) {
      setAddress(viewUrlRef.current); // invalid input → snap back
      return;
    }
    setAddress(normalized);
    if (normalized === viewUrlRef.current) {
      bridge.webTab.reload(tabId); // same URL → treat Enter as reload
    } else {
      viewUrlRef.current = normalized;
      bridge.webTab.navigate(tabId, normalized);
      updateWebTab(tabId, { url: normalized });
    }
  }

  function navigateTo(nextUrl: string) {
    const normalized = normalizeWebUrl(nextUrl);
    if (!normalized) return;
    setAddress(normalized);
    viewUrlRef.current = normalized;
    bridge.webTab.navigate(tabId, normalized);
    updateWebTab(tabId, { url: normalized });
  }

  function openFind() {
    if (!canFind) return;
    setFindOpen(true);
    window.requestAnimationFrame(() => {
      findRef.current?.focus();
      findRef.current?.select();
    });
  }

  function startComment() {
    if (!canComment) return;
    const seq = ++pickSeq.current;
    setComment({ picking: true });
    setCommentDraft("");
    void bridge.webTab.pickElement?.(tabId).then((element) => {
      if (seq !== pickSeq.current) return;
      if (!element) {
        setComment(null);
        return;
      }
      setComment({ picking: false, element });
      window.requestAnimationFrame(() => commentRef.current?.focus());
    });
  }

  function closeComment() {
    pickSeq.current += 1;
    bridge.webTab.cancelPick?.(tabId);
    setComment(null);
    setCommentDraft("");
  }

  function submitComment() {
    if (!comment || comment.picking || !commentDraft.trim()) return;
    const state = useSessionStore.getState();
    const chatKey = state.activeChatKey ?? state.currentSessionId;
    if (!chatKey) {
      showToast(text("Open a conversation to add the comment to", "先打开一个对话，再添加评论"));
      return;
    }
    appendToComposer(chatKey, pageCommentText(comment.element, commentDraft), false);
    showToast(text("Comment added to your message", "评论已加入消息"));
    closeComment();
  }

  function focusAddress() {
    window.requestAnimationFrame(() => {
      addressRef.current?.focus();
      addressRef.current?.select();
    });
  }

  function closeFind() {
    bridge.webTab.stopFind?.(tabId, "clearSelection");
    setFindOpen(false);
    setFindResult({ activeMatchOrdinal: 0, matches: 0 });
  }

  function runFind(nextQuery: string, forward = true, findNext = true) {
    setFindQuery(nextQuery);
    if (!nextQuery) {
      bridge.webTab.stopFind?.(tabId, "clearSelection");
      setFindResult({ activeMatchOrdinal: 0, matches: 0 });
      return;
    }
    bridge.webTab.find?.(tabId, nextQuery, { forward, findNext });
  }

  function handleRendererShortcut(event: KeyboardEvent<HTMLDivElement>) {
    const action = browserPageShortcut(event);
    if (!action) return;
    if (action === "find" && !canFind) return;
    if ((action === "zoom-in" || action === "zoom-out" || action === "reset-zoom") && !canZoom) return;
    if (action === "print" && !canPrint) return;
    if (action === "back" && !canGoBack) return;
    if (action === "forward" && !canGoForward) return;
    event.preventDefault();
    if (action === "find") openFind();
    if (action === "focus-address") focusAddress();
    if (action === "back") bridge.webTab.goBack(tabId);
    if (action === "forward") bridge.webTab.goForward(tabId);
    if (action === "zoom-in") void bridge.webTab.zoom?.(tabId, "in");
    if (action === "zoom-out") void bridge.webTab.zoom?.(tabId, "out");
    if (action === "reset-zoom") void bridge.webTab.zoom?.(tabId, "reset");
    if (action === "print") void bridge.webTab.print?.(tabId);
  }

  return (
    <div
      className={styles.webPane}
      data-state={control ? displayedControlState(control) : undefined}
      onKeyDownCapture={handleRendererShortcut}
    >
      <div className={styles.webChrome}>
      <div className={styles.webToolbar}>
        <ToolbarTip label={text("Back", "后退")} shortcut={{ key: "[" }}>
          <button
            type="button"
            className={webToolbarButton()}
            onClick={() => {
              bridge.webTab.goBack(tabId);
            }}
            disabled={!canGoBack}
            aria-label={text("Back", "后退")}
          >
            <ArrowLeft size={14} />
          </button>
        </ToolbarTip>
        <ToolbarTip label={text("Forward", "前进")} shortcut={{ key: "]" }}>
          <button
            type="button"
            className={webToolbarButton(styles.webToolbarForward)}
            onClick={() => {
              bridge.webTab.goForward(tabId);
            }}
            disabled={!canGoForward}
            aria-label={text("Forward", "前进")}
          >
            <ArrowRight size={14} />
          </button>
        </ToolbarTip>
        <ToolbarTip
          label={loading ? text("Stop loading", "停止加载") : text("Reload", "重新加载")}
          shortcut={loading ? undefined : { key: "R" }}
        >
          <button
            type="button"
            className={webToolbarButton(loading && styles.webStopLoading)}
            onClick={() => {
              if (loading) bridge.webTab.stop(tabId);
              else {
                bridge.webTab.reload(tabId);
              }
            }}
            aria-label={loading ? text("Stop loading", "停止加载") : text("Reload", "重新加载")}
          >
            {loading ? <X size={14} /> : <RotateCw size={14} />}
          </button>
        </ToolbarTip>
        <HomeButton tabId={tabId} />
        <AddressField
          inputRef={addressRef}
          value={address}
          onChange={setAddress}
          onSubmit={navigate}
          ariaLabel={text("Address", "地址")}
        >
          <BookmarkButton tabId={tabId} url={effectiveUrl} title={title || effectiveUrl} />
        </AddressField>
        <BookmarksLibraryButton />
        <ToolbarTip label={text("Open in browser", "在浏览器中打开")}>
          <button
            type="button"
            className={webToolbarButton(styles.webToolbarMedium)}
            onClick={() => bridge.openExternal(viewUrlRef.current)}
            aria-label={text("Open in browser", "在浏览器中打开")}
          >
            <ExternalLink size={14} />
          </button>
        </ToolbarTip>
        <CollapseToPipButton tabId={tabId} />
        <BrowserMenu
          ownerId={menuOwnerId}
          actions={{
            home: () => useCenterTabs.getState().replaceWebTabWithNewTabPage(tabId),
            forward: () => {
              bridge.webTab.goForward(tabId);
            },
            openExternal: () => bridge.openExternal(viewUrlRef.current),
            find: canFind ? openFind : undefined,
            comment: canComment ? startComment : undefined,
            zoomIn: canZoom ? () => { void bridge.webTab.zoom?.(tabId, "in"); } : undefined,
            zoomOut: canZoom ? () => { void bridge.webTab.zoom?.(tabId, "out"); } : undefined,
            resetZoom: canZoom ? () => { void bridge.webTab.zoom?.(tabId, "reset"); } : undefined,
            print: canPrint ? () => { void bridge.webTab.print?.(tabId); } : undefined,
            collapseToPip: collapseTarget
              ? () => { collapseWebTabToPip(tabId); }
              : undefined,
          }}
          canGoForward={canGoForward}
        />
      </div>
      <BookmarkBar ownerId={menuOwnerId} onNavigate={navigateTo} />
      {loading && (
        <div
          className={styles.webLoadingProgress}
          role="status"
          aria-label={text("Loading page", "正在加载网页")}
        />
      )}
      </div>
      {findOpen ? (
        <div className={styles.webFindBar}>
          <div className={styles.webFindPill}>
          <Search size={12} aria-hidden="true" />
          <input
            ref={findRef}
            value={findQuery}
            onChange={(event) => runFind(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") closeFind();
              if (event.key === "Enter" && findQuery) {
                runFind(findQuery, !event.shiftKey, false);
              }
            }}
            placeholder={text("Find in page", "在页面中查找")}
            aria-label={text("Find in page", "在页面中查找")}
          />
          <span className={styles.webFindCount} aria-live="polite">
            {findResult.matches > 0 ? `${findResult.activeMatchOrdinal} / ${findResult.matches}` : "0 / 0"}
          </span>
          <span className={styles.webFindSep} aria-hidden="true" />
          <button type="button" className={findButton()} onClick={() => runFind(findQuery, false, false)} disabled={!findQuery} aria-label={text("Previous match", "上一个匹配项")}>
            <ChevronUp size={13} />
          </button>
          <button type="button" className={findButton()} onClick={() => runFind(findQuery, true, false)} disabled={!findQuery} aria-label={text("Next match", "下一个匹配项")}>
            <ChevronDown size={13} />
          </button>
          <button type="button" className={findButton()} onClick={closeFind} aria-label={text("Close find", "关闭查找")}>
            <X size={13} />
          </button>
          </div>
        </div>
      ) : null}
      {comment ? (
        <div className={styles.webFindBar}>
          <form
            className={styles.webFindPill}
            onSubmit={(event) => {
              event.preventDefault();
              submitComment();
            }}
          >
            <MessageSquarePlus size={12} aria-hidden="true" />
            {comment.picking ? (
              <span className={styles.webCommentHint} aria-live="polite">
                {text("Click an element on the page · Esc to cancel", "点击页面上的元素 · Esc 取消")}
              </span>
            ) : (
              <>
                <span className={styles.webCommentTarget}>{pickedElementName(comment.element)}</span>
                <input
                  ref={commentRef}
                  value={commentDraft}
                  onChange={(event) => setCommentDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing) return;
                    if (event.key === "Escape") {
                      event.preventDefault();
                      closeComment();
                    }
                  }}
                  placeholder={text("Comment for the agent", "给 agent 的评论")}
                  aria-label={text("Comment on this element", "评论这个元素")}
                />
                <span className={styles.webFindSep} aria-hidden="true" />
                <button type="submit" className={cn(buttonVariants({ variant: "ghost", size: "xs" }), "rounded-full")} disabled={!commentDraft.trim()}>
                  {text("Add to message", "加入消息")}
                </button>
              </>
            )}
            <button type="button" className={findButton()} onClick={closeComment} aria-label={text("Close comment", "关闭评论")}>
              <X size={13} />
            </button>
          </form>
        </div>
      ) : null}
      <WebPaneStage>
      <div
        ref={bodyRef}
        className={styles.webFrame}
        data-web-frame={tabId}
        style={{ position: "relative", overflow: "hidden" }}
      >
        {frozen ? <button type="button" onClick={() => useCenterTabs.getState().setActive(tabId)} style={{ position:"absolute",inset:0,border:0,padding:0,background:"var(--bg-primary)",color:"var(--text-secondary)",cursor:"pointer" }}>
          {frozenImage ? <img src={frozenImage} alt={text("Frozen webpage", "网页快照")} style={{ width:"100%",height:"100%",objectFit:"cover",objectPosition:"top left" }} /> : text("Webpage paused — select to activate", "网页已暂停，点击激活")}
        </button> : null}
      </div>
      </WebPaneStage>
    </div>
  );
}

/* ---- Browser fallback: sandboxed iframe ---------------------------- */

function IframeWebTabPane({ tabId, url, menuOwnerId }: { tabId: string; url: string; menuOwnerId: string }) {
  const { text } = useTranslation();
  const updateWebTab = useCenterTabs((s) => s.updateWebTab);
  const title = useCenterTabs((s) => s.tabs.find((tab) => tab.id === tabId)?.title || url);
  useBrowserResourceStore(s => s.ingestClock);
  const control = resourceForLiveTab(tabId);
  const [address, setAddress] = useState(url);
  // Bumping remounts the iframe — that's the reload button.
  const [frameEpoch, setFrameEpoch] = useState(0);
  const collapseTarget = usePipCollapseTarget(tabId);

  // Store url changed elsewhere (restore, future agent navigation) →
  // resync the address bar.
  useEffect(() => setAddress(url), [url]);

  function navigate() {
    const normalized = normalizeWebUrl(address);
    if (!normalized) {
      setAddress(url); // invalid input → snap back to the real URL
      return;
    }
    setAddress(normalized);
    if (normalized === url) {
      setFrameEpoch((e) => e + 1); // same URL → treat Enter as reload
    } else {
      updateWebTab(tabId, { url: normalized });
    }
  }

  function openExternal() {
    window.open(url, "_blank", "noopener");
  }

  function navigateTo(nextUrl: string) {
    const normalized = normalizeWebUrl(nextUrl);
    if (!normalized) return;
    setAddress(normalized);
    updateWebTab(tabId, { url: normalized });
  }

  return (
    <div
      className={styles.webPane}
      data-state={control ? displayedControlState(control) : undefined}
    >
      <div className={styles.webChrome}>
      <div className={styles.webToolbar}>
        <ToolbarTip label={text("Reload", "重新加载")}>
          <button
            type="button"
            className={webToolbarButton()}
            onClick={() => {
              setFrameEpoch((e) => e + 1);
            }}
            aria-label={text("Reload", "重新加载")}
          >
            <RotateCw size={14} />
          </button>
        </ToolbarTip>
        <HomeButton tabId={tabId} />
        <AddressField
          value={address}
          onChange={setAddress}
          onSubmit={navigate}
          ariaLabel={text("Address", "地址")}
        >
          <BookmarkButton tabId={tabId} url={url} title={title} />
        </AddressField>
        <BookmarksLibraryButton />
        <ToolbarTip label={text("Open in browser", "在浏览器中打开")}>
          <button
            type="button"
            className={webToolbarButton(styles.webToolbarMedium)}
            onClick={openExternal}
            aria-label={text("Open in browser", "在浏览器中打开")}
          >
            <ExternalLink size={14} />
          </button>
        </ToolbarTip>
        <CollapseToPipButton tabId={tabId} />
        <BrowserMenu
          ownerId={menuOwnerId}
          actions={{
            home: () => useCenterTabs.getState().replaceWebTabWithNewTabPage(tabId),
            openExternal,
            collapseToPip: collapseTarget
              ? () => { collapseWebTabToPip(tabId); }
              : undefined,
          }}
        />
      </div>
      <BookmarkBar ownerId={menuOwnerId} onNavigate={navigateTo} />
      </div>
      {url.startsWith("file:") ? (
        /* Browsers silently block file:// in iframes — say so instead of
           showing a blank frame. */
        <WebPaneStage>
        <div
          className={styles.webFrame}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-dim)",
            fontSize: "13px",
            padding: "24px",
            textAlign: "center",
          }}
        >
          {text(
            "Local files can only be opened in the desktop app.",
            "本地文件仅能在桌面应用中打开。",
          )}
        </div>
        </WebPaneStage>
      ) : (
        <>
          <div className={styles.webHint}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
              {text(
                "If the page stays blank, the site refuses embedding — open it externally.",
                "页面空白说明该站点拒绝内嵌，请点右上角外部打开。",
              )}
            </span>
            <button type="button" className={styles.webHintLink} onClick={openExternal}>
              <ExternalLink size={11} />
              {text("Open externally", "外部打开")}
            </button>
          </div>
          <WebPaneStage>
          <iframe
            key={frameEpoch}
            className={styles.webFrame}
            src={url}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            referrerPolicy="no-referrer"
            title={text("Web page", "网页")}
          />
          <IframeAgentLayer tabId={tabId} resource={control} navKey={`${url}:${frameEpoch}`} />
          </WebPaneStage>
        </>
      )}
    </div>
  );
}
