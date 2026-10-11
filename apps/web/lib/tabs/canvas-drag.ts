import { useCenterTabs } from "./center-tabs-store";
import { canvasGeometry, canvasViewport, dockLayout, leaves, rowLayout, type CanvasCorner, type CanvasDockSide, type Rect } from "./canvas-layout";
import { findCenterTabGroup } from "./center-tab-groups";
import { rememberCanvas } from "./canvas-history";
import { dropWebTabResource, resourceDropTarget } from "./tab-resource-drop";
import { desktopBridge, buildTransferPayload } from "../desktop/desktop-bridge";
import { translateText } from "../i18n";
import { DRAG_SURFACE_STYLE } from "../prefs/visual-effects-config";
/** A drop on the canvas. "dock" places the tab; "fill" opens it on its own
 *  (the top edge, like dragging a window to the menu bar); "stay" is a pane
 *  over the place it already has, shown so the canvas never goes silent. */
export type CanvasDrop = { targetId: string; paneId: string; side: CanvasDockSide; rect: Rect; action: "dock" | "fill" | "stay"; label: string };
let preview: HTMLDivElement | null = null;
let dragging = false;
const listeners = new Set<() => void>();
export function canvasDragging() { return dragging; }
/** Native web panes subscribe so they can swap to a snapshot while a drag runs. */
export function onCanvasDragChange(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }

/** The drag that owns the canvas right now. Every drag (tab, pane, divider)
 *  registers how to cancel itself and, when it can, how to finish. */
export type CanvasDragOwner = { cancel: () => void; release?: (event: PointerEvent) => void };
let owner: CanvasDragOwner | null = null;
let guarded = false;
/** A release over the window-drag strip, a native web view or another app
 *  never reaches the page, which used to leave a drag half-finished: the
 *  grip hidden, the label floating, iframes deaf. These guards end it. */
function installGuards() {
  if (guarded || typeof window === "undefined") return;
  guarded = true;
  // The first move with no button down is the release we missed.
  window.addEventListener("pointermove", event => {
    if (!owner || event.buttons !== 0 || event.pointerType === "touch") return;
    const current = owner;
    if (current.release) current.release(event); else current.cancel();
  }, true);
  // A new press while a drag is still open means its release was lost.
  window.addEventListener("pointerdown", () => owner?.cancel(), true);
  document.addEventListener("visibilitychange", () => { if (document.hidden) owner?.cancel(); });
}
export function setCanvasDragging(value: boolean, by?: CanvasDragOwner) {
  if (value) {
    installGuards();
    if (owner && by && owner !== by) { const stale = owner; owner = null; stale.cancel(); }
    if (by) owner = by;
  } else owner = null;
  if (dragging === value) { if (!value) { preview?.remove(); preview = null; } return; }
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
/** Edge band of the whole canvas: halves on the sides, quarters in the corners.
 *  Wide enough to land on without aiming, since the lower part of a pane
 *  (below this pane) looks like the bottom half until the band is reached. */
export const canvasEdgeBand = (width: number, height: number) => Math.max(40, Math.min(96, Math.min(width, height) * 0.14));
/** Share of a pane's width on each side that splits it left or right. */
export const PANE_SIDE = 0.25;

/** Which drop the pointer is over. The highlight always contains the pointer:
 *  the canvas half or quarter at an edge, the half of the pane under it inside. */
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
  const paneEl = (id: string) => panes.find(p => p.dataset.canvasPane === id);
  const boxOf = (el: HTMLElement): Rect => { const b = el.getBoundingClientRect(); return { left: b.left, top: b.top, width: b.width, height: b.height }; };
  const sourcePane = sourceIds.length === 1 ? leaves(layout.root).find(p => p.content === sourceIds[0]) : undefined;
  const sourceEl = sourcePane ? paneEl(sourcePane.id) : undefined;
  // Like macOS, the highlight is always where the pointer is. A pane that
  // would land where it already sits says so instead of showing nothing.
  const stay = (rect: Rect): CanvasDrop => ({ targetId, paneId: sourcePane?.id ?? "root", side: "center", rect, action: "stay", label: translateText("Stays here", "留在原处") });
  const dock = (paneId: string, side: CanvasDockSide, label: [string, string], rect?: Rect): CanvasDrop | null => {
    const lands = placed(paneId, side);
    if (!lands) return sourceEl ? stay(rect ?? boxOf(sourceEl)) : null;
    return { targetId, paneId, side, rect: rect ?? lands, action: "dock", label: translateText(...label) };
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
  // The pointer may sit in the gap between two panes; take the nearest.
  const el = panes.find(p => { const b = p.getBoundingClientRect(); return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom; })
    ?? panes.reduce<HTMLElement | undefined>((best, p) => {
      const d = (e: HTMLElement) => { const b = e.getBoundingClientRect(); return Math.hypot(Math.max(b.left - x, 0, x - b.right), Math.max(b.top - y, 0, y - b.bottom)); };
      return !best || d(p) < d(best) ? p : best;
    }, undefined);
  if (!el) return null;
  const paneId = el.dataset.canvasPane!;
  const content = leaves(layout.root).find(p => p.id === paneId)?.content ?? null;
  const paneRect = boxOf(el);
  if (sourceIds.length === 1 && content === sourceIds[0]) return stay(paneRect);
  if (!content) return dock(paneId, "center", ["Put it here", "放到这里"], paneRect);
  // Left and right quarters split sideways; the middle column splits by its
  // half, so the whole lower middle means "below". No dead centre. The
  // highlight is that half of the pane as it stands, under the pointer;
  // the rest of the canvas reflows around it after the drop.
  const px = (x - paneRect.left) / paneRect.width, py = (y - paneRect.top) / paneRect.height;
  if (alt) return { targetId, paneId, side: "center", rect: paneRect, action: "dock", label: translateText("Replace this pane", "替换这一格") };
  const side = px < PANE_SIDE ? "left" : px > 1 - PANE_SIDE ? "right" : py < 0.5 ? "top" : "bottom";
  const { left, top, width, height } = paneRect;
  const half: Rect = side === "left" ? { left, top, width: width / 2, height }
    : side === "right" ? { left: left + width / 2, top, width: width / 2, height }
    : side === "top" ? { left, top, width, height: height / 2 }
    : { left, top: top + height / 2, width, height: height / 2 };
  return dock(paneId, side, PANE_LABEL[side], half);
}
/** Apply a canvas drop. Returns false when it changed nothing. */
export function commitCanvasDrop(drop: CanvasDrop, sourceIds: string[]): boolean {
  const s = useCenterTabs.getState(), sourceId = sourceIds[0];
  if (!sourceId || drop.action === "stay") return false;
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
/** Drag a pane by its grip. The pane, not the grip's inline style, carries
 *  the dragging state, and every way a drag can end (release, Escape,
 *  pointercancel, blur, a missed release, an error while resolving the
 *  drop) runs the same cleanup exactly once. */
export function startPaneDrag(event: React.PointerEvent<HTMLElement>, tabId: string, label: HTMLElement | null) {
  // The grip's window buttons drag like the rest of it; other buttons do not.
  if (event.button !== 0 || !label || (event.target as HTMLElement).closest("button:not([data-pane-light])")) return;
  // Keep the press from starting a text selection in the pane below.
  event.preventDefault();
  const grip = event.currentTarget;
  const pane = grip.closest<HTMLElement>("[data-canvas-pane]") ?? grip;
  // A drag that ended without cleanup must not leave another grip hidden.
  document.querySelectorAll("[data-pane-dragging]").forEach(node => node.removeAttribute("data-pane-dragging"));
  let dragLabel: HTMLElement | null = null;
  let resourceTarget: HTMLElement | null = null;
  function markResourceTarget(target: HTMLElement | null) {
    if (resourceTarget === target) return;
    resourceTarget?.removeAttribute("data-resource-drop-over");
    resourceTarget = target;
    target?.setAttribute("data-resource-drop-over", "true");
  }
  const start = { x: event.clientX, y: event.clientY };
  let started = false, finished = false;
  let last: { x: number; y: number } | null = null;
  const pointerId = event.pointerId;
  const bridge = desktopBridge();
  const payload = bridge && buildTransferPayload({ kind: "tab", tabIds: [tabId] }, bridge.windowId);
  const token = payload ? bridge?.tabTransfer.prepare(payload) : undefined;
  const sessionOwner: CanvasDragOwner = { cancel: () => cancel(), release: (e) => void finish(e) };
  function cleanup() {
    finished = true;
    markResourceTarget(null);
    dragLabel?.remove(); dragLabel = null;
    pane.removeAttribute("data-pane-dragging");
    try { if (grip.hasPointerCapture(pointerId)) grip.releasePointerCapture(pointerId); } catch { /* already released */ }
    window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", finish);
    window.removeEventListener("keydown", key); window.removeEventListener("keyup", key);
    window.removeEventListener("pointercancel", cancel); window.removeEventListener("blur", cancel);
    if (started) setCanvasDragging(false);
  }
  function cancel() {
    if (finished) return;
    cleanup();
    if (token) void bridge?.tabTransfer.cancel(token);
  }
  /** Where the drop lands. Never throws: a failed lookup means no drop. */
  function resolveDrop(x: number, y: number, alt: boolean) {
    try {
      const resource = resourceDropTarget({ kind: "tab", tabIds: [tabId] }, x, y);
      if (resource) return { resource, drop: null, strip: null };
      const strip = tabStripDropAt(x, y);
      return { resource: null, drop: strip ? null : canvasDropAt(x, y, [tabId], alt), strip };
    } catch (error) {
      console.error("[canvas] drop lookup failed", error);
      return { resource: null, drop: null, strip: null };
    }
  }
  function show(x: number, y: number, alt: boolean) {
    const target = resolveDrop(x, y, alt);
    markResourceTarget(target.resource);
    if (target.resource) showResourceDrop(target.resource);
    else if (target.strip) showDropPreview(target.strip, "tab-strip");
    else showCanvasDrop(target.drop);
  }
  function key(e: KeyboardEvent) {
    if (e.key === "Escape") cancel();
    // Option toggles "replace" without moving the pointer.
    else if (e.key === "Alt" && started && last) show(last.x, last.y, e.type === "keydown");
  }
  function move(e: PointerEvent) {
    if (e.pointerId !== pointerId) return;
    // The button came up somewhere the page could not see.
    if (e.buttons === 0 && e.pointerType !== "touch") { void finish(e); return; }
    last = { x: e.clientX, y: e.clientY };
    if (!started && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6) return;
    if (!started) {
      started = true;
      // Capture only once it is a drag, so a plain press still clicks the
      // window button under it.
      try { grip.setPointerCapture(pointerId); } catch { /* the window listeners still cover the drag */ }
      setCanvasDragging(true, sessionOwner);
      pane.setAttribute("data-pane-dragging", "");
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
    }
    if (dragLabel) Object.assign(dragLabel.style, { left: `${e.clientX - 110}px`, top: `${e.clientY - 16}px` });
    show(e.clientX, e.clientY, e.altKey);
  }
  async function finish(e: PointerEvent) {
    if (finished || e.pointerId !== pointerId) return;
    const target = started ? resolveDrop(e.clientX, e.clientY, e.altKey) : null;
    const wasStarted = started;
    cleanup();
    try {
      const outside = e.clientX < 0 || e.clientY < 0 || e.clientX > window.innerWidth || e.clientY > window.innerHeight;
      if (wasStarted && outside && token) { await bridge?.tabTransfer.detach(token); return; }
      const resourceSessionId = target?.resource?.dataset.resourceDropSession;
      if (resourceSessionId) { await dropWebTabResource(tabId, resourceSessionId, token ?? undefined); return; }
      if (token && !await bridge?.tabTransfer.cancel(token)) return;
      if (target?.drop) commitCanvasDrop(target.drop, [tabId]);
      else if (target?.strip) useCenterTabs.getState().ungroupTab(tabId);
    } catch (error) {
      console.error("[canvas] pane drop failed", error);
    }
  }
  window.addEventListener("pointermove", move); window.addEventListener("pointerup", finish);
  window.addEventListener("keydown", key); window.addEventListener("keyup", key);
  window.addEventListener("pointercancel", cancel); window.addEventListener("blur", cancel);
}
