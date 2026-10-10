"use client";

import { useLayoutEffect, type RefObject } from "react";

const COMPACT_HYSTERESIS = 12;

/**
 * Collapse the bottom control row's labels (permission, chat model,
 * exec model, effort) to their role icons when the controls do not fit.
 *
 * The row's need depends on which tool toggles are on and how long the
 * model names are, so no fixed container width is right. On every resize
 * or content change the row is laid out at full size with flex shrinking
 * off (`data-measuring`), synchronously; the sum of its clusters plus the
 * gap is compared with the row's own width. Expanding again needs
 * COMPACT_HYSTERESIS px of slack so the row doesn't flap at the boundary.
 * The result is `data-compact="true"` on the row.
 */
export function useCompactControlsRow(ref: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const row = ref.current;
    if (!row) return;

    let frame = 0;
    let compact = false;

    const needed = () => {
      const style = getComputedStyle(row);
      const gap = parseFloat(style.columnGap || "0") || 0;
      let total = 0;
      let count = 0;
      for (const child of Array.from(row.children)) {
        // Hover tips and floating cards (the expanded effort card) are
        // out of flow; only laid-out clusters take room.
        const position = getComputedStyle(child).position;
        if (position === "fixed" || position === "absolute") continue;
        const width = child.getBoundingClientRect().width;
        if (!width) continue;
        total += width;
        count += 1;
      }
      return total + gap * Math.max(0, count - 1);
    };

    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const available = row.clientWidth;
        if (available <= 0) return;
        delete row.dataset.compact;
        row.dataset.measuring = "true";
        const need = Math.ceil(needed());
        delete row.dataset.measuring;
        const slack = compact ? COMPACT_HYSTERESIS : 0;
        compact = need > available + 1 - slack;
        if (compact) row.dataset.compact = "true";
      });
    };

    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    resizeObserver?.observe(row);

    // Toggling a tool, switching model or effort changes the labels.
    // The compact flip itself only touches the row's own attributes.
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
    });

    measure();
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      delete row.dataset.measuring;
      delete row.dataset.compact;
    };
  }, [ref]);
}
