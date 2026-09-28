"use client";
import { useEffect, useRef, useState } from "react";
import { Columns2, Equal, FileText, Globe, LayoutGrid, Maximize2, MessageSquare, Minimize2, Rows2, Save, SquareDashed, X } from "lucide-react";
import { useCenterTabs, type CenterTab } from "@/lib/tabs/center-tabs-store";
import { findCenterTabGroup } from "@/lib/tabs/center-tab-groups";
import { canvasGeometry, leaves, presetLayout, insertPane, removePane, equalize, resizeSplit, mapNode, type CanvasLayout, type CanvasPreset } from "@/lib/tabs/canvas-layout";
import { setCanvasDragging, startPaneDrag } from "@/lib/tabs/canvas-drag";
import { useTranslation } from "@/lib/i18n";
import styles from "./canvas-controls.module.css";

/** Preset glyphs: CSS grid tracks + one cell per pane (grid-area when spanning). */
const PRESETS: ReadonlyArray<{ id: CanvasPreset; en: string; zh: string; cols: string; rows: string; cells: string[] }> = [
  { id: "1x1", en: "Single", zh: "单屏", cols: "1fr", rows: "1fr", cells: [""] },
  { id: "1x2", en: "Columns", zh: "左右", cols: "1fr 1fr", rows: "1fr", cells: ["", ""] },
  { id: "2x1", en: "Rows", zh: "上下", cols: "1fr", rows: "1fr 1fr", cells: ["", ""] },
  { id: "main+2", en: "Main + 2", zh: "主 + 2", cols: "1.4fr 1fr", rows: "1fr 1fr", cells: ["1 / 1 / 3 / 2", "", ""] },
  { id: "2x2", en: "4", zh: "四宫格", cols: "repeat(2, 1fr)", rows: "repeat(2, 1fr)", cells: Array(4).fill("") },
  { id: "3x3", en: "9", zh: "九宫格", cols: "repeat(3, 1fr)", rows: "repeat(3, 1fr)", cells: Array(9).fill("") },
  { id: "4x4", en: "16", zh: "十六宫格", cols: "repeat(4, 1fr)", rows: "repeat(4, 1fr)", cells: Array(16).fill("") },
];

function TabIcon({ tab }: { tab: CenterTab | undefined }) {
  if (tab?.kind === "web") return <Globe aria-hidden />;
  if (tab?.kind === "file") return <FileText aria-hidden />;
  if (tab?.kind === "session") return <MessageSquare aria-hidden />;
  return <SquareDashed aria-hidden />;
}

/** Panes carry no title bar: content fills the pane, and an iPadOS-style grip
 *  at the top centre moves the pane (drag) and opens its menu (click). A lone
 *  pane shows no chrome at all. */
export function CanvasControls({ layout, targetId, width, height }: { layout: CanvasLayout; targetId: string; width: number; height: number }) {
  const { text } = useTranslation();
  const tabs = useCenterTabs(s => s.tabs), groups = useCenterTabs(s => s.groups);
  const [saved, setSaved] = useState<Array<{ name: string; layout: CanvasLayout }>>([]);
  const [menu, setMenu] = useState<{ x: number; y: number; paneId: string } | null>(null);
  const [saveName, setSaveName] = useState<string | null>(null);
  const [activeDivider, setActiveDivider] = useState<string | null>(null);
  const gripStart = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => { try { const v = JSON.parse(localStorage.getItem("centerCanvasPresets") || "[]"); if (Array.isArray(v)) setSaved(v); } catch {} }, []);
  useEffect(() => {
    if (!menu) return;
    const dismiss = () => { setMenu(null); setSaveName(null); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") dismiss(); };
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", key);
    window.addEventListener("resize", dismiss);
    return () => { window.removeEventListener("pointerdown", dismiss); window.removeEventListener("keydown", key); window.removeEventListener("resize", dismiss); };
  }, [menu]);
  const all = leaves(layout.root), geometry = canvasGeometry(layout.root, { left: 0, top: 0, width, height: Math.max(0,height) });
  const update = (canvas: CanvasLayout) => useCenterTabs.getState().setCanvas(targetId, canvas);
  const focus = (paneId: string) => update({ ...layout, focusedPaneId: paneId });
  const zoom = (paneId: string) => update({ ...layout, focusedPaneId: paneId, zoomedPaneId: layout.zoomedPaneId === paneId ? undefined : paneId });
  const close = (paneId: string) => update({ ...layout, zoomedPaneId: undefined, root: removePane(layout.root, paneId) });
  const split = (side: "right" | "bottom") => { const next = insertPane(layout.root, layout.focusedPaneId, side, null); update({ root: next.root, focusedPaneId: next.paneId }); };
  const applyPreset = (preset: CanvasPreset) => update(presetLayout(preset, all.flatMap(p => p.content ? [p.content] : [])));
  const closeMenu = () => { setMenu(null); setSaveName(null); };
  const openMenu = (paneId: string, x: number, y: number) => {
    focus(paneId); setSaveName(null);
    setMenu({ paneId, x: Math.max(8, Math.min(x, window.innerWidth - 240)), y: Math.max(8, Math.min(y, window.innerHeight - 420)) });
  };
  const openMenuBelow = (paneId: string, grip: HTMLElement) => { const b = grip.getBoundingClientRect(); openMenu(paneId, b.left + b.width / 2 - 116, b.bottom + 6); };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.code === "Backslash") { e.preventDefault(); split(e.shiftKey ? "bottom" : "right"); }
      else if (e.shiftKey && e.key === "Enter") { e.preventDefault(); zoom(layout.focusedPaneId); }
      else if (e.key.toLowerCase() === "w" && all.length > 1) { e.preventDefault(); e.stopImmediatePropagation(); close(layout.focusedPaneId); }
      else if (e.altKey && e.key.startsWith("Arrow")) {
        const current = geometry.panes.get(layout.focusedPaneId); if (!current) return;
        const axis = e.key === "ArrowLeft" || e.key === "ArrowRight" ? "x" : "y";
        const sign = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1;
        const candidates = all.filter(p => p.id !== layout.focusedPaneId).map(p => {
          const r = geometry.panes.get(p.id)!; const dx = r.left+r.width/2-current.left-current.width/2, dy = r.top+r.height/2-current.top-current.height/2;
          return { id:p.id, along: (axis === "x" ? dx : dy)*sign, score: Math.hypot(dx,dy)+Math.abs(axis === "x" ? dy : dx)*2 };
        }).filter(p => p.along > 1).sort((a,b) => a.score-b.score);
        if (candidates[0]) { e.preventDefault(); focus(candidates[0].id); }
      }
    };
    window.addEventListener("keydown", key, true); return () => window.removeEventListener("keydown", key, true);
  });
  const mod = typeof navigator !== "undefined" && /Mac/.test(navigator.platform) ? "⌘" : "Ctrl+";
  const dockable = tabs.filter(t => !t.canvasAnchor && !findCenterTabGroup(groups, t.id));
  const single = all.length === 1 && !!all[0].content;
  const titleOf = (tab: CenterTab | undefined) => tab?.title || (tab ? text("Untitled","未命名") : text("Empty pane","空格"));
  const menuPane = menu ? all.find(p => p.id === menu.paneId) : undefined;
  const menuTab = tabs.find(t => t.id === menuPane?.content);
  const menuZoomed = !!menuPane && layout.zoomedPaneId === menuPane.id;
  return <>
    {menu && <div role="menu" className={styles.menu} data-native-view-occluder="true" onPointerDown={e => e.stopPropagation()} style={{ top: menu.y, left: menu.x }}>
      {menuPane && <>
        <div className={styles.menuTitle}><TabIcon tab={menuTab} /><span>{titleOf(menuTab)}</span></div>
        {all.length > 1 && <>
          <button type="button" role="menuitem" className={styles.menuItem} onClick={() => { zoom(menuPane.id); closeMenu(); }}>{menuZoomed ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}{menuZoomed ? text("Restore", "还原") : text("Zoom", "放大")}<span className={styles.shortcut}>{mod}⇧↩</span></button>
          <button type="button" role="menuitem" className={styles.menuItem} onClick={() => { close(menuPane.id); closeMenu(); }}><X aria-hidden />{text("Close pane", "关闭格子")}<span className={styles.shortcut}>{mod}W</span></button>
        </>}
        <div className={styles.separator} />
      </>}
      <div className={styles.menuLabel}>{text("Layout", "布局")}</div>
      <div className={styles.presets}>
        {PRESETS.map(p => <button key={p.id} type="button" role="menuitem" className={styles.preset} title={text(p.en, p.zh)} onClick={() => { applyPreset(p.id); closeMenu(); }}>
          <span className={styles.presetIcon} style={{ gridTemplateColumns: p.cols, gridTemplateRows: p.rows }} aria-hidden>
            {p.cells.map((area, i) => <i key={i} style={area ? { gridArea: area } : undefined} />)}
          </span>
          {text(p.en, p.zh)}
        </button>)}
      </div>
      {saved.length > 0 && <>
        <div className={styles.separator} />
        <div className={styles.menuLabel}>{text("Saved layouts", "已保存布局")}</div>
        {saved.map((s, i) => <button key={i} type="button" role="menuitem" className={styles.menuItem} onClick={() => { update(s.layout); closeMenu(); }}><LayoutGrid aria-hidden />{s.name}</button>)}
      </>}
      <div className={styles.separator} />
      <button type="button" role="menuitem" className={styles.menuItem} onClick={() => { split("right"); closeMenu(); }}><Columns2 aria-hidden />{text("Split right", "向右切分")}<span className={styles.shortcut}>{mod}\</span></button>
      <button type="button" role="menuitem" className={styles.menuItem} onClick={() => { split("bottom"); closeMenu(); }}><Rows2 aria-hidden />{text("Split below", "向下切分")}<span className={styles.shortcut}>{mod}⇧\</span></button>
      <button type="button" role="menuitem" className={styles.menuItem} onClick={() => { update({ ...layout, root: equalize(layout.root) }); closeMenu(); }}><Equal aria-hidden />{text("Equalize", "等分")}</button>
      <div className={styles.separator} />
      {saveName === null
        ? <button type="button" role="menuitem" className={styles.menuItem} onClick={() => setSaveName("")}><Save aria-hidden />{text("Save layout…", "保存布局…")}</button>
        : <form className={styles.saveForm} onSubmit={e => { e.preventDefault(); if (!saveName.trim()) return; const next=[...saved.filter(s => s.name !== saveName.trim()), { name:saveName.trim(),layout }]; setSaved(next); localStorage.setItem("centerCanvasPresets",JSON.stringify(next)); closeMenu(); }}>
          <input autoFocus className={styles.saveInput} value={saveName} placeholder={text("Layout name", "布局名称")} aria-label={text("Layout name", "布局名称")} onChange={e => setSaveName(e.target.value)} />
          <button className={styles.saveButton}>{text("Save", "保存")}</button>
        </form>}
    </div>}
    {all.map(p => {
      const rect=geometry.panes.get(p.id)!;
      const visible = !layout.zoomedPaneId || layout.zoomedPaneId === p.id;
      const zoomed = layout.zoomedPaneId === p.id;
      const r = zoomed ? { left:0,top:0,width,height } : rect;
      const tab=tabs.find(t => t.id === p.content), tiny=r.width<150 || r.height<110;
      const title = titleOf(tab);
      return <div key={p.id} className={styles.pane} data-canvas-pane={p.id} data-canvas-target={targetId} data-single={single || undefined} data-focused={(!single && layout.focusedPaneId === p.id) || undefined} style={{ ...r, display: visible ? undefined : "none" }}>
        {!p.content
          ? <div className={styles.empty}>
              <div className={styles.emptyCard}>
                <div className={styles.emptyHint}>{dockable.length ? text("Choose a tab, or drag one here", "选一个 tab，或直接拖进来") : text("Drag a tab here", "把 tab 拖到这里")}</div>
                {dockable.map(t => <button key={t.id} type="button" className={styles.emptyItem} onClick={() => useCenterTabs.getState().dockCanvas(t.id,targetId,p.id,"center")}><TabIcon tab={t} /><span>{t.title || t.kind}</span></button>)}
              </div>
            </div>
          : tiny ? <button type="button" className={styles.tiny} title={title} onClick={() => zoom(p.id)}><span><TabIcon tab={tab} /><Maximize2 aria-hidden /></span></button> : null}
        {!single && <div role="button" tabIndex={0} className={styles.grip} title={title}
          aria-label={text(`Pane options: ${title}`, `格子选项：${title}`)} aria-haspopup="menu" aria-expanded={menu?.paneId === p.id}
          onPointerDown={e => { if (e.button !== 0) return; e.stopPropagation(); gripStart.current = { x: e.clientX, y: e.clientY }; focus(p.id); if (p.content) startPaneDrag(e, p.content); }}
          onClick={e => {
            const s = gripStart.current; gripStart.current = null;
            if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 6) return; // a drag, not a click
            if (menu?.paneId === p.id) closeMenu(); else openMenuBelow(p.id, e.currentTarget);
          }}
          onContextMenu={e => { e.preventDefault(); e.stopPropagation(); openMenu(p.id, e.clientX, e.clientY); }}
          onKeyDown={e => { if (e.key !== "Enter" && e.key !== " ") return; e.preventDefault(); openMenuBelow(p.id, e.currentTarget); }}>
          <i /><i /><i />
        </div>}
      </div>;
    })}
    {!layout.zoomedPaneId && geometry.dividers.map(d => { const key = `${d.splitId}:${d.index}`; return <div key={key} className={styles.divider} data-active={activeDivider === key || undefined} role="separator" aria-orientation={d.dir === "row" ? "vertical" : "horizontal"} aria-valuenow={Math.round(d.sizes[d.index]*100)} tabIndex={0}
      style={{ left:d.left,top:d.top,width:d.width,height:d.height }}
      onDoubleClick={() => update({ ...layout,root:mapNode(layout.root,d.splitId,n => n.kind === "split" ? { ...n,sizes:n.sizes.map((s,i) => i===d.index || i===d.index+1 ? (n.sizes[d.index]+n.sizes[d.index+1])/2 : s) } : n) })}
      onKeyDown={e => { if (!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(e.key)) return; e.preventDefault(); update({ ...layout,root:resizeSplit(layout.root,d.splitId,d.index,e.key==="ArrowLeft"||e.key==="ArrowUp"?-.02:.02) }); }}
      onPointerDown={e => {
        if(e.button!==0) return; e.preventDefault(); const start=d.dir==="row"?e.clientX:e.clientY;
        setCanvasDragging(true); setActiveDivider(key);
        const move=(event:PointerEvent) => update({ ...layout,root:resizeSplit(layout.root,d.splitId,d.index,((d.dir==="row"?event.clientX:event.clientY)-start)/Math.max(1,d.span)) });
        const end=() => { window.removeEventListener("pointermove",move); window.removeEventListener("pointerup",end); window.removeEventListener("pointercancel",end); setCanvasDragging(false); setActiveDivider(null); };
        window.addEventListener("pointermove",move); window.addEventListener("pointerup",end,{once:true}); window.addEventListener("pointercancel",end,{once:true});
      }} />; })}
  </>;
}
