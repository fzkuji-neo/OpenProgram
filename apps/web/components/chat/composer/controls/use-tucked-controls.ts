"use client";

/**
 * Tucking the composer's rows away: a click on the input box outside its
 * text (the padding, the gutters beside the mic and send) gives the box a
 * small bounce and slides the environment row above it and the controls
 * row below it behind the box, which stays where it is; the next such
 * click brings them back. The choice is remembered per browser.
 */
import { useCallback, useState, type PointerEvent, type RefObject } from "react";
import { animate, useReducedMotion } from "framer-motion";

const KEY = "openprogram.composer.tucked";

function stored(): boolean {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}

/** Anything in the box that is its own target: text, controls, attachments. */
const OWN_TARGET = "[data-composer-text], button, a, input, textarea, [contenteditable], [role='button'], [data-attachment-strip] *";

export function useTuckedControls(boxRef: RefObject<HTMLElement | null>, enabled: boolean) {
  const [tucked, setTucked] = useState(stored);
  // The box covers the rows while they are tucked or still sliding out;
  // settled and out, the rows' own popovers go back on top of the box.
  const [covering, setCovering] = useState(tucked);
  const reduced = useReducedMotion();

  const onBoxPointerDown = useCallback((event: PointerEvent<HTMLElement>) => {
    if (!enabled || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest(OWN_TARGET)) return;
    setCovering(true);
    setTucked(previous => {
      const next = !previous;
      try { localStorage.setItem(KEY, next ? "1" : "0"); } catch { /* the choice lasts this page only */ }
      return next;
    });
    const box = boxRef.current;
    if (box && !reduced) {
      animate(box, { scale: [1, 0.985, 1.006, 1] }, { duration: 0.42, times: [0, 0.3, 0.68, 1], ease: "easeOut" });
    }
  }, [boxRef, enabled, reduced]);

  const onSettled = useCallback(() => setCovering(tucked), [tucked]);

  return { tucked: enabled && tucked, covering: enabled && covering, enabled, onBoxPointerDown, onSettled };
}
