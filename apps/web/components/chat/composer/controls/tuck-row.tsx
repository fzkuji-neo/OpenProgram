"use client";

/**
 * A row that tucks behind the input box (use-tucked-controls.ts): it
 * slides toward the box, fades and gives its height back; untucked it
 * slides out again. Tucked, it is inert so focus and clicks skip it.
 */
import type { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";

const SLIDE = 18;

export function TuckRow({ tucked, side, children }: { tucked: boolean; side: "above" | "below"; children: ReactNode }) {
  const reduced = useReducedMotion();
  const toward = side === "above" ? SLIDE : -SLIDE;
  return <motion.div
    // flow-root keeps the row's own margins inside, so they fold away with it.
    style={{ display: "flow-root" }}
    initial={false}
    animate={tucked
      ? { height: 0, y: toward, opacity: 0, scale: 0.97 }
      : { height: "auto", y: 0, opacity: 1, scale: 1 }}
    transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 32, opacity: { duration: 0.16 } }}
    inert={tucked}
    data-tucked={tucked ? "" : undefined}
  >
    {children}
  </motion.div>;
}
