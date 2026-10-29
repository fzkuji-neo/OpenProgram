/**
 * The canvas's full screen (dag/rendering.md §13): the graph takes the
 * whole window by growing over the app's left sidebar, right sidebar and
 * the center tab strip. It is a mode of the app, not the browser's
 * Fullscreen API — the window keeps its size. The zoom column's button
 * flips it; Esc (keys.ts), leaving the graph view (dag-view.tsx) or a
 * reload ends it. The look is CSS keyed on ``html[data-canvas-fullscreen]``
 * (app/styles/dag/panels/tools.css): the center body goes fixed and
 * covers the sidebars and tab strip, which stay put. This file only pins
 * the start and end of its glide to the body's slot in the layout, so it
 * grows out of where it sits and shrinks back into it.
 */

// A little over the glide's 0.25s in tools.css.
const GLIDE_MS = 280;
const VARS = ["--fs-top", "--fs-left", "--fs-width", "--fs-height"];

let _on = false;
let _glideTimer: ReturnType<typeof setTimeout> | null = null;
const _subs = new Set<() => void>();

export function canvasFullscreen(): boolean {
  return _on;
}

/** Where the center body sits in the layout: its column, under the tab
 *  strip when the strip lives in the column (web; the desktop App's
 *  strip is window chrome above it). */
function slot(body: HTMLElement): DOMRect {
  const col = body.parentElement!.getBoundingClientRect();
  const strip = body.parentElement!.querySelector<HTMLElement>(":scope > [data-center-tab-strip]");
  const top = strip ? strip.getBoundingClientRect().bottom : col.top;
  return new DOMRect(col.left, top, col.width, col.bottom - top);
}

function pin(root: HTMLElement, r: DOMRect | null): void {
  if (!r) { VARS.forEach((v) => root.style.removeProperty(v)); return; }
  [r.top, r.left, r.width, r.height].forEach((n, i) => root.style.setProperty(VARS[i], `${n}px`));
}

export function setCanvasFullscreen(on: boolean): void {
  if (on === _on) return;
  _on = on;
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    const body = document.querySelector<HTMLElement>(".center-col .center-body");
    if (_glideTimer) { clearTimeout(_glideTimer); _glideTimer = null; }
    if (!body) {
      pin(root, null);
      root.toggleAttribute("data-canvas-fullscreen", on);
    } else if (on) {
      // Lift it out exactly where it is, then let it go to the window.
      pin(root, root.hasAttribute("data-canvas-fullscreen") ? body.getBoundingClientRect() : slot(body));
      root.setAttribute("data-canvas-fullscreen", "");
      void body.offsetWidth;
      pin(root, null);
    } else {
      // Glide into the slot, then drop back into the layout there.
      pin(root, body.getBoundingClientRect());
      void body.offsetWidth;
      pin(root, slot(body));
      _glideTimer = setTimeout(() => {
        _glideTimer = null;
        root.removeAttribute("data-canvas-fullscreen");
        pin(root, null);
      }, GLIDE_MS);
    }
  }
  _subs.forEach((fn) => fn());
}
export function subscribeCanvasFullscreen(fn: () => void): () => void {
  _subs.add(fn);
  return () => { _subs.delete(fn); };
}
