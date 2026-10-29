/**
 * The canvas's full screen (dag/rendering.md §13): the graph takes the
 * whole window by hiding the app's left sidebar, right sidebar and the
 * center tab strip. It is a mode of the app, not the browser's
 * Fullscreen API — the window keeps its size. The zoom column's button
 * flips it; Esc (keys.ts), leaving the graph view (dag-view.tsx) or a
 * reload ends it. The hiding is CSS keyed on
 * ``html[data-canvas-fullscreen]`` (app/styles/dag/panels/tools.css).
 */

let _on = false;
const _subs = new Set<() => void>();

export function canvasFullscreen(): boolean {
  return _on;
}

export function setCanvasFullscreen(on: boolean): void {
  if (on === _on) return;
  _on = on;
  if (typeof document !== "undefined") {
    document.documentElement.toggleAttribute("data-canvas-fullscreen", on);
  }
  _subs.forEach((fn) => fn());
}

export function subscribeCanvasFullscreen(fn: () => void): () => void {
  _subs.add(fn);
  return () => { _subs.delete(fn); };
}
