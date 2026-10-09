"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

export function EffortLabel({ label, index, accent }: { label: string; index: number; accent: boolean }) {
  const reduce = useReducedMotion();
  const [previous, setPrevious] = useState({ index, direction: 1 });
  let direction = previous.direction;
  if (previous.index !== index) {
    direction = index > previous.index ? 1 : -1;
    setPrevious({ index, direction });
  }
  return <span className="effort-level" data-accent={accent ? "true" : undefined}>
    <AnimatePresence initial={false} mode="popLayout" custom={direction}>
      <motion.span key={label} custom={direction}
        initial={reduce ? false : "enter"} animate="center" exit="exit"
        variants={{ enter: (d: number) => ({ y: `${d * .55}em`, opacity: 0, filter: "blur(2px)" }), center: { y: 0, opacity: 1, filter: "blur(0px)" }, exit: (d: number) => ({ y: `${-d * .55}em`, opacity: 0, filter: "blur(2px)" }) }}
        transition={{ duration: reduce ? 0 : .2, ease: "easeOut" }}>{label}</motion.span>
    </AnimatePresence>
  </span>;
}
