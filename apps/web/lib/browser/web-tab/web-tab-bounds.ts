export interface WebTabBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function measureWebTabBounds(
  element: Pick<Element, "getBoundingClientRect">,
): WebTabBounds {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

export function isWebTabOccluded(
  bounds: WebTabBounds,
  occluders: Iterable<Pick<Element, "getBoundingClientRect">>,
): boolean {
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  for (const occluder of occluders) {
    const rect = occluder.getBoundingClientRect();
    if (
      rect.width > 0
      && rect.height > 0
      && Math.max(bounds.x, rect.left) < Math.min(right, rect.right)
      && Math.max(bounds.y, rect.top) < Math.min(bottom, rect.bottom)
    ) {
      return true;
    }
  }
  return false;
}

const PLACING = new Set(["transform", "translate", "scale", "left", "top", "width", "height", "inset"]);

/** Whether a running animation is moving or resizing `element` — one on
 *  the element or on any ancestor that animates where things are drawn.
 *  A Web Animation (the overview's zoom, motion's hardware-accelerated
 *  transforms) changes where the element is drawn without touching the
 *  DOM or its layout size, so neither a MutationObserver nor a
 *  ResizeObserver sees it finish. An endless animation (a pulse, a
 *  shimmer) never settles, so it never counts. */
export function isMovedByAnimation(
  element: Element,
  animations: Iterable<Pick<Animation, "playState" | "effect">>,
): boolean {
  for (const animation of animations) {
    if (animation.playState !== "running") continue;
    const effect = animation.effect as KeyframeEffect | null;
    const target = effect?.target;
    if (!effect || !target || !target.contains(element)) continue;
    if (effect.getTiming().iterations === Infinity) continue;
    const moves = effect.getKeyframes().some(frame =>
      Object.keys(frame).some(prop => PLACING.has(prop)));
    if (moves) return true;
  }
  return false;
}
