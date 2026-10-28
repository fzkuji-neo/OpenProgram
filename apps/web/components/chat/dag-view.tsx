"use client";

/**
 * DagView — the session context DAG as a CENTER perspective.
 *
 * The graph used to be a right-sidebar tab, squeezed into a 288px rail.
 * It now takes the whole center column: same host DOM (`#historyPanel`
 * + `.history-body`), which is what `lib/runtime-bridge/dag` selects
 * imperatively, so the renderer needed no change — only a wider box.
 * `_wirePanelResize` (render/visibility.ts) already re-lays-out on host
 * width changes, so the switch and any window resize re-flow the graph.
 *
 * Mounted alongside the transcript and toggled with `display`, not
 * unmounted: the renderer writes into this DOM on every WebSocket
 * capture regardless of which perspective is showing, so tearing the
 * host down would drop the graph until the next capture.
 *
 * Layout: the canvas, and — supplied by the pane, not by this
 * component — the composer. Branch switching lives INSIDE the graph:
 * each lane's tail name tag (render/badges.ts) is the checkout button,
 * so no strip row sits above the canvas. The composer is a
 * singleton anchored inside `#chatView`, which the graph perspective
 * deliberately leaves mounted (it hides `#chatArea` instead), so
 * sending a message from the graph runs the same code path as sending
 * it from the transcript and the new node appears on the next capture.
 *
 * The white fill means context coverage here, with no mode switch to
 * offer (dag/rendering.md §8). Viewport highlighting answers "which
 * bubbles are on screen", and whenever this component is visible it
 * owns its pane with no transcript beside it: a lone session tab gets
 * the chat shell and this graph, and two session tabs split into two
 * `PeerSessionPane`s where the shell — and therefore this graph — is
 * not rendered at all. So the question has no reading to give, and
 * coverage is simply what the fill means.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Map as MapIcon, Minus, Plus, Scan, Shapes } from "lucide-react";
import { SolarIcon } from "@/components/solar-icons";
import type { SolarIconName } from "@/components/solar-icons/bodies";

import { useTranslation } from "@/lib/i18n";
import { getSocket, runtimeState } from "@/lib/runtime-bridge/state";
import { useSessionStore } from "@/lib/session-store";
import { enterExclusiveCoverageMode, renderHistoryGraph } from "@/lib/runtime-bridge/dag";
import { fitCanvas, resetZoom, zoomStep } from "@/lib/runtime-bridge/dag/interaction/canvas";
import { minimapOn, subscribeMinimap, toggleMinimap } from "@/lib/runtime-bridge/dag/interaction/minimap";
import { MENU_PANEL } from "@/components/chat/top-bar/menu-styles";
import { DagCanvasTools } from "@/components/chat/dag-tools";

/** A tile swatch: the same `dag-tile t-<tone>` classes the canvas tiles
 *  carry (render/tiles.ts, app/styles/dag/nodes.css), so the key and the
 *  canvas can never drift apart. */
function LegendTile({ icon, tone, state = "covered" }: {
  icon: SolarIconName;
  tone: string;
  state?: "covered" | "outline" | "error";
}) {
  return (
    <span className={`dag-tile t-${tone} dag-legend-tile`} data-state={state} aria-hidden="true">
      <SolarIcon name={icon} size={16} motionPreset="none" />
    </span>
  );
}

function LegendRow({ swatch, label }: { swatch: React.ReactNode; label: string }) {
  return (
    <div className="dag-legend-row">
      {swatch}
      <span>{label}</span>
    </div>
  );
}

/** Key for shape and coverage. A button in the zoom column; the body
 *  opens to the column's left. Starts collapsed: the vocabulary is
 *  small and learnable. */
function DagLegend() {
  const { text } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  // 标准弹层收尾：点面板外任意处或按 Esc 关闭。pointerdown 在 click
  // 之前，命中图例自身（含按钮）时跳过，按钮自己的 onClick 负责开关。
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="dag-legend" ref={rootRef}>
      <button
        type="button"
        className="dag-tool-btn"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-pressed={open}
        aria-label={text("Legend", "图例")}
        data-tip={open ? undefined : text("Legend", "图例")}
        data-tip-side="left"
      >
        <Shapes size={16} strokeWidth={2} />
      </button>
      {open && (
        // 面板框架（圆角/描边/底色/阴影/内衬）来自 MENU_PANEL——全应用
        // 弹层菜单共用的那一份视觉定义；.dag-legend-body 只负责锚位
        // （在竖列左边展开）和行的排版。
        <div className={`dag-legend-body ${MENU_PANEL}`}>
          <LegendRow swatch={<LegendTile icon="user-rounded" tone="user" />} label={text("your message", "你的消息")} />
          <LegendRow swatch={<LegendTile icon="ghost" tone="llm" />} label={text("agent reply", "agent 回复")} />
          <LegendRow swatch={<LegendTile icon="programming" tone="shell" />}
            label={text("tool call — same icon as in the chat", "工具调用，图标与对话里一致")} />
          <LegendRow swatch={<LegendTile icon="ghost" tone="agent" />} label={text("a sub-agent starts", "子 agent 起点")} />
          <LegendRow swatch={<LegendTile icon="archive" tone="memory" />} label={text("compaction summary", "压缩摘要")} />
          <LegendRow swatch={<LegendTile icon="ghost" tone="llm" state="outline" />}
            label={text("faint: not in the next request", "浅色：不在下次请求里")} />
          <LegendRow swatch={<LegendTile icon="programming" tone="shell" state="error" />}
            label={text("failed", "失败")} />
          <LegendRow swatch={<span className="dag-legend-agent" aria-hidden="true"><LegendTile icon="ghost" tone="llm" /></span>}
            label={text("an agent, on the step it is working on", "agent 站在它正在做的那一步上")} />
          <LegendRow swatch={<span className="dag-legend-belt" aria-hidden="true" />}
            label={text("goods on a belt: work is under way there", "传送带运货：那里正在工作")} />
        </div>
      )}
    </div>
  );
}

/** The zoom column on the canvas's right edge, above the composer
 *  (dag/rendering.md §13): one raised strip holding zoom in, the
 *  readout (click: back to 100%), zoom out and, under a hairline, show
 *  the whole graph; a second strip under it opens the legend and turns
 *  the minimap on and off. Both open to the column's left, so nothing
 *  sits in the corner unasked. The readout is written by
 *  `dag/interaction/canvas.ts` on every view change — it is the
 *  camera's number, and routing it through React state would repaint
 *  the tree on every wheel event of a gesture. */
function DagZoomColumn() {
  const { text } = useTranslation();
  const mapOn = useSyncExternalStore(subscribeMinimap, minimapOn, minimapOn);
  return (
    <div className="dag-zoom-column">
      <div className="dag-tool-rail" role="toolbar" aria-orientation="vertical"
        aria-label={text("Zoom", "缩放")}>
        <button type="button" className="dag-tool-btn" onClick={() => zoomStep(1)}
          aria-label={text("Zoom in", "放大")} aria-keyshortcuts="+"
          data-tip={text("Zoom in · +", "放大 · +")} data-tip-side="left">
          <Plus size={16} strokeWidth={2} />
        </button>
        <button type="button" className="dag-tool-btn dag-zoom-readout" onClick={() => resetZoom()}
          aria-keyshortcuts="Shift+0"
          data-tip={text("Back to 100% · ⇧0", "回到 100% · ⇧0")} data-tip-side="left">
          100%
        </button>
        <button type="button" className="dag-tool-btn" onClick={() => zoomStep(-1)}
          aria-label={text("Zoom out", "缩小")} aria-keyshortcuts="-"
          data-tip={text("Zoom out · −", "缩小 · −")} data-tip-side="left">
          <Minus size={16} strokeWidth={2} />
        </button>
        <span className="dag-tool-sep" aria-hidden="true" />
        <button type="button" className="dag-tool-btn" onClick={() => fitCanvas()}
          aria-label={text("Show the whole graph", "显示整张图")} aria-keyshortcuts="Shift+1"
          data-tip={text("Show the whole graph · ⇧1", "显示整张图 · ⇧1")} data-tip-side="left">
          <Scan size={16} strokeWidth={2} />
        </button>
      </div>
      <div className="dag-tool-rail" role="toolbar" aria-orientation="vertical"
        aria-label={text("Legend and minimap", "图例和小地图")}>
        <DagLegend />
        <button type="button" className="dag-tool-btn" onClick={() => toggleMinimap()}
          aria-pressed={mapOn} aria-label={text("Minimap", "小地图")} aria-keyshortcuts="M"
          data-tip={mapOn ? text("Hide the minimap · M", "隐藏小地图 · M") : text("Show the minimap · M", "显示小地图 · M")}
          data-tip-side="left">
          <MapIcon size={16} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

export function DagView({ visible }: { visible: boolean }) {
  const sessionId=useSessionStore(s=>s.currentSessionId);
  useEffect(()=>{
    const send=()=>{
      const sock=getSocket();
      if(!sessionId || !sock || sock.readyState!==WebSocket.OPEN)return;
      sock.send(JSON.stringify({action:"list_branches",session_id:sessionId,graph_visible:visible,include_graph:visible}));
      if(!visible){
        renderHistoryGraph([],null);
        const conv=runtimeState.conversations[sessionId];
        if(conv)conv.graph=[];
      }
    };
    let stopped=false;
    const connected=()=>queueMicrotask(()=>{if(!stopped)send();});
    window.addEventListener("op:browser-connection",connected);
    send();
    return ()=>{
      stopped=true;window.removeEventListener("op:browser-connection",connected);
      const sock=getSocket();
      if(visible && sessionId && sock?.readyState===WebSocket.OPEN){
        sock.send(JSON.stringify({action:"list_branches",session_id:sessionId,graph_visible:false}));
        renderHistoryGraph([],null);
        const conv=runtimeState.conversations[sessionId];if(conv)conv.graph=[];
      }
    };
  },[visible,sessionId]);
  useEffect(() => {
    if (visible) enterExclusiveCoverageMode();
  }, [visible]);
  return (
    <div
      id="historyPanel"
      className="dag-view"
      style={{ display: visible ? "flex" : "none" }}
      aria-hidden={visible ? undefined : true}
    >
      {/* 分支切换直接在图内：每条 lane 尾部的分支名标签就是按钮
          （render/badges.ts），点非活动分支即 checkout。页面顶部不再
          放分支条——那条横线会横穿右上角的悬浮视角按钮。 */}
      <div className="history-body"></div>
      {visible && <DagCanvasTools />}
      {visible && <DagZoomColumn />}
    </div>
  );
}
