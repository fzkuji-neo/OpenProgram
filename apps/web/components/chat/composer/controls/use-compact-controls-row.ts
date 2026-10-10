"use client";

import { useLayoutEffect, type RefObject } from "react";

const COMPACT_HYSTERESIS = 12;

/** Width the row's clusters take at full size: the sum of the in-flow
 *  children plus the gaps between them. */
function clustersWidth(row: HTMLElement): number {
  const gap = parseFloat(getComputedStyle(row).columnGap || "0") || 0;
  let total = 0;
  let count = 0;
  for (const child of Array.from(row.children)) {
    // Hover tips and floating cards (the expanded effort card) are out of
    // flow; only laid-out clusters take room.
    const position = getComputedStyle(child).position;
    if (position === "fixed" || position === "absolute") continue;
    const width = child.getBoundingClientRect().width;
    if (!width) continue;
    total += width;
    count += 1;
  }
  return total + gap * Math.max(0, count - 1);
}

/**
 * Collapse the bottom control row's labels (permission, chat model,
 * exec model, effort) to their role icons when the controls do not fit.
 *
 * The row's need depends on which tool toggles are on and how long the
 * model names are, so no fixed container width is right. The full-size
 * need is measured on a hidden copy of the row, never on the row itself:
 * the row's Buttons transition every property, so a live row that just
 * left compact mode still reports its compact widths mid-transition and
 * would be judged to fit. The copy sits beside the row at max-content
 * width with `data-measuring` (no shrinking, no transitions), is read
 * synchronously and removed before paint. Expanding again needs
 * COMPACT_HYSTERESIS px of slack so the row doesn't flap at the boundary.
 * The result is `data-compact="true"` on the row.
 *
 * Re-measured when the row resizes, when its content or classes change
 * (a tool toggled, a model or effort switched) and when web fonts finish
 * loading.
 */
export function useCompactControlsRow(ref: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const row = ref.current;
    if (!row) return;

    let frame = 0;
    let compact = false;

    const fullWidth = () => {
      const host = row.parentElement;
      if (!host) return 0;
      const probe = row.cloneNode(true) as HTMLElement;
      probe.removeAttribute("data-compact");
      probe.dataset.measuring = "true";
      probe.setAttribute("aria-hidden", "true");
      probe.setAttribute("inert", "");
      for (const node of Array.from(probe.querySelectorAll("[id]"))) node.removeAttribute("id");
      probe.style.cssText =
        "position:absolute;left:0;top:0;width:max-content;max-width:none;" +
        "visibility:hidden;pointer-events:none;contain:layout style;";
      host.appendChild(probe);
      try {
        return clustersWidth(probe);
      } finally {
        probe.remove();
      }
    };

    const apply = () => {
      const available = row.clientWidth;
      if (available <= 0) return;
      const need = Math.ceil(fullWidth());
      if (need <= 0) return;
      const slack = compact ? COMPACT_HYSTERESIS : 0;
      compact = need > available + 1 - slack;
      if (compact) row.dataset.compact = "true";
      else delete row.dataset.compact;
    };

    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(apply);
    };

    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    resizeObserver?.observe(row);

    // Toggling a tool, switching model or effort changes the labels or a
    // chip's classes. The compact flip itself only touches the row's own
    // attributes.
    const mutationObserver =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver((records) => {
            if (records.every((record) => record.target === row)) return;
            measure();
          });
    mutationObserver?.observe(row, {
      childList: true,
      characterData: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });

    // Labels measured before a web font loads are too narrow.
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    fonts?.addEventListener?.("loadingdone", measure);
    void fonts?.ready?.then(measure);

    measure();
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      fonts?.removeEventListener?.("loadingdone", measure);
      delete row.dataset.compact;
    };
  }, [ref]);
}
