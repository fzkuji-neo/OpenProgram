import { create } from "zustand";
import { translateText } from "../i18n";
import type { CanvasDrop } from "./canvas-drag";
import type { Rect } from "./canvas-layout";

/** Window overview, like Mission Control: every window in the strip (a
 *  single tab or a split group) shrinks to a card that keeps its split.
 *  "drag" opens while a tab or a pane is being dragged, and the drop picks
 *  a card's side to merge with or the space between cards to open alone.
 *  "browse" opens from the strip button or a pinch, and a click switches. */
export type OverviewSide = "left" | "right" | "top" | "bottom";
export type OverviewHover = { card: string; side: OverviewSide } | { card: null; side: null } | null;
/** `landing`: the tab a drop merged into a window; the overview zooms that
 *  window's card back over the canvas before it closes. */
type OverviewState = { mode: "drag" | "browse" | null; sourceIds: string[]; hover: OverviewHover; label: string; landing: string | null };

export const useCanvasOverview = create<OverviewState>(() => ({ mode: null, sourceIds: [], hover: null, label: "", landing: null }));

/** Where the card a drop merged into sat, held from the release until the
 *  merge commits; null when no drop is landing. */
let landingFrom: Rect | null = null;
export const overviewLandingFrom = () => landingFrom;

export function openOverview(mode: "drag" | "browse", sourceIds: string[] = []) {
  const s = useCanvasOverview.getState();
  if (s.mode === mode && s.sourceIds.join("\n") === sourceIds.join("\n")) return;
  useCanvasOverview.setState({ mode, sourceIds, hover: null, label: "" });
}
export function closeOverview() {
  landingFrom = null;
  if (useCanvasOverview.getState().mode) useCanvasOverview.setState({ mode: null, sourceIds: [], hover: null, label: "", landing: null });
}
/** A drop onto a card: keep the drag overview up past the end of the drag
 *  (the merge may wait on the desktop shell), so the merged window can zoom
 *  out of the card it was dropped on. */
export function holdOverviewLanding(drop: CanvasDrop): void {
  if (useCanvasOverview.getState().mode !== "drag" || drop.action !== "dock") return;
  const card = document.querySelector<HTMLElement>(`[data-overview-target="${CSS.escape(drop.targetId)}"] [data-overview-mini]`);
  const b = card?.getBoundingClientRect();
  landingFrom = b ? { left: b.left, top: b.top, width: b.width, height: b.height } : null;
}
export const overviewHeld = () => landingFrom !== null;
/** The merge committed: zoom the window holding `tabId` out of its card. */
export function landOverview(tabId: string): void {
  if (!landingFrom) { closeOverview(); return; }
  useCanvasOverview.setState({ sourceIds: [], hover: null, label: "", landing: tabId });
}
export const overviewOpen = () => useCanvasOverview.getState().mode !== null;
/** The open overview zooms its window back before it closes; without one
 *  (or in a drag) this is a plain close. */
let zoomOut: (() => void) | null = null;
export function setOverviewZoomOut(handler: (() => void) | null) { zoomOut = handler; }
export function dismissOverview() { if (zoomOut) zoomOut(); else closeOverview(); }

/** Left and right quarters of a card put the tab beside the window; the
 *  middle puts it above or below by the half under the pointer. */
export const OVERVIEW_SIDE = 0.25;
const SIDE_LABEL: Record<OverviewSide, [string, string]> = {
  left: ["on its left", "放到它左边"], right: ["on its right", "放到它右边"],
  top: ["above it", "放到它上面"], bottom: ["below it", "放到它下面"],
};

function setHover(hover: OverviewHover, label: string) {
  const s = useCanvasOverview.getState();
  const same = s.hover?.card === hover?.card && s.hover?.side === hover?.side;
  if (!same || s.label !== label) useCanvasOverview.setState({ hover, label });
}

/** The drop under the pointer while the drag overview is open, or null
 *  outside it (the strip, the sidebars, beyond the window). */
export function overviewDropAt(x: number, y: number): CanvasDrop | null {
  const { mode, sourceIds } = useCanvasOverview.getState();
  const root = mode === "drag" ? document.querySelector<HTMLElement>("[data-canvas-overview]") : null;
  if (!root || !sourceIds.length) return null;
  const r = root.getBoundingClientRect();
  if (x < r.left || x > r.right || y < r.top || y > r.bottom) { setHover(null, ""); return null; }
  for (const card of root.querySelectorAll<HTMLElement>("[data-overview-card]")) {
    const mini = card.querySelector<HTMLElement>("[data-overview-mini]");
    const b = mini?.getBoundingClientRect();
    if (!b || x < b.left || x > b.right || y < b.top || y > b.bottom) continue;
    const px = (x - b.left) / b.width, py = (y - b.top) / b.height;
    const side: OverviewSide = px < OVERVIEW_SIDE ? "left" : px > 1 - OVERVIEW_SIDE ? "right" : py < 0.5 ? "top" : "bottom";
    const rect: Rect = side === "left" ? { left: b.left, top: b.top, width: b.width / 2, height: b.height }
      : side === "right" ? { left: b.left + b.width / 2, top: b.top, width: b.width / 2, height: b.height }
      : side === "top" ? { left: b.left, top: b.top, width: b.width, height: b.height / 2 }
      : { left: b.left, top: b.top + b.height / 2, width: b.width, height: b.height / 2 };
    const title = card.dataset.overviewTitle ?? "";
    const label = translateText(`Merge with “${title}”, ${SIDE_LABEL[side][0]}`, `和「${title}」合并，${SIDE_LABEL[side][1]}`);
    setHover({ card: card.dataset.overviewCard!, side }, label);
    return { targetId: card.dataset.overviewTarget!, paneId: "root", side, rect, action: "dock", label };
  }
  const label = translateText("Open on its own", "单独打开");
  setHover({ card: null, side: null }, label);
  return { targetId: sourceIds[0], paneId: "root", side: "center", rect: { left: r.left, top: r.top, width: r.width, height: r.height }, action: "fill", label };
}
