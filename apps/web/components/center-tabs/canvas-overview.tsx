"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { topLevelTabs } from "@/lib/browser/web-page-management";
import { canvasGeometry, leaves, removePane, rowLayout, type LayoutNode } from "@/lib/tabs/canvas-layout";
import { desktopBridge } from "@/lib/desktop/desktop-bridge";
import { canvasDragging } from "@/lib/tabs/canvas-drag";
import { captureVisiblePanes, captureWebTabs, pruneSnapshots, restoreSnapshots, useWindowSnapshots } from "@/lib/tabs/window-snapshots";
import { closeOverview, dismissOverview, openOverview, setOverviewZoomOut, useCanvasOverview, type OverviewSide } from "@/lib/tabs/canvas-overview";
import { centerTabStripEntries } from "@/lib/tabs/center-tab-groups";
import { useCenterTabs, type CenterTab } from "@/lib/tabs/center-tabs-store";
import { useTranslation } from "@/lib/i18n";
import { CompoundMemberIcon, labelOf } from "./tab-items";
import styles from "./canvas-overview.module.css";

type Card = { key: string; targetId: string; activateId: string; root: LayoutNode; title: string };

const ZONE: Record<OverviewSide, React.CSSProperties> = {
  left: { left: 0, top: 0, width: "50%", height: "100%" },
  right: { left: "50%", top: 0, width: "50%", height: "100%" },
  top: { left: 0, top: 0, width: "100%", height: "50%" },
  bottom: { left: 0, top: "50%", width: "100%", height: "50%" },
};
const GAP = 24, CAPTION = 26;
const ZOOM: KeyframeAnimationOptions = { duration: 340, easing: "cubic-bezier(.2, .8, .2, 1)" };
type Box = { left: number; top: number; width: number; height: number };

/** Where a window's panes sit on screen, which is also what their pictures
 *  show: the center area less the canvas padding, and each split pane
 *  card's 1px inset. */
function windowBox(canvas: HTMLElement, split: boolean): Box {
  const r = canvas.getBoundingClientRect(), inset = split ? 7 : 6;
  return { left: r.left + inset, top: r.top + inset, width: r.width - inset * 2, height: r.height - inset * 2 };
}
/** The transform that lays an element sitting at `at` over `over`. */
function lay(over: Box, at: DOMRect) {
  return `translate(${over.left - at.left}px, ${over.top - at.top}px) scale(${over.width / at.width}, ${over.height / at.height})`;
}
const reducedMotion = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Columns and card width that make n cards of this aspect as large as
 *  the area allows, never wider than half of it (Mission Control keeps
 *  even a lone window visibly smaller than the desktop). */
function fit(n: number, width: number, height: number, aspect: number) {
  let best = 0;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    best = Math.max(best, Math.min((width - GAP * (cols - 1)) / cols, ((height - GAP * (rows - 1)) / rows - CAPTION) * aspect));
  }
  return Math.max(96, Math.min(best, width * 0.5));
}

/** A trackpad pinch arrives as a wheel event with ctrlKey; a mouse wheel
 *  notch is a multiple of 120 in the legacy wheelDeltaY. */
function isPinch(e: WheelEvent) {
  const notch = (e as unknown as { wheelDeltaY?: number }).wheelDeltaY;
  return e.ctrlKey && !(e.deltaX === 0 && typeof notch === "number" && notch !== 0 && notch % 120 === 0);
}

/** Every window in the strip as a card that keeps its split, over the
 *  center area. See lib/tabs/canvas-overview.ts for when it opens. */
export function CanvasOverview() {
  const { t, text } = useTranslation();
  const { mode, sourceIds, hover, label } = useCanvasOverview();
  const tabs = useCenterTabs(s => s.tabs), groups = useCenterTabs(s => s.groups), activeId = useCenterTabs(s => s.activeId);
  const rootRef = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState({ width: 0, height: 0, canvasWidth: 0, canvasHeight: 0 });

  // Pinch in on the center area (or the strip) opens the overview, pinch
  // out closes it, as in Safari. Content that zooms itself on a pinch
  // (the context graph) prevents the default first and keeps the gesture.
  useEffect(() => {
    let total = 0, spent = false, timer: number | undefined;
    const wheel = (e: WheelEvent) => {
      if (!isPinch(e) || e.defaultPrevented) return;
      const target = e.target as Element | null;
      if (!target?.closest?.("[data-canvas-root], [data-canvas-overview], .desktop-tab-row, [role='tablist']")) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { total = 0; spent = false; }, 220);
      if (spent) return;
      total += e.deltaY;
      const open = useCanvasOverview.getState().mode;
      if (!open && total > 30) { spent = true; void captureVisiblePanes().then(() => openOverview("browse")); }
      else if (open === "browse" && total < -30) { spent = true; dismissOverview(); }
    };
    window.addEventListener("wheel", wheel, { passive: true });
    // A web page is its own native view, so its pinch comes from the desktop
    // shell, only when the page is at its normal size.
    const offWebPinch = desktopBridge()?.webTab.onCommand?.(command => {
      if (command.command === "overview" && !useCanvasOverview.getState().mode) void captureVisiblePanes().then(() => openOverview("browse"));
    });
    return () => { window.removeEventListener("wheel", wheel); window.clearTimeout(timer); offWebPinch?.(); };
  }, []);

  // A window on screen is pictured once it settles (after a switch or a
  // layout change), when the App loses focus or hides, and every 30s while
  // nobody is using it, so its card (saved across restarts) looks like it
  // did when it was last seen.
  useEffect(() => {
    let timer: number | undefined, lastInput = Date.now();
    const input = () => { lastInput = Date.now(); };
    const idle = window.setInterval(() => {
      if (document.visibilityState === "visible" && Date.now() - lastInput > 5000 && !canvasDragging()) void captureVisiblePanes();
    }, 30000);
    const hidden = () => { if (document.visibilityState === "hidden") now(); };
    const later = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { if (!canvasDragging()) void captureVisiblePanes(); }, 900);
    };
    const now = () => { if (!canvasDragging()) void captureVisiblePanes(); };
    void restoreSnapshots();
    later();
    const off = useCenterTabs.subscribe((s, prev) => {
      if (s.activeId !== prev.activeId || s.groups !== prev.groups) later();
      if (s.tabs !== prev.tabs) pruneSnapshots(new Set(s.tabs.map(tab => tab.id)));
    });
    window.addEventListener("blur", now);
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pointerdown", input, true);
    window.addEventListener("keydown", input, true);
    window.addEventListener("wheel", input, { capture: true, passive: true });
    return () => {
      off(); window.clearTimeout(timer); window.clearInterval(idle);
      window.removeEventListener("blur", now);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pointerdown", input, true);
      window.removeEventListener("keydown", input, true);
      window.removeEventListener("wheel", input, true);
    };
  }, []);

  useEffect(() => {
    if (mode !== "browse") return;
    // Escape here must not also stop a running reply in the chat below.
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); dismissOverview(); } };
    // Anything outside (a tab, a sidebar) dismisses it; the strip button toggles.
    const press = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (!target?.closest?.("[data-canvas-overview], [data-overview-toggle]")) closeOverview();
    };
    window.addEventListener("keydown", key, true);
    window.addEventListener("pointerdown", press, true);
    // Focus the overview itself, not a card: a card would wear a focus
    // ring as it zooms in. Tab still reaches the cards.
    rootRef.current?.focus({ preventScroll: true });
    return () => { window.removeEventListener("keydown", key, true); window.removeEventListener("pointerdown", press, true); };
  }, [mode]);

  useLayoutEffect(() => {
    const el = rootRef.current, canvas = el?.parentElement;
    if (!el || !canvas) return;
    const measure = () => setArea({ width: el.clientWidth - 64, height: el.clientHeight - 112, canvasWidth: canvas.clientWidth, canvasHeight: canvas.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [mode]);

  const shots = useWindowSnapshots(s => s.shots);
  // Web pages keep a live view even off screen; picture them fresh.
  useEffect(() => {
    if (!mode) return;
    const { tabs: all, groups: grouped } = useCenterTabs.getState();
    const onScreen = new Set([...document.querySelectorAll<HTMLElement>("[data-canvas-root] [data-canvas-content]")].filter(pane => pane.offsetWidth > 0).map(pane => pane.dataset.canvasContent));
    const listed = new Set(topLevelTabs(all, grouped).map(tab => tab.id).concat(grouped.flatMap(group => group.memberIds)));
    captureWebTabs(all.filter(tab => tab.kind === "web" && listed.has(tab.id) && !onScreen.has(tab.id)).map(tab => tab.id));
  }, [mode]);

  const cards = useMemo<Card[]>(() => {
    if (!mode) return [];
    const byId = new Map(tabs.map(tab => [tab.id, tab]));
    const name = (id: string) => { const tab = byId.get(id); return tab ? labelOf(tab, t, text) : ""; };
    const leaving = new Set(sourceIds);
    return centerTabStripEntries({ tabIds: topLevelTabs(tabs, groups).map(tab => tab.id), groups }).flatMap<Card>(entry => {
      let root: LayoutNode = entry.kind === "group" ? (entry.group.canvas ?? rowLayout(entry.group.memberIds)).root : rowLayout([entry.tabId]).root;
      for (const p of leaves(root)) if (p.content && leaving.has(p.content)) root = removePane(root, p.id);
      const contents = leaves(root).flatMap(p => p.content && byId.has(p.content) && !byId.get(p.content)!.canvasAnchor ? [p.content] : []);
      if (!contents.length) return [];
      const activateId = entry.kind === "group" && contents.includes(entry.group.focusedId) ? entry.group.focusedId : contents[0];
      return [{ key: entry.id, targetId: contents[0], activateId, root, title: contents.map(name).join(" + ") }];
    });
  }, [mode, sourceIds, tabs, groups, t, text]);

  const activeKey = cards.find(card => leaves(card.root).some(p => p.content === activeId))?.key;
  const aspectNow = area.canvasWidth > 0 && area.canvasHeight > 0 ? area.canvasWidth / area.canvasHeight : 16 / 10;
  const widthNow = area.width > 0 ? fit(Math.max(1, cards.length), area.width, area.height, aspectNow) : 0;

  // Opening: the window on screen shrinks into its card, like Mission
  // Control, so nothing else needs to mark which one it is.
  const entered = useRef(false);
  useLayoutEffect(() => {
    if (mode !== "browse") { entered.current = false; return; }
    const root = rootRef.current, canvas = root?.parentElement;
    if (entered.current || !widthNow || !root || !canvas) return;
    entered.current = true;
    const card = root.querySelector<HTMLElement>("[data-current]"), mini = card?.querySelector<HTMLElement>("[data-overview-mini]");
    if (!card || !mini || reducedMotion()) return;
    card.setAttribute("data-zooming", "");
    const from = lay(windowBox(canvas, card.hasAttribute("data-split")), mini.getBoundingClientRect());
    mini.animate([{ transform: from, transformOrigin: "0 0" }, { transform: "none", transformOrigin: "0 0" }], ZOOM)
      .finished.catch(() => {}).finally(() => card.removeAttribute("data-zooming"));
  }, [mode, widthNow]);

  // Closing: the chosen card (or the current one) grows back to fill the
  // center area, then the overview goes. Picking a card switches to its
  // window first, so the live window is ready underneath when it lands.
  const leaving = useRef(false);
  const zoomOutTo = (pick: Card | null) => {
    const root = rootRef.current, canvas = root?.parentElement;
    if (leaving.current || !root || !canvas) return;
    if (pick) window.dispatchEvent(new CustomEvent("op-activate-center-tab", { detail: { tabId: pick.activateId } }));
    const key = pick?.key ?? activeKey;
    const card = key ? root.querySelector<HTMLElement>(`[data-overview-card="${CSS.escape(key)}"]`) : null;
    const mini = card?.querySelector<HTMLElement>("[data-overview-mini]");
    if (!card || !mini || reducedMotion()) { closeOverview(); return; }
    leaving.current = true;
    root.setAttribute("data-leaving", "");
    card.setAttribute("data-zooming", "");
    const to = lay(windowBox(canvas, card.hasAttribute("data-split")), mini.getBoundingClientRect());
    const done = () => { leaving.current = false; closeOverview(); };
    mini.animate([{ transform: "none", transformOrigin: "0 0" }, { transform: to, transformOrigin: "0 0" }], { ...ZOOM, fill: "forwards" })
      .finished.then(done, done);
  };
  const zoomOutRef = useRef(zoomOutTo);
  zoomOutRef.current = zoomOutTo;
  useEffect(() => {
    if (mode !== "browse") return;
    setOverviewZoomOut(() => zoomOutRef.current(null));
    return () => setOverviewZoomOut(null);
  }, [mode]);

  if (!mode) return null;
  const activeCard = cards.find(card => leaves(card.root).some(p => p.content === activeId))?.key;
  const aspect = area.canvasWidth > 0 && area.canvasHeight > 0 ? area.canvasWidth / area.canvasHeight : 16 / 10;
  const cardWidth = area.width > 0 ? fit(Math.max(1, cards.length), area.width, area.height, aspect) : 0;
  // Panes fill the card edge to edge; the canvas's outer padding would
  // leave a sliver between the card and its outline.
  const viewport = { left: 0, top: 0, width: area.canvasWidth || 1000, height: area.canvasHeight || 625 };
  const byId = new Map(tabs.map(tab => [tab.id, tab]));
  const activate = (card: Card) => zoomOutTo(card);
  const hint = label || (mode === "drag"
    ? text("Drop on a window to merge · on empty space to open on its own · outside the window for a new window", "拖到某个窗口上合并 · 空白处单独打开 · 拖出窗口新开一个")
    : text("Click a window to switch · Esc to close", "点击窗口切换 · Esc 关闭"));

  return (
    <div
      ref={rootRef}
      className={styles.overview}
      data-canvas-overview={mode}
      data-native-view-occluder="true"
      data-alone={hover?.card === null || undefined}
      role={mode === "browse" ? "dialog" : undefined}
      tabIndex={mode === "browse" ? -1 : undefined}
      aria-label={text("Window overview", "窗口总览")}
      onClick={mode === "browse" ? e => { if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.overviewGrid !== undefined) dismissOverview(); } : undefined}
    >
      <div className={styles.grid} data-overview-grid="">
        {cards.map(card => {
          const geometry = canvasGeometry(card.root, viewport);
          const hot = hover?.card === card.key;
          const body = (
            <>
              <span className={styles.mini} data-overview-mini="" style={{ aspectRatio: `${aspect}` }}>
                {leaves(card.root).map(p => {
                  const r = geometry.panes.get(p.id)!;
                  const tab: CenterTab | undefined = p.content ? byId.get(p.content) : undefined;
                  const shot = tab ? shots[tab.id] : undefined;
                  return (
                    <span key={p.id} className={styles.pane} data-empty={!tab || undefined} data-shot={shot ? "" : undefined} style={{
                      left: `${(r.left / viewport.width) * 100}%`, top: `${(r.top / viewport.height) * 100}%`,
                      width: `${(r.width / viewport.width) * 100}%`, height: `${(r.height / viewport.height) * 100}%`,
                    }}>
                      {shot ? <img className={styles.shot} src={shot} alt="" draggable={false} /> : tab && !tab.canvasAnchor ? (
                        <>
                          <span className={styles.paneTitle}><CompoundMemberIcon tab={tab} animate={false} /><span>{labelOf(tab, t, text)}</span></span>
                          <i className={styles.line} /><i className={styles.line} style={{ width: "62%" }} />
                        </>
                      ) : null}
                    </span>
                  );
                })}
                {hot && hover?.side ? <span className={styles.zone} style={ZONE[hover.side]} /> : null}
              </span>
              <span className={styles.caption}>{card.title}</span>
            </>
          );
          const shared = {
            className: styles.card,
            style: { width: cardWidth || undefined },
            "data-overview-card": card.key,
            "data-overview-target": card.targetId,
            "data-overview-title": card.title,
            "data-hot": hot || undefined,
            "data-current": card.key === activeCard || undefined,
            "data-split": leaves(card.root).length > 1 || undefined,
          };
          return mode === "browse"
            ? <button key={card.key} type="button" {...shared} aria-label={card.title} onClick={() => activate(card)}>{body}</button>
            : <div key={card.key} {...shared}>{body}</div>;
        })}
      </div>
      <div className={styles.hint} role="status" aria-live="polite">{hint}</div>
    </div>
  );
}
