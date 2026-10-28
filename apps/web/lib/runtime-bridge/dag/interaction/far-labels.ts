/**
 * Labels zoomed out (dag/rendering.md §2, semantic zoom): the way a map
 * keeps its place names readable and shows fewer of them as you pull
 * back. Below 100% the names of branches and the captions keep their
 * on-screen size (app/styles/dag/badges.css, nodes.css) instead of
 * shrinking with the graph; this pass hides the ones that would land on
 * a label already shown. Branch names go first, the current one before
 * the rest, then your messages nearest HEAD, then calls.
 *
 * A hidden label keeps its box (``visibility``), so the next pass can
 * measure it again when the view moves.
 */

const CULLED = "is-culled";
let _frame = 0;

interface Box { l: number; t: number; r: number; b: number }

function hits(a: Box, placed: Box[]): boolean {
  return placed.some((p) => a.l < p.r + 6 && a.r > p.l - 6 && a.t < p.b + 2 && a.b > p.t - 2);
}

function seatY(el: Element): number {
  const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(el.getAttribute("transform") || "");
  return m ? Number(m[2]) : 0;
}

function cull(world: SVGGElement): void {
  const tags = Array.from(world.querySelectorAll<SVGGElement>(".history-branch-tag:not(.is-hidden)"));
  tags.sort((a, b) => Number(b.classList.contains("active")) - Number(a.classList.contains("active")));
  const head = world.querySelector("[data-head='1']")?.closest(".history-node");
  const headY = head ? seatY(head) : Infinity;
  // Your messages before calls, each nearest HEAD first.
  const turns = Array.from(world.querySelectorAll<SVGTextElement>(".dag-caption:not(.is-hidden)"));
  const rank = (el: Element): number => (el.classList.contains("is-turn") ? 0 : 1e9)
    + Math.abs(Number(el.getAttribute("y")) - headY);
  turns.sort((a, b) => rank(a) - rank(b));
  const placed: Box[] = [];
  for (const el of [...tags, ...turns]) {
    const box = (el.querySelector("text") ?? el).getBoundingClientRect();
    const b = { l: box.left, t: box.top, r: box.right, b: box.bottom };
    const clash = !box.width || hits(b, placed);
    el.classList.toggle(CULLED, clash);
    if (!clash) placed.push(b);
  }
}

/** Re-cull after the view settles on this frame; at 100% and up, show all. */
export function paintFarLabels(world: SVGGElement, out: boolean): void {
  if (!out) {
    world.querySelectorAll(`.${CULLED}`).forEach((el) => el.classList.remove(CULLED));
    return;
  }
  if (_frame) return;
  _frame = requestAnimationFrame(() => {
    _frame = 0;
    cull(world);
  });
}
