/**
 * The infinite canvas the DAG is drawn on.
 *
 * The graph used to live in a scroll box sized to its content. That box
 * decided two things it had no business deciding: how big the graph was
 * allowed to be before it needed scrollbars, and where "the middle" was.
 * A wide session got a horizontal scrollbar, a deep one got a vertical
 * one, and reading the whole shape meant scrolling in two axes with no
 * way to zoom out.
 *
 * So there is no box. The SVG fills the pane, everything is drawn inside
 * one ``<g>``, and that group carries a translate + scale the user drives
 * directly:
 *
 *   * mouse wheel or trackpad pinch → zoom about the cursor, 25%–300%
 *     (what is under the cursor stays under it)
 *   * two fingers on a trackpad → pan (``./wheel.ts`` tells them apart)
 *   * right (or middle) drag → pan, from anywhere on the graph
 *   * left drag on empty space → a box that selects (``./selection.ts``;
 *     a left press on a node is a click on it)
 *
 * The pane's background paints a dot lattice at the layout's own grid
 * pitch, transformed with the same numbers, so the dots ARE the
 * coordinate system: a node visibly sits on one, and drifting off it is
 * a bug anyone can see without reading the layout code.
 *
 * View state lives in ``store/globals`` per session, so re-rendering the
 * graph — which happens on every capture — leaves the user where they
 * were looking. Only a session switch re-fits.
 */

import { animate, type AnimationPlaybackControls } from "framer-motion";
import { COL_W, PAD_X, PAD_Y } from "../types";
import { TILE_R } from "../render/tiles";
import { closeNodeLayers } from "../render/inspector";
import { hideTooltip } from "./tooltip";
import { wheelKind } from "./wheel";
import { hideMinimap, paintMinimap } from "./minimap";
import { paintFarLabels } from "./far-labels";
import { SelectionBand, clearSelection, releaseEditableFocus, select } from "./selection";
import {
  _viewSession,
  _viewScale,
  _viewTx,
  _viewTy,
  setView,
  setViewSession,
} from "../store/globals";

/** The inspector popover and the hover card are anchored in SCREEN
 *  space, at where their node was when they opened. The camera moving
 *  under them leaves them floating over nothing — so any pan or zoom
 *  dismisses them, the same contract every canvas app honours. */
function dismissOverlays(): void {
  closeNodeLayers();
  hideTooltip();
}

const MIN_SCALE = 0.25;
const MAX_SCALE = 3;
/** Below this the tiles draw as solid blocks (``is-far``). */
const FAR_SCALE = 0.55;

/** Zoom rates. A pinch (ctrlKey wheel) delivers small continuous
 *  deltas while a plain wheel delivers ±100-ish notches — one shared
 *  rate would make one of the two violent. ``ZOOM_STEP`` is exactly
 *  one standard wheel notch (deltaY = 100), so the HUD's −/+ buttons
 *  and the wheel are the same control at the same pace. */
const PINCH_ZOOM_RATE = 0.01;
const WHEEL_ZOOM_RATE = 0.002;
const ZOOM_STEP = Math.exp(100 * WHEEL_ZOOM_RATE);

/** Padding around the graph when fitting, in screen pixels. */
const FIT_PAD = 72;

/** Height the floating composer and the HUD occupy at the bottom of the
 *  pane. The canvas runs underneath them; only ``fitCanvas`` cares,
 *  because a fit that centres behind the composer is a fit you have to
 *  undo by hand. */
const COMPOSER_STRIP = 150;

interface CanvasHandle {
  world: SVGGElement;
  host: HTMLElement;
}

let _handle: CanvasHandle | null = null;

/** A session's opening fit stays owed until one actually lands. The
 *  first attach often happens before the pane has a size or the SVG a
 *  layout — ``fitCanvas`` bails on both — and a one-shot flag burned
 *  there would leave the graph parked at the origin (top-left) for the
 *  rest of the session. Re-renders and resizes retry while this is
 *  set; the first successful fit clears it. */
let _fitPending = false;

/** Push the current view onto the world group, the backdrop lattice and
 *  the zoom readout. One function so the three can never disagree. */
export function applyView(): void {
  if (!_handle) return;
  const { world, host } = _handle;
  world.setAttribute(
    "transform",
    `translate(${_viewTx},${_viewTy}) scale(${_viewScale})`,
  );
  // The lattice pitch is the layout's own column width, and the offset
  // puts a dot's CENTRE under every node anchor: nodes sit at
  // ``PAD + k * COL_W`` in world space, while a background tile paints
  // its dot in the tile's middle — so the tile origin backs up half a
  // tile from the pad.
  //
  // Zoomed far out the on-screen pitch collapses and the pane dissolves
  // into solid dot noise — so the lattice COARSENS in powers of two,
  // keeping the pitch at 24px or more. Doubling the step keeps every
  // remaining dot on a node anchor (a 2^n multiple of COL_W still hits
  // the grid), so the lattice never drifts off the coordinate system it
  // is.
  const rawPitch = COL_W * _viewScale;
  const factor = rawPitch >= 24
    ? 1
    : Math.pow(2, Math.ceil(Math.log2(24 / rawPitch)));
  const step = COL_W * factor;
  const pitch = step * _viewScale;
  host.style.backgroundPosition =
    `${_viewTx + (PAD_X - step / 2) * _viewScale}px `
    + `${_viewTy + (PAD_Y - step / 2) * _viewScale}px`;
  host.style.backgroundSize = `${pitch}px ${pitch}px`;
  // The dot radius rides the zoom too: fixed at 1.2px it vanishes into
  // a 100px tile when zoomed in. Clamped so zoomed-out views don't
  // dissolve into noise. The colour is the theme's own hairline — a
  // hardcoded white was invisible on light themes.
  const dotR = Math.min(3, Math.max(1, 1.2 * _viewScale)).toFixed(2);
  host.style.backgroundImage =
    `radial-gradient(var(--border-light, rgba(255, 255, 255, 0.10)) `
    + `${dotR}px, transparent ${dotR}px)`;
  // Semantic zoom (dag/rendering.md §4): zoomed out, the agents keep their
  // on-screen size like markers on a map, labels shrink only gently (12px
  // at 100%, about 8.5px at the least zoom), and below FAR_SCALE the
  // tiles turn into solid blocks of their tone, too small for an icon.
  host.style.setProperty("--dag-marker-scale", String(Math.max(1, 1 / _viewScale)));
  host.style.setProperty("--dag-label-scale", String(Math.max(1, _viewScale ** -0.75)));
  host.classList.toggle("is-far", _viewScale < FAR_SCALE);
  paintFarLabels(world, _viewScale < 1);
  const pct = document.querySelector<HTMLElement>(".dag-zoom-readout");
  if (pct) pct.textContent = Math.round(_viewScale * 100) + "%";
  const seen = { tx: _viewTx, ty: _viewTy, scale: _viewScale, w: host.clientWidth, h: host.clientHeight - COMPOSER_STRIP };
  paintMinimap(host, world, seen, jumpTo);
}

/** Centre the view on world point (x, y), keeping the zoom (the minimap). */
function jumpTo(x: number, y: number): void {
  if (!_handle) return;
  _glide?.stop();
  const { host } = _handle;
  setView(Math.round(host.clientWidth / 2 - x * _viewScale),
    Math.round((host.clientHeight - COMPOSER_STRIP) / 2 - y * _viewScale), _viewScale);
  applyView();
}

/** The smallest scale a session OPENS at. A long session fitted whole
 *  shrank to a hairline column of unreadable specks (a 40-turn chat
 *  opened at 37%); arriving at a session should show where it is now,
 *  readable, and leave "everything at once" to the Fit button. */
const OPEN_MIN_SCALE = 0.8;

/** Centre the graph in the pane at a scale that shows all of it (or
 *  ``only`` that box of it, the selection's — ``frameSelection``).
 *
 *  ``opening`` is a session's first view: the same fit, but never below
 *  ``OPEN_MIN_SCALE``. When the graph does not fit at that scale the
 *  view frames HEAD instead — near the bottom of the strip, the way a
 *  transcript opens on its latest message.
 *
 *  The translation is rounded to whole pixels: at a fractional offset
 *  every node sits a fraction of a pixel off its background dot, and the
 *  lattice stops reading as the coordinate system it is. */
export function fitCanvas(opening = false, only?: DOMRect): void {
  if (!_handle) return;
  dismissOverlays();
  const { world, host } = _handle;
  let bb: DOMRect;
  try {
    bb = only ?? (world as SVGGraphicsElement).getBBox();
  } catch {
    return;
  }
  if (!bb.width || !bb.height) return;
  const w = host.clientWidth;
  // The composer floats over the bottom of the pane. The canvas runs
  // under it — panning there is one gesture — but a FIT should land the
  // graph where it can be read, so it centres in the strip above.
  const h = host.clientHeight - COMPOSER_STRIP;
  if (!w || h <= 0) return;
  const fit = Math.min(
    (w - FIT_PAD * 2) / bb.width,
    (h - FIT_PAD * 2) / bb.height,
  );
  // A few selected nodes may come closer than the whole graph would.
  const scale = Math.min(
    only ? 2 : 1.3, Math.max(opening ? OPEN_MIN_SCALE : MIN_SCALE, fit),
  );
  let tx = (w - bb.width * scale) / 2 - bb.x * scale;
  let ty = (h - bb.height * scale) / 2 - bb.y * scale;
  const head = opening && scale > fit ? headPoint(world) : null;
  if (head) {
    // Whichever axis overflows follows HEAD; the other stays centred.
    if (bb.width * scale > w - FIT_PAD * 2) tx = w / 2 - head.x * scale;
    if (bb.height * scale > h - FIT_PAD * 2) ty = h - FIT_PAD - head.y * scale;
  }
  setView(Math.round(tx), Math.round(ty), scale);
  applyView();
  _fitPending = false;
}

/** HEAD's anchor in world space — the node drawer stamps ``data-head``
 *  on its glyph, and the glyph's group carries the node's translate. */
function headPoint(world: SVGGElement): { x: number; y: number } | null {
  const g = world.querySelector("[data-head='1']")?.closest(".history-node");
  const m = /translate\(\s*([-\d.]+)[ ,]+([-\d.]+)/.exec(
    g?.getAttribute("transform") || "");
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
}

/** Zoom by ``factor`` about the screen-space anchor ``(px, py)``: the
 *  world point under the anchor stays under it before and after. */
function zoomAt(px: number, py: number, factor: number): void {
  const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, _viewScale * factor));
  setView(
    px - (px - _viewTx) * (next / _viewScale),
    py - (py - _viewTy) * (next / _viewScale),
    next,
  );
  applyView();
}

/** One HUD −/+ press: one wheel notch of zoom. The buttons have no
 *  cursor position to anchor on, so they anchor on the pane's centre. */
export function zoomStep(dir: 1 | -1): void {
  if (!_handle) return;
  dismissOverlays();
  const { host } = _handle;
  zoomAt(
    host.clientWidth / 2,
    host.clientHeight / 2,
    dir > 0 ? ZOOM_STEP : 1 / ZOOM_STEP,
  );
}

/** The HUD's zoom readout doubles as the reset: back to 100%, pane
 *  centre anchored, pan otherwise kept. */
export function resetZoom(): void {
  if (!_handle) return;
  dismissOverlays();
  const { host } = _handle;
  zoomAt(host.clientWidth / 2, host.clientHeight / 2, 1 / _viewScale);
}

/** Where the camera can go to find someone: each working agent's tile,
 *  in the order the token layer drew them, else HEAD. World units. */
function agentSpots(world: SVGGElement): { x: number; y: number }[] {
  const spots: { x: number; y: number }[] = [];
  world.querySelectorAll(".dag-agents > .dag-agent-token:not(.is-idle)").forEach((t) => {
    const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(t.getAttribute("transform") || "");
    // A dot is pinned to its tile's centre (render/agents.ts).
    if (m) spots.push({ x: Number(m[1]), y: Number(m[2]) });
  });
  if (!spots.length) {
    const head = headPoint(world);
    if (head) spots.push(head);
  }
  return spots;
}

/** Fit the view to the selected nodes, as design tools' Shift+2 does. */
export function frameSelection(ids: readonly string[]): void {
  if (!_handle || !ids.length) return;
  const want = new Set(ids);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  _handle.world.querySelectorAll(".history-node").forEach((g) => {
    if (!want.has(g.getAttribute("data-msg-id") || "")) return;
    const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(g.getAttribute("transform") || "");
    if (!m) return;
    x0 = Math.min(x0, +m[1] - TILE_R); y0 = Math.min(y0, +m[2] - TILE_R);
    x1 = Math.max(x1, +m[1] + TILE_R); y1 = Math.max(y1, +m[2] + TILE_R);
  });
  if (x0 > x1) return;
  fitCanvas(false, new DOMRect(x0, y0, x1 - x0, y1 - y0));
}

let _focusTurn = 0;
let _glide: AnimationPlaybackControls | null = null;

/** Glide the camera to the next working agent (or HEAD), keeping the
 *  zoom. Pressed again it moves on to the next agent, so with several
 *  at work one key walks through them all. */
export function focusAgent(): void {
  if (!_handle) return;
  dismissOverlays();
  const { world, host } = _handle;
  const spots = agentSpots(world);
  if (!spots.length) return;
  const at = spots[_focusTurn++ % spots.length];
  const w = host.clientWidth;
  const h = host.clientHeight - COMPOSER_STRIP;
  const from = { tx: _viewTx, ty: _viewTy };
  const to = { tx: Math.round(w / 2 - at.x * _viewScale), ty: Math.round(h / 2 - at.y * _viewScale) };
  _glide?.stop();
  _glide = animate(0, 1, {
    duration: 0.32,
    ease: [0.22, 1, 0.36, 1],
    onUpdate: (k) => {
      setView(from.tx + (to.tx - from.tx) * k, from.ty + (to.ty - from.ty) * k, _viewScale);
      applyView();
    },
  });
}

/** Wire the pan / zoom gestures onto ``host`` once. */
function wireGestures(host: HTMLElement): void {
  const h = host as HTMLElement & { _dagCanvasWired?: boolean };
  if (h._dagCanvasWired) return;
  h._dagCanvasWired = true;

  host.addEventListener(
    "wheel",
    (e: WheelEvent) => {
      e.preventDefault();
      dismissOverlays();
      const rect = host.getBoundingClientRect();
      // A mouse wheel zooms about the cursor, the way a map does; two
      // fingers on a trackpad pan, and a pinch zooms at its own, faster
      // rate (./wheel.ts tells them apart). Line and page deltas (some
      // mice) are turned into pixels first.
      const kind = wheelKind(e);
      if (kind === "pan") {
        setView(_viewTx - e.deltaX, _viewTy - e.deltaY, _viewScale);
        applyView();
        return;
      }
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 100 : e.deltaY;
      const rate = kind === "pinch" ? PINCH_ZOOM_RATE : WHEEL_ZOOM_RATE;
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-dy * rate));
    },
    { passive: false },
  );

  // The right (or middle) button pans, from anywhere on the graph; the
  // left button selects — a drag on empty canvas draws a box (Shift/⌘
  // adds to the selection), and a press that never moves clears it.
  // "Never moves" means less than CLICK_SLOP pixels, whatever the hand's
  // jitter. A right press that never moves is still the right-click
  // menu: macOS fires ``contextmenu`` on the press, before anyone knows
  // whether a drag follows, so the canvas holds the event and replays
  // it on release (``menuAt``).
  const CLICK_SLOP = 3;
  let drag: { x: number; y: number; sx: number; sy: number; id: number; moved: boolean; menuAt: Element | null } | null = null;
  let band: { b: SelectionBand; id: number; sx: number; sy: number; moved: boolean; add: boolean } | null = null;
  let replaying = false;
  host.addEventListener("contextmenu", (e) => {
    if (replaying) return;
    e.preventDefault();
    e.stopPropagation();
  }, true);
  host.addEventListener("pointerdown", (e: PointerEvent) => {
    const t = e.target as Element | null;
    // A drag from an overlay card (expanded tooltip, node menu, raw
    // JSON) is the user SELECTING TEXT, not panning — and the pan's
    // dismissOverlays() would eat the card mid-selection.
    if (t?.closest?.(".history-tooltip, .dag-inspector, .dag-menu-verbs")) return;
    const pans = e.button === 2 || e.button === 1;
    // A left press on a node or a branch name is a click on it.
    if (!pans && t?.closest?.(".history-node, .history-branch-tag")) return;
    dismissOverlays();
    try {
      host.setPointerCapture(e.pointerId);
    } catch {
      /* a pointer that vanished mid-gesture is not an error */
    }
    if (!pans) {
      releaseEditableFocus();
      band = {
        b: new SelectionBand(host, { x: e.clientX, y: e.clientY }),
        id: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false,
        add: e.shiftKey || e.metaKey,
      };
      return;
    }
    drag = {
      x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY,
      id: e.pointerId, moved: false, menuAt: e.button === 2 ? t : null,
    };
    host.classList.add("is-panning");
  });
  host.addEventListener("pointermove", (e: PointerEvent) => {
    if (band && e.pointerId === band.id) {
      if (!band.moved
          && Math.hypot(e.clientX - band.sx, e.clientY - band.sy) < CLICK_SLOP) {
        return;
      }
      band.moved = true;
      band.b.move({ x: e.clientX, y: e.clientY });
      return;
    }
    if (!drag || e.pointerId !== drag.id) return;
    setView(
      _viewTx + (e.clientX - drag.x),
      _viewTy + (e.clientY - drag.y),
      _viewScale,
    );
    drag.x = e.clientX;
    drag.y = e.clientY;
    drag.moved = drag.moved
      || Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) >= CLICK_SLOP;
    applyView();
  });
  const endDrag = (e: PointerEvent): void => {
    if (band && e.pointerId === band.id) {
      const { b, moved, add } = band;
      band = null;
      const hits = moved && e.type === "pointerup" ? b.hits() : [];
      b.remove();
      if (hits.length) select(hits, add ? "add" : "replace");
      else if (!add && e.type === "pointerup") clearSelection();
      return;
    }
    if (!drag || e.pointerId !== drag.id) return;
    const { menuAt, moved } = drag;
    drag = null;
    host.classList.remove("is-panning");
    if (menuAt && !moved && e.type === "pointerup") {
      replaying = true;
      menuAt.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY, button: 2,
      }));
      replaying = false;
    }
  };
  host.addEventListener("pointerup", endDrag);
  host.addEventListener("pointercancel", endDrag);
}

/**
 * Put ``svg`` (with ``world`` inside it) on screen in ``host`` and hand
 * back the view the user had.
 *
 * A re-render is not a reason to move the camera: the graph repaints on
 * every capture, and refitting each time would drag the view around
 * while the user is reading. Only arriving at a different session — a
 * different graph entirely — starts from a fit.
 */
export function attachCanvas(
  host: HTMLElement,
  svg: SVGElement,
  world: SVGGElement,
  sessionId: string | null,
): void {
  host.replaceChildren(svg);
  _handle = { world, host };
  wireGestures(host);
  wireFitRetryOnResize(host);
  const fresh = _viewSession !== sessionId;
  setViewSession(sessionId);
  if (fresh) _fitPending = true;
  applyView();
  if (_fitPending) {
    // getBBox needs the element laid out; a frame later it is. If the
    // pane still has no size (hidden tab, mid-layout), the fit stays
    // pending and the next render or resize retries it.
    requestAnimationFrame(() => fitCanvas(true));
  }
}

/** The pane can gain its size long after the first attach (panel
 *  animated open, tab made visible) with no re-render in between —
 *  retry the owed fit the moment it has room. */
function wireFitRetryOnResize(host: HTMLElement): void {
  const h = host as HTMLElement & { _dagFitResizeWired?: boolean };
  if (h._dagFitResizeWired || typeof ResizeObserver === "undefined") return;
  h._dagFitResizeWired = true;
  // No host check: ``fitCanvas`` already bails without a handle, and
  // when one exists the owed fit belongs to it — a resize on any wired
  // pane is room enough to retry, so the stricter ``_handle.host ===
  // host`` half-guard only ever dropped retries.
  new ResizeObserver(() => {
    if (_fitPending) fitCanvas(true);
  }).observe(host);
}

/** The canvas is gone (empty session, skeleton): forget the handle so a
 *  stale group never receives a transform. */
export function detachCanvas(): void {
  if (_handle) hideMinimap(_handle.host);
  _handle = null;
}
