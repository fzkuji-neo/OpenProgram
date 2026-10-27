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
 *   * pinch, or ⌘/ctrl + wheel → zoom about the cursor, 25%–300%
 *     (what is under the cursor stays under it)
 *   * any other wheel/scroll (trackpad two-finger, mouse wheel) → pan,
 *     both axes — scrolling stays scrolling
 *   * drag on empty space → the active tool's drag: pan, or a marquee /
 *     lasso selection (``./selection.ts``; a drag that starts on a node
 *     is the node's, so clicking still works)
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

import { COL_W, PAD_X, PAD_Y } from "../types";
import { closeNodeLayers } from "../render/inspector";
import { hideTooltip } from "./tooltip";
import {
  SelectionBand,
  activeTool,
  clearSelection,
  releaseEditableFocus,
  select,
  spaceHeld,
} from "./selection";
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
  // Semantic zoom (dag/rendering.md §4): zoomed out, the agents keep
  // their on-screen size like markers on a map, and below FAR_SCALE the
  // tiles turn into solid blocks of their tone, too small for an icon.
  host.style.setProperty("--dag-marker-scale", String(Math.max(1, 1 / _viewScale)));
  host.classList.toggle("is-far", _viewScale < FAR_SCALE);
  const pct = document.querySelector<HTMLElement>(".dag-hud-zoom");
  if (pct) pct.textContent = Math.round(_viewScale * 100) + "%";
}

/** The smallest scale a session OPENS at. A long session fitted whole
 *  shrank to a hairline column of unreadable specks (a 40-turn chat
 *  opened at 37%); arriving at a session should show where it is now,
 *  readable, and leave "everything at once" to the Fit button. */
const OPEN_MIN_SCALE = 0.8;

/** Centre the graph in the pane at a scale that shows all of it.
 *
 *  ``opening`` is a session's first view: the same fit, but never below
 *  ``OPEN_MIN_SCALE``. When the graph does not fit at that scale the
 *  view frames HEAD instead — near the bottom of the strip, the way a
 *  transcript opens on its latest message.
 *
 *  The translation is rounded to whole pixels: at a fractional offset
 *  every node sits a fraction of a pixel off its background dot, and the
 *  lattice stops reading as the coordinate system it is. */
export function fitCanvas(opening = false): void {
  if (!_handle) return;
  dismissOverlays();
  const { world, host } = _handle;
  let bb: DOMRect;
  try {
    bb = (world as SVGGraphicsElement).getBBox();
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
  const scale = Math.min(
    1.3, Math.max(opening ? OPEN_MIN_SCALE : MIN_SCALE, fit),
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
      // Gesture triage:
      //   * ctrl/⌘ + wheel: browsers deliver a trackpad PINCH as a
      //     wheel event with ctrlKey set (and ⌘+wheel is the explicit
      //     zoom chord) — zoom about the cursor at pinch rate;
      //   * a MOUSE wheel — discrete notches: line-mode deltas, or
      //     integer deltaY of a notch's size with no deltaX — zooms,
      //     the only zoom gesture a mouse has besides the HUD;
      //   * everything else is a trackpad two-finger scroll — a PAN,
      //     both axes. Scrolling stays scrolling.
      // macOS scroll acceleration makes a mouse wheel's deltaY
      // fractional and variable, so delta values can't tell the two
      // devices apart. The legacy ``wheelDeltaY`` can: Chromium and
      // WebKit report a physical wheel notch as a multiple of 120,
      // while trackpad scrolls carry arbitrary small values.
      const wd = (e as unknown as { wheelDeltaY?: number }).wheelDeltaY;
      const isMouseWheel = e.deltaMode !== 0
        || (e.deltaX === 0 && typeof wd === "number" && wd !== 0
            && wd % 120 === 0);
      if (e.ctrlKey || e.metaKey) {
        zoomAt(
          e.clientX - rect.left,
          e.clientY - rect.top,
          Math.exp(-e.deltaY * PINCH_ZOOM_RATE),
        );
      } else if (isMouseWheel) {
        zoomAt(
          e.clientX - rect.left,
          e.clientY - rect.top,
          Math.exp(-e.deltaY * WHEEL_ZOOM_RATE),
        );
      } else {
        setView(_viewTx - e.deltaX, _viewTy - e.deltaY, _viewScale);
        applyView();
      }
    },
    { passive: false },
  );

  // A drag on empty canvas is the active tool's (./selection.ts): a pan
  // under the hand — or under any tool while Space is held — a rubber
  // band (rectangle or lasso) under the selecting tools. A press that never moves is a
  // click on empty canvas, which clears the selection — "never moves"
  // meaning less than CLICK_SLOP pixels, whatever the hand's jitter.
  const CLICK_SLOP = 3;
  let drag: { x: number; y: number; sx: number; sy: number; id: number; moved: boolean } | null = null;
  let band: { b: SelectionBand; id: number; sx: number; sy: number; additive: boolean; moved: boolean } | null = null;
  host.addEventListener("pointerdown", (e: PointerEvent) => {
    // Right button is the context menu's; the middle button always pans.
    if (e.button === 2) return;
    // A drag that starts on a node belongs to the node — it is how a
    // click reaches it, and panning from there would swallow every
    // click on the graph.
    const t = e.target as Element | null;
    // A drag from an overlay card (expanded tooltip, node menu, raw
    // JSON) is the user SELECTING TEXT, not panning — and the pan's
    // dismissOverlays() would eat the card mid-selection.
    if (t && t.closest && t.closest(
      ".history-node, .history-branch-tag, .history-tooltip, .dag-inspector, .dag-menu-verbs")) {
      return;
    }
    dismissOverlays();
    const tool = activeTool();
    if (tool.selects) releaseEditableFocus();
    try {
      host.setPointerCapture(e.pointerId);
    } catch {
      /* a pointer that vanished mid-gesture is not an error */
    }
    if (tool.drag !== "pan" && !spaceHeld() && e.button === 0) {
      band = {
        b: new SelectionBand(host, tool.drag, { x: e.clientX, y: e.clientY }),
        id: e.pointerId,
        sx: e.clientX,
        sy: e.clientY,
        additive: e.shiftKey || e.metaKey,
        moved: false,
      };
      return;
    }
    drag = {
      x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY,
      id: e.pointerId, moved: false,
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
      const { b, additive, moved } = band;
      band = null;
      const hits = moved && e.type === "pointerup" ? b.hits() : [];
      b.remove();
      if (hits.length) select(hits, additive ? "add" : "replace");
      else if (!additive && e.type === "pointerup") clearSelection();
      return;
    }
    if (!drag || e.pointerId !== drag.id) return;
    const clicked = !drag.moved && e.type === "pointerup";
    drag = null;
    host.classList.remove("is-panning");
    if (clicked && !e.shiftKey) clearSelection();
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
  _handle = null;
}
