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

/** The part of a web pane inside the canvas it belongs to. A rail opening
 *  moves the canvas every frame, and the panes take its new size a moment
 *  later (on its resize observer); a pane measured in between (a mutation
 *  anywhere on the page triggers a report) sits at the canvas's new left
 *  with its old width, past the canvas's right edge. Sent as is, the
 *  native view spilled over the right rail for that frame. */
export function clipWebTabBounds(
  bounds: WebTabBounds,
  canvas: Pick<DOMRect, "left" | "top" | "right" | "bottom"> | null | undefined,
): WebTabBounds {
  if (!canvas) return bounds;
  const left = Math.max(bounds.x, canvas.left), top = Math.max(bounds.y, canvas.top);
  const right = Math.min(bounds.x + bounds.width, canvas.right);
  const bottom = Math.min(bounds.y + bounds.height, canvas.bottom);
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
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
