"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { topLevelTabs } from "@/lib/browser/web-page-management";
import { canvasGeometry, canvasViewport, leaves, removePane, rowLayout, type LayoutNode } from "@/lib/tabs/canvas-layout";
import { closeOverview, openOverview, useCanvasOverview, type OverviewSide } from "@/lib/tabs/canvas-overview";
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
      if (!open && total > 30) { spent = true; openOverview("browse"); }
      else if (open === "browse" && total < -30) { spent = true; closeOverview(); }
    };
    window.addEventListener("wheel", wheel, { passive: true });
    return () => { window.removeEventListener("wheel", wheel); window.clearTimeout(timer); };
  }, []);

  useEffect(() => {
    if (mode !== "browse") return;
    // Escape here must not also stop a running reply in the chat below.
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); closeOverview(); } };
    // Anything outside (a tab, a sidebar) dismisses it; the strip button toggles.
    const press = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (!target?.closest?.("[data-canvas-overview], [data-overview-toggle]")) closeOverview();
    };
    window.addEventListener("keydown", key, true);
    window.addEventListener("pointerdown", press, true);
    rootRef.current?.querySelector<HTMLElement>("[data-current]")?.focus({ preventScroll: true });
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

  if (!mode) return null;
  const activeCard = cards.find(card => leaves(card.root).some(p => p.content === activeId))?.key;
  const aspect = area.canvasWidth > 0 && area.canvasHeight > 0 ? area.canvasWidth / area.canvasHeight : 16 / 10;
  const cardWidth = area.width > 0 ? fit(Math.max(1, cards.length), area.width, area.height, aspect) : 0;
  const viewport = canvasViewport(area.canvasWidth || 1000, area.canvasHeight || 625);
  const byId = new Map(tabs.map(tab => [tab.id, tab]));
  const activate = (card: Card) => {
    closeOverview();
    window.dispatchEvent(new CustomEvent("op-activate-center-tab", { detail: { tabId: card.activateId } }));
  };
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
      aria-label={text("Window overview", "窗口总览")}
      onClick={mode === "browse" ? e => { if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.overviewGrid !== undefined) closeOverview(); } : undefined}
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
                  return (
                    <span key={p.id} className={styles.pane} data-empty={!tab || undefined} style={{
                      left: `${(r.left / viewport.width) * 100}%`, top: `${(r.top / viewport.height) * 100}%`,
                      width: `${(r.width / viewport.width) * 100}%`, height: `${(r.height / viewport.height) * 100}%`,
                    }}>
                      {tab && !tab.canvasAnchor ? (
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
