import { useCenterTabs } from "./center-tabs-store";
import type { CanvasSide, Rect } from "./canvas-layout";
import { dropWebTabResource, resourceDropTarget } from "./tab-resource-drop";
import { desktopBridge, buildTransferPayload } from "../desktop/desktop-bridge";
import { translateText } from "../i18n";
export type CanvasDrop = { targetId: string; paneId: string; side: CanvasSide; rect: Rect };
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
export function tabStripDropAt(x: number, y: number): Rect | null {
  const rect = document.querySelector('[role="tablist"]')?.getBoundingClientRect();
  return rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
    ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null;
}
export function showCanvasDrop(drop: CanvasDrop | null) {
  showDropPreview(drop?.rect ?? null);
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
  if (preview.dataset.dropTarget !== target) { preview.replaceChildren(); delete preview.dataset.compact; }
  preview.dataset.dropTarget = target;
  const inset = target === "resources" ? 0 : 4;
  Object.assign(preview.style, { left: `${rect.left + inset}px`, top: `${rect.top + inset}px`, width: `${Math.max(0, rect.width - inset * 2)}px`, height: `${Math.max(0, rect.height - inset * 2)}px` });
}
export function startPaneDrag(event: React.PointerEvent<HTMLElement>, tabId: string, label: HTMLElement | null) {
  if (event.button !== 0 || !label || (event.target as HTMLElement).closest("button")) return;
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
    window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("keydown", key); window.removeEventListener("pointercancel", cancel); window.removeEventListener("blur",cancel);
    original === null ? el.removeAttribute("style") : el.setAttribute("style", original);
    setCanvasDragging(false);
  }
  function cancel() { cleanup(); if (token) void bridge?.tabTransfer.cancel(token); }
  function key(e: KeyboardEvent) { if (e.key === "Escape") cancel(); }
  function move(e: PointerEvent) {
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
        zIndex: "2147483647", background: "var(--bg-tertiary)", opacity: "1",
        pointerEvents: "none", borderRadius: "8px", transition: "none",
        boxShadow: "0 2px 4px rgba(0,0,0,.14), 0 12px 28px rgba(0,0,0,.24)",
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
    else showCanvasDrop(canvasDropAt(e.clientX,e.clientY));
  }
  async function up(e: PointerEvent) {
    const resource = started ? resourceDropTarget({ kind:"tab",tabIds:[tabId] },e.clientX,e.clientY) : null;
    const resourceSessionId = resource?.dataset.resourceDropSession;
    const drop = started && !resource ? canvasDropAt(e.clientX,e.clientY) : null;
    const inStrip = tabStripDropAt(e.clientX, e.clientY);
    const outside = e.clientX < 0 || e.clientY < 0 || e.clientX > innerWidth || e.clientY > innerHeight;
    cleanup();
    if (started && outside && token) { await bridge?.tabTransfer.detach(token); return; }
    if (resourceSessionId) { await dropWebTabResource(tabId,resourceSessionId,token ?? undefined); return; }
    if (token && !await bridge?.tabTransfer.cancel(token)) return;
    if (drop) useCenterTabs.getState().dockCanvas(tabId,drop.targetId,drop.paneId,drop.side);
    else if (started && inStrip) useCenterTabs.getState().ungroupTab(tabId);
  }
  window.addEventListener("pointermove",move); window.addEventListener("pointerup",up,{ once:true }); window.addEventListener("keydown",key); window.addEventListener("pointercancel",cancel,{ once:true }); window.addEventListener("blur",cancel,{ once:true });
}
