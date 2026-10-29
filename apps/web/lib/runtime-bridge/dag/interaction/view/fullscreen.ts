/**
 * The canvas's full screen (dag/rendering.md §13): the graph takes the
 * whole window by hiding the app's left sidebar, right sidebar and the
 * center tab strip. It is a mode of the app, not the browser's
 * Fullscreen API — the window keeps its size. The zoom column's button
 * flips it; Esc (keys.ts), leaving the graph view (dag-view.tsx) or a
 * reload ends it. The hiding is CSS keyed on
 * ``html[data-canvas-fullscreen]`` (app/styles/dag/panels/tools.css);
 * each flip also holds ``data-canvas-fullscreen-moving`` for the fold's
 * length, which is when that CSS turns its transition on.
 */

// A little over the fold's 0.2s in tools.css.
const FOLD_MS = 260;

let _on = false;
let _foldTimer: ReturnType<typeof setTimeout> | null = null;
const _subs = new Set<() => void>();

export function canvasFullscreen(): boolean {
  return _on;
}

export function setCanvasFullscreen(on: boolean): void {
  if (on === _on) return;
  _on = on;
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    if (_foldTimer) clearTimeout(_foldTimer);
    root.setAttribute("data-canvas-fullscreen-moving", "");
    root.toggleAttribute("data-canvas-fullscreen", on);
    _foldTimer = setTimeout(() => {
      _foldTimer = null;
      root.removeAttribute("data-canvas-fullscreen-moving");
    }, FOLD_MS);
  }
  _subs.forEach((fn) => fn());
}

export function subscribeCanvasFullscreen(fn: () => void): () => void {
  _subs.add(fn);
  return () => { _subs.delete(fn); };
}
