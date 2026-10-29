"use client";

/**
 * Tucking the composer's rows away: a click on the input box's edge (a
 * band RIM_IN px inside it and RIM_OUT px outside it, clear of the text
 * and controls) gives the box a small bounce and slides the environment
 * row above it and the controls row below it behind the box, which stays
 * where it is; the next such click brings them back. The choice is
 * remembered per browser. The handlers sit on the composer's input area,
 * so the part of the band outside the box (the gap toward the rows and
 * the column's side padding) still reaches them. A click in the box's
 * inner padding (above or below the text, beside the mic and send)
 * focuses the text instead. Only the band shows the hand cursor
 * (data-tuck-rim on the area, composer.module.css).
 */
import { useCallback, useState, type PointerEvent, type RefObject } from "react";
import { animate, useReducedMotion } from "framer-motion";

const KEY = "openprogram.composer.tucked";

function stored(): boolean {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}

/** Anything in the box that is its own target: text, controls, attachments. */
const OWN_TARGET = "[data-composer-text], button, a, input, textarea, [contenteditable], [role='button'], [data-attachment-strip] *";

/** How far in from the box's edge, and out past it, a click still tucks. */
const RIM_IN = 6;
const RIM_OUT = 6;

type Spot = "band" | "inner" | null;

/** Where the pointer is: on the edge band, in the box's own padding, or
 *  elsewhere (outside the band, or over something with its own job). */
function spotOf(event: PointerEvent<HTMLElement>, box: HTMLElement | null): Spot {
  if (!box) return null;
  const target = event.target as HTMLElement;
  if (target.closest(OWN_TARGET)) return null;
  const r = box.getBoundingClientRect();
  const x = event.clientX - r.left, y = event.clientY - r.top;
  const inside = Math.min(x, y, r.width - x, r.height - y);
  if (inside >= 0) {
    if (!box.contains(target)) return null;
    return inside <= RIM_IN ? "band" : "inner";
  }
  // Outside the box only the empty layout around it counts (the area,
  // the box's stack, a row's wrapper), never a queued message or a chip.
  const empty = target === event.currentTarget || target.matches("[data-composer-session], [data-tuck-row]");
  return empty && -inside <= RIM_OUT ? "band" : null;
}

export function useTuckedControls(boxRef: RefObject<HTMLElement | null>, enabled: boolean) {
  const [tucked, setTucked] = useState(stored);
  // The box covers the rows while they are tucked or still sliding out;
  // settled and out, the rows' own popovers go back on top of the box.
  const [covering, setCovering] = useState(tucked);
  const reduced = useReducedMotion();

  const onAreaPointerDown = useCallback((event: PointerEvent<HTMLElement>) => {
    if (!enabled || event.button !== 0) return;
    const box = boxRef.current;
    const spot = spotOf(event, box);
    if (!spot || !box) return;
    if (spot === "inner") {
      // Inner padding: act like part of the text field.
      const field = box.querySelector<HTMLElement>("[data-composer-text] textarea, [data-composer-text] [contenteditable]");
      if (field) { event.preventDefault(); field.focus(); }
      return;
    }
    setCovering(true);
    setTucked(previous => {
      const next = !previous;
      try { localStorage.setItem(KEY, next ? "1" : "0"); } catch { /* the choice lasts this page only */ }
      return next;
    });
    if (!reduced) {
      animate(box, { scale: [1, 0.985, 1.006, 1] }, { duration: 0.42, times: [0, 0.3, 0.68, 1], ease: "easeOut" });
    }
  }, [boxRef, enabled, reduced]);

  const onAreaPointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
    const area = event.currentTarget;
    const band = enabled && spotOf(event, boxRef.current) === "band";
    if (band !== area.hasAttribute("data-tuck-rim")) area.toggleAttribute("data-tuck-rim", band);
  }, [boxRef, enabled]);

  const onAreaPointerLeave = useCallback((event: PointerEvent<HTMLElement>) => {
    event.currentTarget.removeAttribute("data-tuck-rim");
  }, []);

  const onSettled = useCallback(() => setCovering(tucked), [tucked]);

  return { tucked: enabled && tucked, covering: enabled && covering, enabled, onAreaPointerDown, onAreaPointerMove, onAreaPointerLeave, onSettled };
}
