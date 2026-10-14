/**
 * Canvas tools and node selection (dag/rendering.md §13).
 *
 * The canvas has a tool, the way a drawing board does. A tool decides
 * two things and nothing else: what a click on a node means, and what a
 * drag on empty canvas does. Everything else — wheel and pinch, the
 * right-click card, the HUD — is the same under every tool.
 *
 *   * hand    — browse. A click runs the node's own action (fold,
 *               double-click fork & edit); a drag pans. The default.
 *   * pointer — a click selects the node (Shift/⌘ adds or removes);
 *               a drag on empty canvas still pans.
 *   * marquee — a drag draws a rectangle; every node it touches is
 *               selected.
 *   * lasso   — a drag draws a free shape; every node it touches is
 *               selected.
 *
 * Tools live in a registry so a new one (a note, an annotation) is one
 * ``registerTool`` call; the toolbar renders whatever is registered.
 * The behaviours are fixed by design, not settings: touching selects,
 * Shift adds, and a click on empty canvas clears.
 *
 * The selection is view state of the current session's canvas: it
 * holds node ids that are on screen, is pruned to what a repaint still
 * draws, and is dropped on a session switch.
 */

import { runtimeState } from "../../state";
import { _svg } from "../render/shapes";

export type DagDrag = "pan" | "marquee" | "lasso";

export interface DagTool {
  id: string;
  /** Single-key shortcut, lowercase. */
  key: string;
  /** A node click selects instead of running the node's own action. */
  selects: boolean;
  /** What a drag that starts on empty canvas does. */
  drag: DagDrag;
}

const _tools: DagTool[] = [];
let _toolId = "hand";
let _selected: string[] = [];
let _selectionSession: string | null = null;
let _version = 0;
const _listeners = new Set<() => void>();

/** Add a tool to the canvas toolbar (or replace one with the same id). */
export function registerTool(tool: DagTool): void {
  const i = _tools.findIndex((t) => t.id === tool.id);
  if (i >= 0) _tools[i] = tool;
  else _tools.push(tool);
  emit();
}

registerTool({ id: "hand", key: "h", selects: false, drag: "pan" });
registerTool({ id: "pointer", key: "v", selects: true, drag: "pan" });
registerTool({ id: "marquee", key: "m", selects: true, drag: "marquee" });
registerTool({ id: "lasso", key: "l", selects: true, drag: "lasso" });

export function dagTools(): readonly DagTool[] {
  return _tools;
}

/** Tell the toolbar something it shows changed (also used by
 *  ``./node-delete`` for the delete/undo state). */
export function emit(): void {
  _version++;
  _listeners.forEach((fn) => fn());
}

/** React's ``useSyncExternalStore`` pair: any tool or selection change
 *  bumps the version. */
export function subscribeSelection(fn: () => void): () => void {
  _listeners.add(fn);
  return () => {
    _listeners.delete(fn);
  };
}
export function selectionVersion(): number {
  return _version;
}

export function activeTool(): DagTool {
  return _tools.find((t) => t.id === _toolId) || _tools[0];
}

export function setTool(id: string): void {
  if (id === _toolId || !_tools.some((t) => t.id === id)) return;
  _toolId = id;
  const host = canvasHost();
  if (host) host.dataset.dagTool = id;
  emit();
}

export function selectedIds(): readonly string[] {
  return _selected;
}

export type SelectMode = "replace" | "add" | "toggle";

export function select(ids: string[], mode: SelectMode = "replace"): void {
  let next: string[];
  if (mode === "replace") {
    next = Array.from(new Set(ids));
  } else if (mode === "add") {
    next = Array.from(new Set([..._selected, ...ids]));
  } else {
    const cur = new Set(_selected);
    ids.forEach((id) => (cur.has(id) ? cur.delete(id) : cur.add(id)));
    next = Array.from(cur);
  }
  _selectionSession = runtimeState.currentSessionId;
  if (next.length === _selected.length && next.every((id, i) => id === _selected[i])) {
    return;
  }
  _selected = next;
  paintSelection();
  emit();
}

export function clearSelection(): void {
  if (!_selected.length) return;
  _selected = [];
  paintSelection();
  emit();
}

function canvasHost(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.querySelector<HTMLElement>("#historyPanel .history-body");
}

/** Ring every selected node and drop ids the canvas no longer draws
 *  (deleted, folded away, another session). Called after each repaint
 *  and on every selection change. */
export function paintSelection(): void {
  const host = canvasHost();
  if (!host) return;
  host.dataset.dagTool = _toolId;
  const sid = runtimeState.currentSessionId;
  let pruned = _selectionSession !== sid && _selected.length > 0;
  if (pruned) _selected = [];
  _selectionSession = sid;
  const want = new Set(_selected);
  const drawn = new Set<string>();
  host.querySelectorAll<SVGGElement>(".history-node").forEach((g) => {
    const id = g.getAttribute("data-msg-id") || "";
    const on = want.has(id);
    if (on) drawn.add(id);
    const ring = g.querySelector(":scope > .dag-select-ring");
    if (on && !ring) g.appendChild(selectionRing(g));
    else if (!on && ring) ring.remove();
  });
  if (drawn.size !== want.size) {
    _selected = _selected.filter((id) => drawn.has(id));
    pruned = true;
  }
  if (pruned) emit();
}

/** A dashed rounded box a few pixels outside the node's glyph. Sized
 *  from the glyph itself, so a capsule gets a wide ring and a dot a
 *  small one. */
function selectionRing(g: SVGGElement): SVGElement {
  const glyph = g.querySelector<SVGGraphicsElement>("[data-node-shape]");
  let x = -6;
  let y = -6;
  let w = 12;
  let h = 12;
  try {
    const bb = glyph?.getBBox();
    if (bb && bb.width) ({ x, y, width: w, height: h } = bb);
  } catch {
    /* not laid out yet — the default box fits a plain node */
  }
  const pad = 4;
  return _svg("rect", {
    class: "dag-select-ring",
    x: x - pad,
    y: y - pad,
    width: w + pad * 2,
    height: h + pad * 2,
    rx: 4,
    "pointer-events": "none",
  });
}

/* ── hit-testing for marquee and lasso (screen space) ────────────── */

export interface Pt {
  x: number;
  y: number;
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function boxesTouch(a: Box, b: Box): boolean {
  return a.left <= b.right && b.left <= a.right
    && a.top <= b.bottom && b.top <= a.bottom;
}

function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y)
        && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function segmentsCross(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const d = (a: Pt, b: Pt, c: Pt): number =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

/** The lasso touches a box when the box sits inside the closed shape,
 *  the shape sits inside the box, or the stroke crosses the box. */
export function lassoTouchesBox(poly: Pt[], b: Box): boolean {
  if (poly.length < 2) return false;
  const corners: Pt[] = [
    { x: b.left, y: b.top },
    { x: b.right, y: b.top },
    { x: b.right, y: b.bottom },
    { x: b.left, y: b.bottom },
  ];
  if (poly.some((p) => p.x >= b.left && p.x <= b.right && p.y >= b.top && p.y <= b.bottom)) {
    return true;
  }
  if (poly.length >= 3 && corners.some((c) => pointInPolygon(c, poly))) return true;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const c = poly[(i + 1) % poly.length];
    for (let k = 0; k < 4; k++) {
      if (segmentsCross(a, c, corners[k], corners[(k + 1) % 4])) return true;
    }
  }
  return false;
}

export function rectTouchesBox(r: Box, b: Box): boolean {
  return boxesTouch(r, b);
}

/** Ids of the drawn nodes whose glyph the shape touches. ``shape`` is
 *  in viewport (client) coordinates. */
export function nodesTouched(
  shape: { rect: Box } | { lasso: Pt[] },
): string[] {
  const host = canvasHost();
  if (!host) return [];
  const out: string[] = [];
  host.querySelectorAll<SVGGElement>(".history-node").forEach((g) => {
    const id = g.getAttribute("data-msg-id");
    const glyph = g.querySelector("[data-node-shape]") || g;
    if (!id) return;
    const r = glyph.getBoundingClientRect();
    if (!r.width && !r.height) return;
    const hit = "rect" in shape
      ? rectTouchesBox(shape.rect, r)
      : lassoTouchesBox(shape.lasso, r);
    if (hit) out.push(id);
  });
  return out;
}

/* ── the drag overlay ───────────────────────────────────────────── */

/** The rubber band drawn while a marquee or lasso drag is under way. An
 *  SVG laid over the canvas in host coordinates; it never carries the
 *  camera transform, because it is a gesture, not part of the graph. */
export class SelectionBand {
  private host: HTMLElement;
  private kind: "marquee" | "lasso";
  private origin: Pt;
  private svg: SVGSVGElement;
  private shape: SVGElement;
  private pts: Pt[] = [];

  constructor(host: HTMLElement, kind: "marquee" | "lasso", origin: Pt) {
    this.host = host;
    this.kind = kind;
    this.origin = origin;
    this.svg = _svg("svg", { class: "dag-select-band" }) as SVGSVGElement;
    this.shape = _svg(kind === "marquee" ? "rect" : "path", {});
    this.svg.appendChild(this.shape);
    host.appendChild(this.svg);
    this.pts = [origin];
  }

  private local(p: Pt): Pt {
    const r = this.host.getBoundingClientRect();
    return { x: p.x - r.left, y: p.y - r.top };
  }

  move(p: Pt): void {
    if (this.kind === "marquee") {
      this.pts = [this.origin, p];
      const a = this.local(this.origin);
      const b = this.local(p);
      this.shape.setAttribute("x", String(Math.min(a.x, b.x)));
      this.shape.setAttribute("y", String(Math.min(a.y, b.y)));
      this.shape.setAttribute("width", String(Math.abs(a.x - b.x)));
      this.shape.setAttribute("height", String(Math.abs(a.y - b.y)));
      return;
    }
    const last = this.pts[this.pts.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) < 3) return;
    this.pts.push(p);
    const d = this.pts
      .map((q, i) => {
        const l = this.local(q);
        return `${i ? "L" : "M"}${l.x.toFixed(1)},${l.y.toFixed(1)}`;
      })
      .join(" ");
    this.shape.setAttribute("d", d + " Z");
  }

  /** What the band touched, in client coordinates. */
  hits(): string[] {
    if (this.kind === "marquee") {
      const [a, b] = this.pts.length > 1 ? this.pts : [this.origin, this.origin];
      return nodesTouched({
        rect: {
          left: Math.min(a.x, b.x),
          top: Math.min(a.y, b.y),
          right: Math.max(a.x, b.x),
          bottom: Math.max(a.y, b.y),
        },
      });
    }
    return nodesTouched({ lasso: this.pts });
  }

  remove(): void {
    this.svg.remove();
  }
}

/** Space held = a temporary hand: a drag pans under any tool, the way
 *  every drawing app does it (``./keys`` tracks the key). */
let _spaceHeld = false;
export function spaceHeld(): boolean {
  return _spaceHeld;
}
export function setSpaceHeld(v: boolean): void {
  if (v === _spaceHeld) return;
  _spaceHeld = v;
  const host = canvasHost();
  if (host) host.classList.toggle("is-space-pan", v);
}

/* ── keyboard focus helpers ─────────────────────────────────────── */

export function isEditableFocus(): boolean {
  if (typeof document === "undefined") return false;
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** Selecting on the canvas takes the keyboard away from the composer,
 *  so Delete and Esc reach the selection instead of the draft. */
export function releaseEditableFocus(): void {
  if (isEditableFocus()) (document.activeElement as HTMLElement).blur();
}

/** The graph perspective is on screen. */
export function dagVisible(): boolean {
  const host = canvasHost();
  return !!host && host.getClientRects().length > 0;
}
