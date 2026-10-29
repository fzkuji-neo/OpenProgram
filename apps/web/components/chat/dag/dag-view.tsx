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
 * each lane's tail name tag (render/labels/badges.ts) is the checkout button,
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

import { useEffect, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { SolarIcon } from "@/components/solar-icons";
import type { SolarIconName } from "@/components/solar-icons/bodies";

import { useTranslation } from "@/lib/i18n";
import { getSocket, runtimeState } from "@/lib/runtime-bridge/state";
import { useSessionStore } from "@/lib/session-store";
import { enterExclusiveCoverageMode, renderHistoryGraph } from "@/lib/runtime-bridge/dag";
import { focusAgent, resetZoom, zoomStep } from "@/lib/runtime-bridge/dag/interaction/view/canvas";
import { minimapOn, subscribeMinimap, toggleMinimap } from "@/lib/runtime-bridge/dag/interaction/view/minimap";
import {
  canvasFullscreen,
  setCanvasFullscreen,
  subscribeCanvasFullscreen,
} from "@/lib/runtime-bridge/dag/interaction/view/fullscreen";
import { MENU_PANEL } from "@/components/chat/top-bar/menu-styles";
import { DagCanvasTools } from "@/components/chat/dag/dag-tools";
import { PANEL_MOTION, useKeySheetOpen } from "@/components/chat/dag/dag-key-sheet";
import { keySheetOpen, setKeySheet } from "@/lib/runtime-bridge/dag/interaction/selection/key-sheet";

/** A tile swatch: the same `dag-tile t-<tone>` classes the canvas tiles
 *  carry (render/tiles.ts, app/styles/dag/graph/nodes.css), so the key and the
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

/** Key for shape and coverage. A switch in the zoom column, like the
 *  minimap's: it stays open until its button is pressed again — a
 *  click on the canvas or on the map button leaves it open. It shares
 *  its spot with the controls sheet, so opening either closes the
 *  other. Starts closed: the vocabulary is small and learnable. */
function DagLegend() {
  const { text } = useTranslation();
  const [open, setOpen] = useState(false);
  // The legend and the controls sheet open in the same spot, so they
  // take turns: either one opening closes the other.
  const sheetOpen = useKeySheetOpen();
  useEffect(() => { if (sheetOpen) setOpen(false); }, [sheetOpen]);
  return (
    <div className="dag-legend">
      <button
        type="button"
        className="dag-tool-btn"
        onClick={() => { if (!open) setKeySheet(false); setOpen(!open); }}
        aria-expanded={open}
        aria-pressed={open}
        aria-label={text("Legend", "图例")}
        data-tip={open ? undefined : text("Legend", "图例")}
        data-tip-side="left"
      >
        <SolarIcon name="widget-2" size={16} />
      </button>
      <AnimatePresence>
      {open && (
        // 内衬和滚动来自 MENU_PANEL；外框和小地图一致（dag/panels/tools.css），
        // .dag-legend-body 负责锚位（在右上竖列左边展开）和行的排版；
        // 出现和收起的动效同 PANEL_MOTION（app 弹层的那一套）。
        <motion.div key="legend" {...PANEL_MOTION} className={`dag-legend-body ${MENU_PANEL}`}>
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
        </motion.div>
      )}
      </AnimatePresence>
    </div>
  );
}

/** The zoom column in the canvas's top-right corner, right under the
 *  pane's perspective strip (dag/rendering.md §13): one raised strip
 *  holding zoom in, the readout (click: back to 100%), zoom out and,
 *  under a hairline, full screen and find the working agent;
 *  a second strip under it turns the legend and the minimap on and off
 *  and, under a hairline, opens the controls sheet (dag-key-sheet.tsx).
 *  All open to the column's left from the top, the map above the
 *  legend. Every glyph is Solar Bold Duotone with its hover pop, like
 *  the composer's buttons. The readout is written by
 *  `dag/interaction/view/canvas.ts` on every view change — it is the
 *  camera's number, and routing it through React state would repaint
 *  the tree on every wheel event of a gesture. */
function DagZoomColumn() {
  const { text } = useTranslation();
  const mapOn = useSyncExternalStore(subscribeMinimap, minimapOn, minimapOn);
  const sheetOpen = useKeySheetOpen();
  const full = useSyncExternalStore(subscribeCanvasFullscreen, canvasFullscreen, () => false);
  return (
    <div className="dag-zoom-column">
      <div className="dag-tool-rail" role="toolbar" aria-orientation="vertical"
        aria-label={text("Zoom", "缩放")}>
        <button type="button" className="dag-tool-btn" onClick={() => zoomStep(1)}
          aria-label={text("Zoom in", "放大")} aria-keyshortcuts="+"
          data-tip={text("Zoom in", "放大")} data-tip-keys="+" data-tip-side="left">
          <SolarIcon name="magnifer-zoom-in" size={16} />
        </button>
        <button type="button" className="dag-tool-btn dag-zoom-readout" onClick={() => resetZoom()}
          aria-keyshortcuts="Shift+0"
          data-tip={text("Back to 100%", "回到 100%")} data-tip-keys="⇧ 0" data-tip-side="left">
          100%
        </button>
        <button type="button" className="dag-tool-btn" onClick={() => zoomStep(-1)}
          aria-label={text("Zoom out", "缩小")} aria-keyshortcuts="-"
          data-tip={text("Zoom out", "缩小")} data-tip-keys="−" data-tip-side="left">
          <SolarIcon name="magnifer-zoom-out" size={16} />
        </button>
        <span className="dag-tool-sep" aria-hidden="true" />
        {/* Showing the whole graph is Shift+1 alone (keys.ts); this
            spot hides the sidebars and the tab strip instead. */}
        <button type="button" className="dag-tool-btn" onClick={() => setCanvasFullscreen(!full)}
          aria-pressed={full} aria-label={text("Full screen", "全屏")}
          data-tip={full ? text("Leave full screen", "退出全屏") : text("Full screen", "全屏")}
          data-tip-keys={full ? "Esc" : undefined} data-tip-side="left">
          <SolarIcon name={full ? "quit-full-screen-square" : "full-screen-square"} size={16} />
        </button>
        <button type="button" className="dag-tool-btn" onClick={() => focusAgent()}
          aria-label={text("Find the working agent", "找到正在工作的 agent")} aria-keyshortcuts="F"
          data-tip={text("Find the agent\nAgain for the next one", "找到 agent\n再按换下一个")}
          data-tip-keys="F" data-tip-side="left">
          <SolarIcon name="gps" size={16} />
        </button>
      </div>
      <div className="dag-tool-rail" role="toolbar" aria-orientation="vertical"
        aria-label={text("Minimap and guides", "小地图和指南")}>
        <button type="button" className="dag-tool-btn" onClick={() => toggleMinimap()}
          aria-pressed={mapOn} aria-label={text("Minimap", "小地图")} aria-keyshortcuts="M"
          data-tip={mapOn ? text("Hide the minimap", "隐藏小地图") : text("Show the minimap", "显示小地图")}
          data-tip-keys="M"
          data-tip-side="left">
          <SolarIcon name="map" size={16} />
        </button>
        <span className="dag-tool-sep" aria-hidden="true" />
        {/* The two guides — what the marks mean, what the canvas answers
            to — share a group, and only one of them is open at a time. */}
        <DagLegend />
        <button type="button" className="dag-tool-btn" data-key-sheet-toggle=""
          onClick={() => setKeySheet(!keySheetOpen())}
          aria-pressed={sheetOpen} aria-label={text("Controls", "操作说明")} aria-keyshortcuts="?"
          data-tip={sheetOpen ? undefined : text("Controls", "操作说明")} data-tip-keys="?"
          data-tip-side="left">
          <SolarIcon name="notes" size={16} />
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
    // Full screen belongs to the graph: leaving the view ends it.
    else setCanvasFullscreen(false);
  }, [visible]);
  useEffect(() => () => setCanvasFullscreen(false), []);
  return (
    <div
      id="historyPanel"
      className="dag-view"
      style={{ display: visible ? "flex" : "none" }}
      aria-hidden={visible ? undefined : true}
    >
      {/* 分支切换直接在图内：每条 lane 尾部的分支名标签就是按钮
          （render/labels/badges.ts），点非活动分支即 checkout。页面顶部不再
          放分支条——那条横线会横穿右上角的悬浮视角按钮。 */}
      <div className="history-body"></div>
      {visible && <DagCanvasTools />}
      {visible && <DagZoomColumn />}
    </div>
  );
}
