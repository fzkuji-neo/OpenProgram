import { useCenterTabs } from "./center-tabs-store";
import type { CanvasSide, Rect } from "./canvas-layout";
import { attachWebTabResource, resourceDropTarget } from "./tab-resource-drop";
import { desktopBridge, buildTransferPayload } from "../desktop/desktop-bridge";
export type CanvasDrop = { targetId: string; paneId: string; side: CanvasSide; rect: Rect };
let preview: HTMLDivElement | null = null;
let dragging = false;
export function canvasDragging() { return dragging; }
export function setCanvasDragging(value: boolean) {
  dragging = value;
  document.documentElement.toggleAttribute("data-canvas-dragging", value);
  window.dispatchEvent(new Event("canvas-drag-change"));
  if (!value) { preview?.remove(); preview = null; }
}
export function canvasDropAt(x: number, y: number): CanvasDrop | null {
  const root = document.querySelector<HTMLElement>("[data-canvas-root]");
  if (!root) return null;
  const r = root.getBoundingClientRect();
  if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
  let el = [...root.querySelectorAll<HTMLElement>("[data-canvas-pane]")].find(p => {
    const b = p.getBoundingClientRect(); return p.offsetWidth && x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
  });
  const edges = [x-r.left, r.right-x, y-r.top, r.bottom-y];
  const sides: CanvasSide[] = ["left", "right", "top", "bottom"];
  const outer = Math.min(...edges) <= 6;
  if (!el && !outer) return null;
  el ??= root.querySelector<HTMLElement>("[data-canvas-pane]") ?? undefined;
  if (!el) return null;
  const b = outer ? r : el.getBoundingClientRect();
  const px = (x-b.left)/b.width, py = (y-b.top)/b.height;
  const distances = [px, 1-px, py, 1-py];
  const side = outer ? sides[edges.indexOf(Math.min(...edges))] : px >= .3 && px <= .7 && py >= .3 && py <= .7 ? "center" : sides[distances.indexOf(Math.min(...distances))];
  const rect = { left: b.left, top: b.top, width: b.width, height: b.height };
  if (side === "left" || side === "right") { rect.width /= 2; if (side === "right") rect.left += rect.width; }
  if (side === "top" || side === "bottom") { rect.height /= 2; if (side === "bottom") rect.top += rect.height; }
  return { targetId: el.dataset.canvasTarget!, paneId: outer ? "root" : el.dataset.canvasPane!, side, rect };
}
export function showCanvasDrop(drop: CanvasDrop | null) {
  if (!drop) { preview?.remove(); preview = null; return; }
  if (!preview) { preview = document.createElement("div"); document.body.append(preview); }
  Object.assign(preview.style, { position: "fixed", pointerEvents: "none", zIndex: "99999", background: "rgba(110,168,254,.18)", border: "2px solid #6ea8fe", borderRadius: "7px", boxSizing: "border-box", ...Object.fromEntries(Object.entries(drop.rect).map(([k,v]) => [k, `${v}px`])) });
}
export function startPaneDrag(event: React.PointerEvent<HTMLElement>, tabId: string) {
  if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
  const el = event.currentTarget, original = el.getAttribute("style"), rect = el.getBoundingClientRect();
  const start = { x: event.clientX, y: event.clientY }; let started = false;
  const pointerId = event.pointerId;
  el.setPointerCapture(pointerId);
  const bridge = desktopBridge();
  const payload = bridge && buildTransferPayload({ kind: "tab", tabIds: [tabId] }, bridge.windowId);
  const token = payload ? bridge?.tabTransfer.prepare(payload) : undefined;
  function cleanup() {
    if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
    window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("keydown", key); window.removeEventListener("pointercancel", cancel); window.removeEventListener("blur",cancel);
    original === null ? el.removeAttribute("style") : el.setAttribute("style", original);
    setCanvasDragging(false);
  }
  function cancel() { cleanup(); if (token) void bridge?.tabTransfer.cancel(token); }
  function key(e: KeyboardEvent) { if (e.key === "Escape") cancel(); }
  function move(e: PointerEvent) {
    if (!started && Math.hypot(e.clientX-start.x,e.clientY-start.y) < 6) return;
    if (!started) { started = true; setCanvasDragging(true); }
    Object.assign(el.style, { position: "fixed", left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, zIndex: "100000", background: "var(--bg-tertiary)", opacity: "1", pointerEvents: "none", transform: `translate(${e.clientX-start.x}px,${e.clientY-start.y}px)` });
    showCanvasDrop(canvasDropAt(e.clientX,e.clientY));
  }
  async function up(e: PointerEvent) {
    const resource = started ? resourceDropTarget({ kind:"tab",tabIds:[tabId] },e.clientX,e.clientY) : null;
    const drop = started && !resource ? canvasDropAt(e.clientX,e.clientY) : null;
    const strip = document.querySelector('[role="tablist"]')?.getBoundingClientRect();
    const inStrip = strip && e.clientY >= strip.top && e.clientY <= strip.bottom;
    const outside = e.clientX < 0 || e.clientY < 0 || e.clientX > innerWidth || e.clientY > innerHeight;
    cleanup();
    if (started && outside && token) { await bridge?.tabTransfer.detach(token); return; }
    if (token && !await bridge?.tabTransfer.cancel(token)) return;
    if (resource) { await attachWebTabResource(tabId,resource.dataset.resourceDropSession!); return; }
    if (drop) useCenterTabs.getState().dockCanvas(tabId,drop.targetId,drop.paneId,drop.side);
    else if (started && inStrip) useCenterTabs.getState().ungroupTab(tabId);
  }
  window.addEventListener("pointermove",move); window.addEventListener("pointerup",up,{ once:true }); window.addEventListener("keydown",key); window.addEventListener("pointercancel",cancel,{ once:true }); window.addEventListener("blur",cancel,{ once:true });
}
