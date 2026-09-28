"use client";
import { useEffect, useState, type CSSProperties } from "react";
import { useCenterTabs } from "@/lib/tabs/center-tabs-store";
import { findCenterTabGroup } from "@/lib/tabs/center-tab-groups";
import { canvasGeometry, leaves, presetLayout, insertPane, removePane, equalize, resizeSplit, mapNode, type CanvasLayout, type CanvasPreset } from "@/lib/tabs/canvas-layout";
import { setCanvasDragging, startPaneDrag } from "@/lib/tabs/canvas-drag";
import { useTranslation } from "@/lib/i18n";

export const CANVAS_HEADER = 28;
export function CanvasControls({ layout, targetId, width, height }: { layout: CanvasLayout; targetId: string; width: number; height: number }) {
  const { text } = useTranslation();
  const tabs = useCenterTabs(s => s.tabs), groups = useCenterTabs(s => s.groups);
  const [saved, setSaved] = useState<Array<{ name: string; layout: CanvasLayout }>>([]);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [saveName, setSaveName] = useState<string | null>(null);
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
  const button: CSSProperties = { background:"var(--bg-tertiary)", color:"var(--text-secondary)", border:"1px solid var(--border)", borderRadius:4, cursor:"pointer", padding:"1px 6px", fontSize:12 };
  return <>
    {menu && <div role="menu" data-native-view-occluder="true" onPointerDown={e => e.stopPropagation()} style={{ position:"fixed", top:menu.y,left:menu.x,width:220,maxHeight:"calc(100vh - 16px)",overflowY:"auto",display:"flex",flexDirection:"column",gap:6,padding:8,zIndex:100001,background:"var(--bg-secondary)",border:"1px solid var(--border)",borderRadius:6,boxShadow:"0 6px 24px #0005" }}>
      <select aria-label={text("Layout preset", "布局预设")} style={button} value="" onChange={e => {
        if (e.target.value.startsWith("saved:")) { const entry=saved[Number(e.target.value.slice(6))]; if (entry) update(entry.layout); }
        else update(presetLayout(e.target.value as CanvasPreset, all.flatMap(p => p.content ? [p.content] : [])));
        setMenu(null);
      }}>
        <option value="" disabled>{text("Layout", "布局")}</option>
        {([['1x1','Single','单屏'],['1x2','Columns','左右'],['2x1','Rows','上下'],['main+2','Main + 2','主 + 2'],['2x2','4 panes','四宫格'],['3x3','9 panes','九宫格'],['4x4','16 panes','十六宫格']] as const).map(([v,en,zh]) => <option key={v} value={v}>{text(en,zh)}</option>)}
        {saved.map((s,i) => <option key={i} value={`saved:${i}`}>{s.name}</option>)}
      </select>
      <button style={button} onClick={() => { split("right"); setMenu(null); }} title={text("Split right", "向右切分")}>{text("Split right", "向右切分")}</button>
      <button style={button} onClick={() => { split("bottom"); setMenu(null); }} title={text("Split below", "向下切分")}>{text("Split below", "向下切分")}</button>
      <button style={button} onClick={() => { update({ ...layout,root:equalize(layout.root) }); setMenu(null); }}>{text("Equalize", "等分")}</button>
      <button style={button} onClick={() => setSaveName("")}>{text("Save layout", "保存布局")}</button>
      {saveName !== null && <form onSubmit={e => { e.preventDefault(); if (!saveName.trim()) return; const next=[...saved.filter(s => s.name !== saveName.trim()), { name:saveName.trim(),layout }]; setSaved(next); localStorage.setItem("centerCanvasPresets",JSON.stringify(next)); setSaveName(null); setMenu(null); }} style={{ display:"flex",gap:4 }}>
        <input autoFocus value={saveName} placeholder={text("Layout name", "布局名称")} onChange={e => setSaveName(e.target.value)} style={{ ...button,width:120 }} /><button style={button}>{text("Save","保存")}</button><button type="button" style={button} onClick={() => setSaveName(null)}>×</button>
      </form>}
    </div>}
    {all.map(p => {
      const rect=geometry.panes.get(p.id)!;
      const visible = !layout.zoomedPaneId || layout.zoomedPaneId === p.id;
      const r = layout.zoomedPaneId === p.id ? { left:0,top:0,width,height } : rect;
      const tab=tabs.find(t => t.id === p.content), tiny=r.width<150 || r.height<110;
      return <div key={p.id} data-canvas-pane={p.id} data-canvas-target={targetId} style={{ position:"absolute",...r,display:visible?undefined:"none",pointerEvents:"none",zIndex:10,border:`1px solid ${layout.focusedPaneId===p.id?'var(--accent)':'var(--border)'}`,borderRadius:6,boxSizing:"border-box" }}>
        <div onContextMenu={e => { e.preventDefault(); e.stopPropagation(); focus(p.id); setSaveName(null); setMenu({ x:Math.max(8,Math.min(e.clientX,window.innerWidth-236)), y:Math.max(8,Math.min(e.clientY,window.innerHeight-260)) }); }} onPointerDown={e => { if (e.button !== 0) return; focus(p.id); if(p.content) startPaneDrag(e,p.content); }} style={{ pointerEvents:"auto",height:CANVAS_HEADER,display:"flex",alignItems:"center",gap:3,padding:"0 5px",background:"var(--bg-secondary)",cursor:"grab",color:"var(--text-secondary)",fontSize:12 }}>
          <span style={{ overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis",flex:1 }}>{tab?.title || (tab ? text("Untitled","未命名") : text("Empty pane","空格"))}</span>
          <button style={button} title={text("Zoom / restore","放大 / 还原")} onClick={() => zoom(p.id)}>↗</button>
          <button style={button} title={text("Return content to tab strip","关闭格子，内容回到标签栏")} onClick={() => close(p.id)}>×</button>
        </div>
        {!p.content ? <div style={{ pointerEvents:"auto",padding:8,overflow:"auto",height:`calc(100% - ${CANVAS_HEADER}px)`,background:"var(--bg-primary)",display:"flex",alignContent:"center",justifyContent:"center",flexWrap:"wrap",gap:5 }}>
          {tabs.filter(t => !findCenterTabGroup(groups,t.id)).map(t => <button key={t.id} style={button} onClick={() => useCenterTabs.getState().dockCanvas(t.id,targetId,p.id,"center")}>{t.title || t.kind}</button>)}
        </div> : tiny ? <button style={{ ...button,position:"absolute",inset:`${CANVAS_HEADER}px 0 0`,pointerEvents:"auto" }} onClick={() => zoom(p.id)}>{tab?.kind} ↗</button> : null}
      </div>;
    })}
    {!layout.zoomedPaneId && geometry.dividers.map(d => <div key={`${d.splitId}:${d.index}`} role="separator" aria-orientation={d.dir === "row" ? "vertical" : "horizontal"} aria-valuenow={Math.round(d.sizes[d.index]*100)} tabIndex={0}
      style={{ position:"absolute",left:d.left,top:d.top,width:d.width,height:d.height,cursor:d.dir==="row"?"col-resize":"row-resize",zIndex:11 }}
      onDoubleClick={() => update({ ...layout,root:mapNode(layout.root,d.splitId,n => n.kind === "split" ? { ...n,sizes:n.sizes.map((s,i) => i===d.index || i===d.index+1 ? (n.sizes[d.index]+n.sizes[d.index+1])/2 : s) } : n) })}
      onKeyDown={e => { if (!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(e.key)) return; e.preventDefault(); update({ ...layout,root:resizeSplit(layout.root,d.splitId,d.index,e.key==="ArrowLeft"||e.key==="ArrowUp"?-.02:.02) }); }}
      onPointerDown={e => {
        if(e.button!==0) return; e.preventDefault(); const start=d.dir==="row"?e.clientX:e.clientY;
        setCanvasDragging(true);
        const move=(event:PointerEvent) => update({ ...layout,root:resizeSplit(layout.root,d.splitId,d.index,((d.dir==="row"?event.clientX:event.clientY)-start)/Math.max(1,d.span)) });
        const end=() => { window.removeEventListener("pointermove",move); window.removeEventListener("pointerup",end); window.removeEventListener("pointercancel",end); setCanvasDragging(false); };
        window.addEventListener("pointermove",move); window.addEventListener("pointerup",end,{once:true}); window.addEventListener("pointercancel",end,{once:true});
      }} />)}
  </>;
}
