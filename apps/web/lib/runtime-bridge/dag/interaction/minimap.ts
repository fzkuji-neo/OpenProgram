/**
 * The minimap (dag/rendering.md §13): the whole graph in a corner, the
 * way a strategy game shows its map. Each node is a dot of its tone, the
 * part on screen is a frame in the accent colour, and a press or drag on
 * it moves the camera there. When the whole graph is already on screen
 * there is nothing to find, so the map steps away.
 *
 * It is a canvas beside the graph, outside the SVG, so it never pans or
 * zooms with it. ``canvas.ts`` repaints it on every view change; the dot
 * list is read once per drawn graph.
 */

const W = 168;
const H = 112;
const PAD = 8;
/** Screen pixels a graph may run past the view before the map shows. */
const SLACK = 24;

interface Dot { x: number; y: number; color: string; head: boolean }
interface MapData { dots: Dot[]; x0: number; y0: number; x1: number; y1: number }
export interface MapView { tx: number; ty: number; scale: number; w: number; h: number }

const _data = new WeakMap<SVGGElement, MapData>();

function readGraph(world: SVGGElement): MapData {
  const cached = _data.get(world);
  if (cached) return cached;
  // One computed-style read per tone, not per node.
  const toneColor = new Map<string, string>();
  const dots: Dot[] = [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  world.querySelectorAll<SVGGElement>(".history-node").forEach((g) => {
    const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(g.getAttribute("transform") || "");
    if (!m) return;
    const x = Number(m[1]);
    const y = Number(m[2]);
    const tile = g.querySelector<SVGGElement>(".dag-tile");
    const tone = (tile?.getAttribute("class") || "").match(/\bt-[\w-]+/)?.[0] || "";
    if (!toneColor.has(tone)) {
      toneColor.set(tone, tile ? getComputedStyle(tile).color : "#888");
    }
    dots.push({ x, y, color: toneColor.get(tone)!, head: g.classList.contains("is-head") });
    x0 = Math.min(x0, x); y0 = Math.min(y0, y);
    x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  });
  const data = { dots, x0, y0, x1, y1 };
  _data.set(world, data);
  return data;
}

/** World → map: one scale for both axes, the box centred. The box is
 *  the graph and the view together, so the frame is never cut off. */
function fitter(b: { x0: number; y0: number; x1: number; y1: number }): { k: number; ox: number; oy: number } {
  const gw = Math.max(1, b.x1 - b.x0);
  const gh = Math.max(1, b.y1 - b.y0);
  const k = Math.min((W - PAD * 2) / gw, (H - PAD * 2) / gh);
  return { k, ox: (W - gw * k) / 2 - b.x0 * k, oy: (H - gh * k) / 2 - b.y0 * k };
}

function mapCanvas(host: HTMLElement, jump: (x: number, y: number) => void): HTMLCanvasElement {
  const panel = host.parentElement || host;
  let c = panel.querySelector<HTMLCanvasElement>(":scope > canvas.dag-minimap");
  if (c) return c;
  c = document.createElement("canvas");
  c.className = "dag-minimap";
  c.setAttribute("aria-hidden", "true");
  const dpr = window.devicePixelRatio || 1;
  c.width = W * dpr;
  c.height = H * dpr;
  c.style.width = `${W}px`;
  c.style.height = `${H}px`;
  const toWorld = (e: PointerEvent): void => {
    const map = c as HTMLCanvasElement & { _fit?: { k: number; ox: number; oy: number } };
    if (!map._fit) return;
    const r = map.getBoundingClientRect();
    jump((e.clientX - r.left - map._fit.ox) / map._fit.k, (e.clientY - r.top - map._fit.oy) / map._fit.k);
  };
  c.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    c!.setPointerCapture(e.pointerId);
    toWorld(e);
  });
  c.addEventListener("pointermove", (e) => {
    if (c!.hasPointerCapture(e.pointerId)) toWorld(e);
  });
  // The map holds still under a drag (``paintMinimap``); let go, it
  // refits around where the view ended up.
  c.addEventListener("lostpointercapture", (e) => toWorld(e));
  // A wheel over the map is a wheel over the canvas, about its middle
  // rather than about whatever the map happens to cover.
  c.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = host.getBoundingClientRect();
    host.dispatchEvent(new WheelEvent("wheel", {
      deltaX: e.deltaX, deltaY: e.deltaY, deltaMode: e.deltaMode,
      ctrlKey: e.ctrlKey, metaKey: e.metaKey, cancelable: true,
      clientX: r.left + r.width / 2, clientY: r.top + (r.height - 150) / 2, // above the composer (canvas.ts COMPOSER_STRIP)
    }));
  }, { passive: false });
  panel.appendChild(c);
  return c;
}

/** Repaint the map for ``world`` seen through ``view``. */
export function paintMinimap(
  host: HTMLElement,
  world: SVGGElement,
  view: MapView,
  jump: (x: number, y: number) => void,
): void {
  const c = mapCanvas(host, jump) as HTMLCanvasElement & { _fit?: { k: number; ox: number; oy: number } };
  const d = readGraph(world);
  // What the camera sees, in world units.
  const vx0 = -view.tx / view.scale;
  const vy0 = -view.ty / view.scale;
  const vx1 = (view.w - view.tx) / view.scale;
  const vy1 = (view.h - view.ty) / view.scale;
  // A sliver past the edge (half a tile behind the composer) is still
  // "all on screen": the map comes only when a node's worth is hidden.
  const slack = SLACK / view.scale;
  const allSeen = d.x0 >= vx0 - slack && d.x1 <= vx1 + slack
    && d.y0 >= vy0 - slack && d.y1 <= vy1 + slack;
  const hidden = d.dots.length < 2 || allSeen;
  c.classList.toggle("is-hidden", hidden);
  if (hidden) return;
  // Under a drag the scale stays put, else the map would slide under
  // the pointer as the frame moves.
  const fit = c.matches(":active") && c._fit ? c._fit : fitter({
    x0: Math.min(d.x0, vx0), y0: Math.min(d.y0, vy0),
    x1: Math.max(d.x1, vx1), y1: Math.max(d.y1, vy1),
  });
  c._fit = fit;
  const ctx = c.getContext("2d");
  if (!ctx) return;
  const dpr = c.width / W;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const r = Math.max(1.5, Math.min(3, 24 * fit.k / 2));
  for (const dot of d.dots) {
    ctx.fillStyle = dot.color;
    ctx.beginPath();
    ctx.arc(fit.ox + dot.x * fit.k, fit.oy + dot.y * fit.k, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const accent = getComputedStyle(c).getPropertyValue("--accent-primary").trim() || "#4a7dfc";
  // HEAD is where you are: a larger dot ringed in the accent colour.
  const head = d.dots.find((dot) => dot.head);
  if (head) {
    ctx.beginPath();
    ctx.arc(fit.ox + head.x * fit.k, fit.oy + head.y * fit.k, r + 2.5, 0, Math.PI * 2);
    ctx.fillStyle = head.color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = accent;
    ctx.stroke();
  }
  const frame: [number, number, number, number] = [
    fit.ox + vx0 * fit.k, fit.oy + vy0 * fit.k, (vx1 - vx0) * fit.k, (vy1 - vy0) * fit.k,
  ];
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.12;
  ctx.fillRect(...frame);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(...frame);
}

/** The canvas is gone (empty session): so is its map. */
export function hideMinimap(host: HTMLElement): void {
  (host.parentElement || host).querySelector(":scope > canvas.dag-minimap")?.classList.add("is-hidden");
}
