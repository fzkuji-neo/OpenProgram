import { useCenterTabs } from "./center-tabs-store";
import { canvasGeometry, canvasViewport, dockLayout, leaves, rowLayout, type CanvasCorner, type CanvasDockSide, type Rect } from "./canvas-layout";
import { findCenterTabGroup } from "./center-tab-groups";
import { rememberCanvas } from "./canvas-history";
import { dropWebTabResource, resourceDropTarget } from "./tab-resource-drop";
import { desktopBridge, buildTransferPayload } from "../desktop/desktop-bridge";
import { translateText } from "../i18n";
import { DRAG_SURFACE_STYLE } from "../prefs/visual-effects-config";
/** A drop on the canvas. "dock" places the tab; "fill" opens it on its own
 *  (the top edge, like dragging a window to the menu bar). */
export type CanvasDrop = { targetId: string; paneId: string; side: CanvasDockSide; rect: Rect; action: "dock" | "fill"; label: string };
let preview: HTMLDivElement | null = null;
let dragging = false;
const listeners = new Set<() => void>();
export function canvasDragging() { return dragging; }
/** Native web panes subscribe so they can swap to a snapshot while a drag runs. */
export function onCanvasDragChange(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function setCanvasDragging(value: boolean) {
  dragging = value;
  document.documentElement.toggleAttribute("data-canvas-dragging", value);
  listeners.forEach((listener) => listener());
  if (!value) { preview?.remove(); preview = null; }
}
const SIDE_LABEL: Record<Exclude<CanvasDockSide, "center">, [string, string]> = {
  left: ["Left half", "左半边"], right: ["Right half", "右半边"], top: ["Top half", "上半边"], bottom: ["Bottom half", "下半边"],
  "top-left": ["Top-left quarter", "左上四分之一"], "top-right": ["Top-right quarter", "右上四分之一"],
  "bottom-left": ["Bottom-left quarter", "左下四分之一"], "bottom-right": ["Bottom-right quarter", "右下四分之一"],
};
const PANE_LABEL: Record<"left" | "right" | "top" | "bottom", [string, string]> = {
  left: ["Split: left of this pane", "拆分：放这一格左边"], right: ["Split: right of this pane", "拆分：放这一格右边"],
  top: ["Split: above this pane", "拆分：放这一格上面"], bottom: ["Split: below this pane", "拆分：放这一格下面"],
};
/** Edge band of the whole canvas: halves on the sides, quarters in the corners. */
export const canvasEdgeBand = (width: number, height: number) => Math.max(28, Math.min(56, Math.min(width, height) * 0.08));
/** Share of a pane's width on each side that splits it left or right. */
export const PANE_SIDE = 0.25;

/** Which drop the pointer is over, with the exact rect the tab would take. */
export function canvasDropAt(x: number, y: number, sourceIds: string[], alt = false): CanvasDrop | null {
  const root = document.querySelector<HTMLElement>("[data-canvas-root]");
  if (!root || !sourceIds.length) return null;
  const r = root.getBoundingClientRect();
  if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
  const panes = [...root.querySelectorAll<HTMLElement>("[data-canvas-pane]")].filter(p => p.offsetWidth);
  const targetId = panes[0]?.dataset.canvasTarget;
  if (!targetId) return null;
  const state = useCenterTabs.getState();
  const layout = findCenterTabGroup(state.groups, targetId)?.canvas ?? rowLayout([targetId]);
  const sourceGroup = findCenterTabGroup(state.groups, sourceIds[0]);
  const viewport = canvasViewport(r.width, r.height);
  const shift = (b: Rect): Rect => ({ left: b.left + r.left, top: b.top + r.top, width: b.width, height: b.height });
  const placed = (paneId: string, side: CanvasDockSide): Rect | null => {
    const next = dockLayout(layout, sourceIds, paneId, side, sourceGroup?.canvas);
    if (!next) return null;
    const geometry = canvasGeometry(next.root, viewport);
    const rects = leaves(next.root).filter(p => p.content && sourceIds.includes(p.content)).map(p => geometry.panes.get(p.id)!);
    if (!rects.length) return null;
    const left = Math.min(...rects.map(b => b.left)), top = Math.min(...rects.map(b => b.top));
    return shift({ left, top, width: Math.max(...rects.map(b => b.left + b.width)) - left, height: Math.max(...rects.map(b => b.top + b.height)) - top });
  };
  const dock = (paneId: string, side: CanvasDockSide, label: [string, string]): CanvasDrop | null => {
    const rect = placed(paneId, side);
    return rect ? { targetId, paneId, side, rect, action: "dock", label: translateText(...label) } : null;
  };
  const band = canvasEdgeBand(r.width, r.height);
  const nearL = x - r.left <= band, nearR = r.right - x <= band, nearT = y - r.top <= band, nearB = r.bottom - y <= band;
  if ((nearL || nearR) && (nearT || nearB)) {
    const corner = `${nearT ? "top" : "bottom"}-${nearL ? "left" : "right"}` as CanvasCorner;
    return dock("root", corner, SIDE_LABEL[corner]);
  }
  if (nearT) {
    const grouped = sourceIds.length === 1 && !!sourceGroup;
    return { targetId, paneId: "root", side: "center", rect: shift(viewport), action: "fill",
      label: grouped ? translateText("Take out of split", "移出分屏，单独打开") : translateText("Open on its own", "单独打开") };
  }
  if (nearL || nearR || nearB) {
    const side = nearL ? "left" : nearR ? "right" : "bottom";
    return dock("root", side, SIDE_LABEL[side]);
  }
  const el = panes.find(p => { const b = p.getBoundingClientRect(); return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom; });
  if (!el) return null;
  const paneId = el.dataset.canvasPane!;
  const content = leaves(layout.root).find(p => p.id === paneId)?.content ?? null;
  if (sourceIds.length === 1 && content === sourceIds[0]) return null;
  const b = el.getBoundingClientRect();
  if (!content) {
    const rect = placed(paneId, "center");
    return rect ? { targetId, paneId, side: "center", rect, action: "dock", label: translateText("Put it here", "放到这里") } : null;
  }
  // Left and right quarters split sideways; the middle column splits by its
  // half, so the whole lower middle means "below". No dead centre.
  const px = (x - b.left) / b.width, py = (y - b.top) / b.height;
  const paneRect = { left: b.left, top: b.top, width: b.width, height: b.height };
  if (alt) return { targetId, paneId, side: "center", rect: paneRect, action: "dock", label: translateText("Replace this pane", "替换这一格") };
  const side = px < PANE_SIDE ? "left" : px > 1 - PANE_SIDE ? "right" : py < 0.5 ? "top" : "bottom";
  return dock(paneId, side, PANE_LABEL[side]);
}
/** Apply a canvas drop. Returns false when it changed nothing. */
export function commitCanvasDrop(drop: CanvasDrop, sourceIds: string[]): boolean {
  const s = useCenterTabs.getState(), sourceId = sourceIds[0];
  if (!sourceId) return false;
  const group = findCenterTabGroup(s.groups, drop.targetId);
  const layout = group?.canvas ?? rowLayout([drop.targetId]);
  rememberCanvas([drop.targetId, ...sourceIds, ...(group ? [group.id, ...group.memberIds] : [])], layout);
  if (drop.action === "fill") {
    if (sourceIds.length === 1 && findCenterTabGroup(s.groups, sourceId)) s.ungroupTab(sourceId);
    useCenterTabs.getState().setActive(sourceId);
    return true;
  }
  s.dockCanvas(sourceIds, drop.targetId, drop.paneId, drop.side);
  return true;
}
export function tabStripDropAt(x: number, y: number): Rect | null {
  const rect = document.querySelector('[role="tablist"]')?.getBoundingClientRect();
  return rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
    ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null;
}
export function showCanvasDrop(drop: CanvasDrop | null) {
  showDropPreview(drop?.rect ?? null);
  if (!preview || !drop) return;
  preview.dataset.dropAction = drop.action;
  preview.dataset.compact = String(drop.rect.width < 180 || drop.rect.height < 90);
  let label = preview.querySelector<HTMLElement>(".canvas-drop-label");
  if (!label) { label = document.createElement("span"); label.className = "canvas-drop-label"; preview.replaceChildren(label); }
  label.textContent = drop.label;
}
export function showResourceDrop(target: HTMLElement) {
  // An inactive Resources view accepts drops only on its navigation row.
  // An expanded view highlights its panel separately, below that row.
  const sidebar = target.closest(".right-sidebar");
  const row = sidebar?.querySelector<HTMLElement>('.right-nav-item[data-view="resources"]');
  const highlight = row && row.dataset.resourceDropSession === target.dataset.resourceDropSession ? row : target;
  let rect: Rect = highlight.getBoundingClientRect();
  const panel = sidebar?.querySelector<HTMLElement>('#sessionResourcesPanel[data-resource-drop-session]');
  if (row && row.getAttribute("aria-expanded") === "true" && panel
      && panel.dataset.resourceDropSession === target.dataset.resourceDropSession) {
    const bounds = panel.getBoundingClientRect();
    const top = Math.max(bounds.top, row.getBoundingClientRect().bottom + 4);
    if (bounds.width > 0 && bounds.bottom > top) {
      rect = { left: bounds.left, top, width: bounds.width, height: bounds.bottom - top };
    }
  }
  if (rect.width <= 0 || rect.height <= 0) { showDropPreview(null); return; }
  showDropPreview({ left: rect.left, top: rect.top, width: rect.width, height: rect.height }, "resources");
  if (preview) {
    preview.dataset.compact = String(rect.height < 80);
    const label = document.createElement("span");
    label.className = "canvas-drop-label";
    label.textContent = translateText("Release to add to Resources", "松开以添加到资源");
    preview.replaceChildren(label);
  }
}
function showDropPreview(rect: Rect | null, target = "canvas") {
  if (!rect) { preview?.remove(); preview = null; return; }
  // Styled by .canvas-drop-preview (app/styles/base.css): soft system
  // blue with a slight spring as it moves between drop zones.
  if (!preview) { preview = document.createElement("div"); preview.className = "canvas-drop-preview"; document.body.append(preview); }
  if (preview.dataset.dropTarget !== target) { preview.replaceChildren(); delete preview.dataset.compact; delete preview.dataset.dropAction; }
  preview.dataset.dropTarget = target;
  const inset = target === "resources" ? 0 : 4;
  Object.assign(preview.style, { left: `${rect.left + inset}px`, top: `${rect.top + inset}px`, width: `${Math.max(0, rect.width - inset * 2)}px`, height: `${Math.max(0, rect.height - inset * 2)}px` });
}
export function startPaneDrag(event: React.PointerEvent<HTMLElement>, tabId: string, label: HTMLElement | null) {
  if (event.button !== 0 || !label || (event.target as HTMLElement).closest("button")) return;
  // Keep the press from starting a text selection in the pane below.
  event.preventDefault();
  const el = event.currentTarget, original = el.getAttribute("style");
  let dragLabel: HTMLElement | null = null;
  let resourceTarget: HTMLElement | null = null;
  function markResourceTarget(target: HTMLElement | null) {
    if (resourceTarget === target) return;
    resourceTarget?.removeAttribute("data-resource-drop-over");
    resourceTarget = target;
    target?.setAttribute("data-resource-drop-over", "true");
  }
  const start = { x: event.clientX, y: event.clientY }; let started = false;
  const pointerId = event.pointerId;
  el.setPointerCapture(pointerId);
  const bridge = desktopBridge();
  const payload = bridge && buildTransferPayload({ kind: "tab", tabIds: [tabId] }, bridge.windowId);
  const token = payload ? bridge?.tabTransfer.prepare(payload) : undefined;
  function cleanup() {
    markResourceTarget(null);
    dragLabel?.remove(); dragLabel = null;
    if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
    window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("keydown", key); window.removeEventListener("keyup", key); window.removeEventListener("pointercancel", cancel); window.removeEventListener("blur",cancel);
    original === null ? el.removeAttribute("style") : el.setAttribute("style", original);
    setCanvasDragging(false);
  }
  function cancel() { cleanup(); if (token) void bridge?.tabTransfer.cancel(token); }
  let last: { x: number; y: number } | null = null;
  function key(e: KeyboardEvent) {
    if (e.key === "Escape") cancel();
    // Option toggles "replace" in the middle of a pane without moving.
    else if (e.key === "Alt" && started && last && !resourceTarget && !tabStripDropAt(last.x, last.y)) showCanvasDrop(canvasDropAt(last.x, last.y, [tabId], e.type === "keydown"));
  }
  function move(e: PointerEvent) {
    last = { x: e.clientX, y: e.clientY };
    if (!started && Math.hypot(e.clientX-start.x,e.clientY-start.y) < 6) return;
    if (!started) {
      started = true;
      setCanvasDragging(true);
      dragLabel = label!.cloneNode(true) as HTMLElement;
      dragLabel.removeAttribute("hidden");
      dragLabel.removeAttribute("data-pane-drag-label");
      dragLabel.setAttribute("data-pane-drag-preview", "true");
      dragLabel.setAttribute("aria-hidden", "true");
      dragLabel.inert = true;
      Object.assign(dragLabel.style, {
        display: "flex", position: "fixed", width: "220px", height: "32px",
        minWidth: "0", maxWidth: "calc(100vw - 16px)", margin: "0", padding: "0 8px",
        zIndex: "2147483647", opacity: "1",
        ...DRAG_SURFACE_STYLE,
        pointerEvents: "none", borderRadius: "8px", transition: "none",
      });
      document.body.append(dragLabel);
      el.style.visibility = "hidden";
    }
    if (dragLabel) Object.assign(dragLabel.style, { left: `${e.clientX - 110}px`, top: `${e.clientY - 16}px` });
    const resource = resourceDropTarget({ kind: "tab", tabIds: [tabId] }, e.clientX, e.clientY);
    markResourceTarget(resource);
    if (resource) { showResourceDrop(resource); return; }
    const strip = tabStripDropAt(e.clientX, e.clientY);
    if (strip) showDropPreview(strip, "tab-strip");
    else showCanvasDrop(canvasDropAt(e.clientX, e.clientY, [tabId], e.altKey));
  }
  async function up(e: PointerEvent) {
    const resource = started ? resourceDropTarget({ kind:"tab",tabIds:[tabId] },e.clientX,e.clientY) : null;
    const resourceSessionId = resource?.dataset.resourceDropSession;
    const drop = started && !resource ? canvasDropAt(e.clientX, e.clientY, [tabId], e.altKey) : null;
    const inStrip = tabStripDropAt(e.clientX, e.clientY);
    const outside = e.clientX < 0 || e.clientY < 0 || e.clientX > innerWidth || e.clientY > innerHeight;
    cleanup();
    if (started && outside && token) { await bridge?.tabTransfer.detach(token); return; }
    if (resourceSessionId) { await dropWebTabResource(tabId,resourceSessionId,token ?? undefined); return; }
    if (token && !await bridge?.tabTransfer.cancel(token)) return;
    if (drop) commitCanvasDrop(drop, [tabId]);
    else if (started && inStrip) useCenterTabs.getState().ungroupTab(tabId);
  }
  window.addEventListener("pointermove",move); window.addEventListener("pointerup",up,{ once:true }); window.addEventListener("keydown",key); window.addEventListener("keyup",key); window.addEventListener("pointercancel",cancel,{ once:true }); window.addEventListener("blur",cancel,{ once:true });
}
