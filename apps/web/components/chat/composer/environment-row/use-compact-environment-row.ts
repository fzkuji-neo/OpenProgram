"use client";

import { useLayoutEffect, type RefObject } from "react";

const COMPACT_HYSTERESIS = 12;
/** 0 full · 1 long labels capped, Local icon-only · 2 git branch names hidden
 *  · 3 every label hidden and the diff badge reduced to a dot (compact). */
const MAX_LEVEL = 3;

/**
 * Squeeze the environment row one level at a time instead of switching
 * between "all labels" and "all icons".
 *
 * On every resize or content change the row is laid out at each level
 * with transitions off (`data-measuring`), synchronously, and the first
 * level whose chips fit (measured as the last chip's right edge, with
 * the right-aligned chips' auto margins zeroed) is kept; then transitions are restored and the
 * row animates from its previous level to the chosen one. Moving to a
 * roomier level needs COMPACT_HYSTERESIS px of slack so the row doesn't
 * flap at the boundary. Level 3 also sets `data-compact="true"`, the
 * historical icon-only state other styles key off.
 */
export function useCompactEnvironmentRow(ref: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const row = ref.current;
    if (!row) return;

    let frame = 0;
    let level = 0;

    const apply = (next: number) => {
      if (next > 0) row.dataset.squeeze = String(next);
      else delete row.dataset.squeeze;
      if (next >= MAX_LEVEL) row.dataset.compact = "true";
      else delete row.dataset.compact;
    };

    // Width the chips actually need. scrollWidth can't tell: the right-
    // aligned web chip's auto margin makes the content fill the row
    // exactly, so a squeezed row never looked roomy enough to expand.
    // While measuring, CSS zeroes those auto margins and the need is the
    // right edge of the last laid-out chip.
    const needed = () => {
      const left = row.getBoundingClientRect().left - row.scrollLeft;
      let right = 0;
      for (const child of Array.from(row.children)) {
        // Hover tips render in place (unportaled), as a fixed-position
        // popper wrapper inside the row; a tip over the right-aligned web
        // chip reached past the row and squeezed it to icons. Only
        // in-flow chips count.
        const position = getComputedStyle(child).position;
        if (position === "fixed" || position === "absolute") continue;
        const box = child.getBoundingClientRect();
        if (box.width || box.height) right = Math.max(right, box.right - left);
      }
      // The row's right padding is shadow room, not room for chips.
      return right + parseFloat(getComputedStyle(row).paddingRight || "0");
    };

    const choose = (available: number) => {
      for (let candidate = 0; candidate < MAX_LEVEL; candidate += 1) {
        apply(candidate);
        const slack = candidate < level ? COMPACT_HYSTERESIS : 0;
        if (Math.ceil(needed()) <= available + 1 - slack) return candidate;
      }
      return MAX_LEVEL;
    };

    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const available = row.clientWidth;
        if (available <= 0) return;
        row.dataset.measuring = "true";
        const next = choose(available);
        apply(level);
        void row.offsetWidth; // settle the previous level before animating
        delete row.dataset.measuring;
        level = next;
        apply(level);
      });
    };

    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    resizeObserver?.observe(row);

    const mutationObserver =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver((records) => {
            const isInside = (node: Node, selector: string) =>
              node instanceof Element
                ? Boolean(node.closest(selector))
                : Boolean(node.parentElement?.closest(selector));
            if (
              records.every(
                (record) =>
                  isInside(record.target, ".dag-hud-zoom") ||
                  isInside(record.target, ".dag-legend"),
              )
            ) {
              return;
            }
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
      delete row.dataset.squeeze;
      delete row.dataset.measuring;
      delete row.dataset.compact;
    };
  }, [ref]);
}
