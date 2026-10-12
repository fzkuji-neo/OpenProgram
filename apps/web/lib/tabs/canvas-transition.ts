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
const MINIMIZE_MS = 340;
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
function stripTabRect(tabId: string): DOMRect | null {
  const tab = document.querySelector<HTMLElement>(`[role="tab"][data-tab-id="${CSS.escape(tabId)}"]`);
  const rect = tab?.getBoundingClientRect();
  return rect && rect.width > 0 && rect.height > 0 ? rect : null;
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
  const animations: Animation[] = [];
  for (const { el, from, to } of moves) {
    // Geometry, not a scaled snapshot: text re-wraps as the pane grows, and
    // chats re-wrap only the rows in view while the width is moving.
    animations.push(el.animate([
      { left: `${from.left - origin.left}px`, top: `${from.top - origin.top}px`, width: `${from.width}px`, height: `${from.height}px` },
      { left: `${to.left - origin.left}px`, top: `${to.top - origin.top}px`, width: `${to.width}px`, height: `${to.height}px` },
    ], { duration: MOVE_MS, easing: EASE }));
  }
  for (const el of arrivals) {
    animations.push(el.animate([
      { opacity: 0, transform: "scale(.97)" },
      { opacity: 1, transform: "none" },
    ], { duration: MOVE_MS, easing: EASE }));
  }
  for (const ghost of leaving) {
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
      // Fold up into the tab: shrink toward it, top edge first, as the Dock
      // genie pulls a window down into its icon.
      const tab = stripTabRect(ghost.tabId);
      const target = tab ?? new DOMRect(rect.left + rect.width / 2 - 60, origin.top - 30, 120, 28);
      const dx = target.left - rect.left;
      const dy = target.top - rect.top;
      const sx = Math.max(0.02, target.width / rect.width);
      const sy = Math.max(0.02, target.height / rect.height);
      animation = node.animate([
        { opacity: 1, transform: "none", borderRadius: "16px" },
        { opacity: 0.9, transform: `translate(${dx * 0.35}px, ${dy * 0.55}px) scale(${0.35 + sx * 0.65}, ${0.3 + sy * 0.7})`, offset: 0.6 },
        { opacity: 0, transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, borderRadius: "8px" },
      ], { duration: MINIMIZE_MS, easing: "cubic-bezier(.5, 0, .2, 1)", fill: "forwards" });
    } else {
      animation = node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: MOVE_MS, easing: "ease-out", fill: "forwards" });
    }
    animations.push(animation);
    void animation.finished.catch(() => undefined).then(() => node.remove());
  }
  clearTimeout(settleTimer);
  const longest = Math.max(MOVE_MS, ...leaving.map(g => g.exit === "minimize" ? MINIMIZE_MS : g.exit === "close" ? CLOSE_MS : MOVE_MS));
  settleTimer = setTimeout(() => {
    root.removeAttribute("data-canvas-animating");
    setCanvasAnimating(false);
  }, longest + 20);
}
