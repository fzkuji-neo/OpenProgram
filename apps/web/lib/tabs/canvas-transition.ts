/** Animated canvas changes, the way macOS moves windows: a pane that stays
 *  slides and resizes from where it was, a pane that leaves plays out as a
 *  ghost (a copy of how it looked), and a pane that arrives fades in.
 *
 *  A caller captures the canvas just before it changes the layout; the app
 *  shell plays the capture in the layout effect of the commit that changed
 *  it, before that frame paints. Panes are matched by tab id, so a tab that
 *  moves between the split's peer pane and the lone chat shell still
 *  animates. Geometry runs through the Web Animations API, which never
 *  touches the panes' inline calc() geometry: when an animation ends the
 *  pane is simply back on its own style. */
import { setCanvasAnimating } from "./canvas-drag";

/** How a leaving pane goes: red closes it (it fades and sinks), yellow
 *  folds it up into its tab in the strip, anything else (a pane hidden by
 *  green or by Fill) fades under the panes that take its place. */
export type CanvasExit = "close" | "minimize" | "behind";

const MOVE_MS = 300;
const CLOSE_MS = 180;
const MINIMIZE_MS = 600;
/** A minimize whose tab is not above the pane shrinks toward it instead. */
const SHRINK_MS = 340;
/** The pane beside a folding one waits this long before it fills the room,
 *  so the fold leads and the fill follows. */
const FILL_DELAY_MS = 90;
const TAB_FLASH_MS = 420;
const EASE = "cubic-bezier(.2, .8, .2, 1)";
/** A capture the layout never followed (a close a save prompt cancelled)
 *  is dropped rather than played on some later change. */
const STALE_MS = 1500;

type Ghost = { tabId: string; exit: CanvasExit; node: HTMLElement; rect: DOMRect; scroll: [number, number, number][] };
type Capture = { at: number; root: HTMLElement; rects: Map<string, DOMRect>; ghosts: Ghost[]; exits: Record<string, CanvasExit> };

let pending: Capture | null = null;
let settleTimer: ReturnType<typeof setTimeout> | undefined;

function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function canvasRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-canvas-root]");
}

/** The panes on screen, by tab id: the chat shell, peer and page panes,
 *  and file panes. */
function paneElements(root: HTMLElement): Map<string, HTMLElement> {
  const out = new Map<string, HTMLElement>();
  for (const el of root.querySelectorAll<HTMLElement>(":scope > [data-center-tab-id], :scope > [data-file-pane-id]")) {
    const id = el.dataset.centerTabId || el.dataset.filePaneId;
    if (!id || out.has(id)) continue;
    if (getComputedStyle(el).display === "none") continue;
    const box = el.getBoundingClientRect();
    if (box.width > 0 && box.height > 0) out.set(id, el);
  }
  return out;
}

/** A still copy of a pane: no ids or pane markers (nothing may find it as
 *  the real thing), inert, and scrolled where the pane was. */
function ghostOf(el: HTMLElement): { node: HTMLElement; scroll: [number, number, number][] } {
  const node = el.cloneNode(true) as HTMLElement;
  const scroll: [number, number, number][] = [];
  const from = el.querySelectorAll<HTMLElement>("*");
  const to = node.querySelectorAll<HTMLElement>("*");
  from.forEach((source, index) => {
    if (source.scrollTop || source.scrollLeft) scroll.push([index, source.scrollTop, source.scrollLeft]);
  });
  for (const item of [node, ...to]) {
    item.removeAttribute("id");
    item.removeAttribute("data-center-tab-id");
    item.removeAttribute("data-file-pane-id");
    item.removeAttribute("data-canvas-pane");
  }
  node.setAttribute("data-canvas-ghost", "");
  node.setAttribute("aria-hidden", "true");
  node.inert = true;
  return { node, scroll };
}

/** Record the canvas before a layout change. `exits` says how particular
 *  tabs leave; any other tab that leaves fades under the rest. */
export function captureCanvasTransition(exits: Record<string, CanvasExit> = {}): void {
  if (typeof document === "undefined" || reducedMotion()) return;
  const root = canvasRoot();
  if (!root) return;
  const rects = new Map<string, DOMRect>();
  const ghosts: Ghost[] = [];
  for (const [id, el] of paneElements(root)) {
    const rect = el.getBoundingClientRect();
    rects.set(id, rect);
    const { node, scroll } = ghostOf(el);
    ghosts.push({ tabId: id, exit: exits[id] ?? "behind", node, rect, scroll });
  }
  if (!rects.size) return;
  pending = { at: performance.now(), root, rects, ghosts, exits };
  // Web panes start freezing to a snapshot now, so the native views are
  // still by the time the panes move.
  setCanvasAnimating(true);
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => {
    if (pending && performance.now() - pending.at >= STALE_MS) pending = null;
    if (!pending) setCanvasAnimating(false);
  }, STALE_MS);
}

function moved(a: DOMRect, b: DOMRect): boolean {
  return Math.abs(a.left - b.left) > 0.5 || Math.abs(a.top - b.top) > 0.5
    || Math.abs(a.width - b.width) > 0.5 || Math.abs(a.height - b.height) > 0.5;
}

function place(node: HTMLElement, rect: DOMRect, origin: DOMRect, z: number): void {
  Object.assign(node.style, {
    position: "absolute",
    left: `${rect.left - origin.left}px`,
    top: `${rect.top - origin.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: "0",
    zIndex: String(z),
    pointerEvents: "none",
    transformOrigin: "0 0",
  });
}

/** The tab a minimized pane folds into, if the strip shows it. */
function stripTab(tabId: string): HTMLElement | null {
  const tab = document.querySelector<HTMLElement>(`[role="tab"][data-tab-id="${CSS.escape(tabId)}"]`);
  const rect = tab?.getBoundingClientRect();
  return tab && rect && rect.width > 0 && rect.height > 0 ? tab : null;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const smoothstep = (value: number) => value * value * (3 - 2 * value);
const easeInOut = (value: number) => value < 0.5 ? 4 * value ** 3 : 1 - (-2 * value + 2) ** 3 / 2;

/** The projective transform that maps a w×h box onto the quad p0 p1 p2 p3
 *  (top-left, top-right, bottom-right, bottom-left). Null when the quad has
 *  collapsed to a line. */
function quadMatrix(w: number, h: number, [x0, y0, x1, y1, x2, y2, x3, y3]: number[]): string | null {
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  const det = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(det) < 1e-6) return null;
  const g = (dx3 * dy2 - dx2 * dy3) / det;
  const k = (dx1 * dy3 - dx3 * dy1) / det;
  const a = x1 - x0 + g * x1, b = x3 - x0 + k * x3;
  const d = y1 - y0 + g * y1, e = y3 - y0 + k * y3;
  return `matrix3d(${a / w},${d / w},0,${g / w},${b / h},${e / h},0,${k / h},0,0,1,0,${x0},${y0},0,1)`;
}

/** The genie fold: the pane is cut into horizontal bands, each mapped every
 *  frame onto a quad, so together they bend into a funnel whose neck is the
 *  tab's bottom edge. The edge nearest the tab pinches first, then the pane
 *  pours up through the neck, packing tighter as it nears it, and is gone at
 *  the tab's bottom edge; the tab lights once as it takes the pane in. */
function genieFold(ghost: Ghost, origin: DOMRect, root: HTMLElement, tab: HTMLElement): void {
  const { node, rect: pane } = ghost;
  const target = tab.getBoundingClientRect();
  const W = pane.width, H = pane.height;
  // Each band holds its own copy of the pane, so a heavy pane gets fewer.
  const nodes = node.getElementsByTagName("*").length + 1;
  const count = Math.max(6, Math.min(20, Math.round(36_000 / nodes)));
  const layer = document.createElement("div");
  layer.setAttribute("data-canvas-ghost", "");
  layer.setAttribute("aria-hidden", "true");
  layer.inert = true;
  place(layer, pane, origin, 50);
  // Nothing shows above the neck: the pane is swallowed there, never drawn over the tab.
  const neck = target.bottom - pane.top;
  layer.style.clipPath = `polygon(-100vw ${neck}px, 200vw ${neck}px, 200vw 200vh, -100vw 200vh)`;
  const bands: { band: HTMLElement; top: number; bottom: number }[] = [];
  for (let index = 0; index < count; index++) {
    const top = Math.round(index * H / count), bottom = Math.round((index + 1) * H / count);
    const band = document.createElement("div");
    Object.assign(band.style, {
      position: "absolute", left: "0", top: `${top}px`, width: `${W}px`, height: `${bottom - top + 1}px`,
      overflow: "hidden", transformOrigin: "0 0", willChange: "transform, opacity",
    });
    const copy = index === count - 1 ? node : node.cloneNode(true) as HTMLElement;
    Object.assign(copy.style, { position: "absolute", left: "0", top: `${-top}px`, width: `${W}px`, height: `${H}px`, margin: "0" });
    band.append(copy);
    layer.append(band);
    bands.push({ band, top, bottom });
  }
  root.append(layer);
  for (const { band } of bands) {
    const all = band.firstElementChild!.querySelectorAll<HTMLElement>("*");
    for (const [index, top, left] of ghost.scroll) {
      const item = all[index];
      if (item) { item.scrollTop = top; item.scrollLeft = left; }
    }
  }

  // In pane coordinates: the neck spans the tab, `reach` is the depth from
  // the neck to the pane's bottom edge, `travel` lifts that edge to the neck.
  const neckLeft = target.left - pane.left, neckRight = target.right - pane.left;
  const reach = Math.max(1, H - neck), travel = H - neck;
  function edge(y: number, t: number): [number, number, number] {
    const pinch = smoothstep(clamp01(t / 0.45));
    const lift = easeInOut(clamp01((t - 0.14) / 0.86));
    const depth = y - neck - lift * travel;
    // Rows pack tighter as they near the neck.
    const Y = neck + (depth > 0 && depth < reach ? reach * (depth / reach) ** (1 + 0.75 * pinch) : depth);
    const below = clamp01((Y - neck) / reach);
    const open = 1 - pinch * (1 - (1 - Math.cos(Math.PI * below)) / 2);
    return [neckLeft + (0 - neckLeft) * open, neckRight + (W - neckRight) * open, Y];
  }
  const start = performance.now();
  let flashed = false;
  function frame(now: number) {
    const t = clamp01((now - start) / MINIMIZE_MS);
    for (const { band, top, bottom } of bands) {
      const [l0, r0, y0] = edge(top, t), [l1, r1, y1] = edge(bottom, t);
      const matrix = quadMatrix(W, bottom - top + 1, [l0, y0 - top, r0, y0 - top, r1, y1 - top, l1, y1 - top]);
      band.style.visibility = matrix && y1 - y0 > 0.25 ? "" : "hidden";
      if (matrix) band.style.transform = matrix;
      band.style.opacity = String(1 - clamp01((t - 0.85) / 0.15));
    }
    if (!flashed && t >= 0.72) {
      flashed = true;
      tab.animate([
        { backgroundColor: "color-mix(in srgb, var(--text-bright) 18%, transparent)", color: "var(--text-bright)" },
        { backgroundColor: getComputedStyle(tab).backgroundColor, color: getComputedStyle(tab).color },
      ], { duration: TAB_FLASH_MS, easing: "ease-out" });
    }
    if (t < 1 && layer.isConnected) requestAnimationFrame(frame);
    else layer.remove();
  }
  requestAnimationFrame(frame);
}

/** Play the capture if this commit carried out its layout change. Called
 *  from the app shell's layout effect, so the first frame already shows
 *  the panes at their old places. */
export function playCanvasTransition(): void {
  const capture = pending;
  if (!capture) return;
  if (performance.now() - capture.at > STALE_MS || document.documentElement.hasAttribute("data-canvas-dragging")) {
    pending = null;
    return;
  }
  const root = capture.root.isConnected ? capture.root : canvasRoot();
  if (!root) { pending = null; return; }
  const now = paneElements(root);
  // A tab named to close or fold away is still here: its change has not
  // committed yet (a save prompt may be up). Wait for the commit that does.
  for (const id of Object.keys(capture.exits)) if (now.has(id)) return;
  const moves: { el: HTMLElement; from: DOMRect; to: DOMRect }[] = [];
  const arrivals: HTMLElement[] = [];
  let changed = false;
  for (const [id, el] of now) {
    const from = capture.rects.get(id);
    if (!from) { arrivals.push(el); changed = true; continue; }
    const to = el.getBoundingClientRect();
    if (moved(from, to)) { moves.push({ el, from, to }); changed = true; }
  }
  const leaving = capture.ghosts.filter(ghost => !now.has(ghost.tabId));
  if (!changed && !leaving.length) return;
  pending = null;

  const origin = root.getBoundingClientRect();
  root.setAttribute("data-canvas-animating", "");
  // A pane folds into its tab when the tab sits above it; otherwise it
  // shrinks toward wherever the tab is.
  const folds = new Map<Ghost, HTMLElement>();
  for (const ghost of leaving) {
    const tab = ghost.exit === "minimize" ? stripTab(ghost.tabId) : null;
    if (tab && tab.getBoundingClientRect().bottom <= ghost.rect.top + 1) folds.set(ghost, tab);
  }
  const animations: Animation[] = [];
  for (const { el, from, to } of moves) {
    // Geometry, not a scaled snapshot: text re-wraps as the pane grows, and
    // chats re-wrap only the rows in view while the width is moving.
    animations.push(el.animate([
      { left: `${from.left - origin.left}px`, top: `${from.top - origin.top}px`, width: `${from.width}px`, height: `${from.height}px` },
      { left: `${to.left - origin.left}px`, top: `${to.top - origin.top}px`, width: `${to.width}px`, height: `${to.height}px` },
    ], folds.size
      ? { duration: MINIMIZE_MS - FILL_DELAY_MS * 1.5, delay: FILL_DELAY_MS, easing: "cubic-bezier(.22, 1, .36, 1)", fill: "backwards" }
      : { duration: MOVE_MS, easing: EASE }));
  }
  for (const [ghost, tab] of folds) genieFold(ghost, origin, root, tab);
  for (const el of arrivals) {
    animations.push(el.animate([
      { opacity: 0, transform: "scale(.97)" },
      { opacity: 1, transform: "none" },
    ], { duration: MOVE_MS, easing: EASE }));
  }
  for (const ghost of leaving) {
    if (folds.has(ghost)) continue;
    const { node, rect, exit } = ghost;
    // Red and yellow ghosts sit over the panes that move into their place;
    // a pane hidden behind a growing one stays under it.
    place(node, rect, origin, exit === "behind" ? 0 : 50);
    if (exit === "behind") root.prepend(node); else root.append(node);
    const all = node.querySelectorAll<HTMLElement>("*");
    for (const [index, top, left] of ghost.scroll) {
      const item = all[index];
      if (item) { item.scrollTop = top; item.scrollLeft = left; }
    }
    let animation: Animation;
    if (exit === "close") {
      animation = node.animate([
        { opacity: 1, transform: "none" },
        { opacity: 0, transform: `translate(${rect.width * 0.03}px, ${rect.height * 0.03}px) scale(.94)` },
      ], { duration: CLOSE_MS, easing: "cubic-bezier(.4, 0, 1, 1)", fill: "forwards" });
    } else if (exit === "minimize") {
      // No tab above the pane to fold into: shrink toward the tab, top edge
      // first.
      const tab = stripTab(ghost.tabId)?.getBoundingClientRect() ?? null;
      const target = tab ?? new DOMRect(rect.left + rect.width / 2 - 60, origin.top - 30, 120, 28);
      const dx = target.left - rect.left;
      const dy = target.top - rect.top;
      const sx = Math.max(0.02, target.width / rect.width);
      const sy = Math.max(0.02, target.height / rect.height);
      animation = node.animate([
        { opacity: 1, transform: "none", borderRadius: "16px" },
        { opacity: 0.9, transform: `translate(${dx * 0.35}px, ${dy * 0.55}px) scale(${0.35 + sx * 0.65}, ${0.3 + sy * 0.7})`, offset: 0.6 },
        { opacity: 0, transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, borderRadius: "8px" },
      ], { duration: SHRINK_MS, easing: "cubic-bezier(.5, 0, .2, 1)", fill: "forwards" });
    } else {
      animation = node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: MOVE_MS, easing: "ease-out", fill: "forwards" });
    }
    animations.push(animation);
    void animation.finished.catch(() => undefined).then(() => node.remove());
  }
  clearTimeout(settleTimer);
  const longest = Math.max(MOVE_MS, ...leaving.map(g => folds.has(g) ? MINIMIZE_MS : g.exit === "minimize" ? SHRINK_MS : g.exit === "close" ? CLOSE_MS : MOVE_MS));
  settleTimer = setTimeout(() => {
    root.removeAttribute("data-canvas-animating");
    setCanvasAnimating(false);
  }, longest + 20);
}
