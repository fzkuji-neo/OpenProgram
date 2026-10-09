"use client";

/**
 * Solar icon — one component for the two-tone (Bold Duotone) Solar
 * glyphs the composer area uses. Bodies come from ./bodies.ts
 * (regenerate with scripts/icons/fetch-solar.mjs); the glyph is inline
 * SVG filled with currentColor, so it takes the surrounding text colour
 * like every other icon in the app.
 *
 * Exposes the same imperative ``AnimatedNavIconHandle`` (start / stop)
 * as the pqoqubbw line icons in ``@/components/animated-icons``, so the
 * existing hover plumbing keeps working unchanged: a parent button /
 * row / chip attaches a ref and drives the motion from its own hover
 * ("controlled"); without a ref the icon animates on its own hover.
 * The motion is deliberately small and uniform — a filled glyph doesn't
 * redraw itself the way a line icon can, so it just pops, lifts or
 * nudges, and `pulse` plays a one-shot pop-in for state changes.
 */

import { forwardRef, useCallback, useImperativeHandle, useRef, type HTMLAttributes, type MouseEvent } from "react";
import { motion, useAnimation, useReducedMotion, type Transition, type Variants } from "framer-motion";

import { cn } from "@/lib/utils";
import type { AnimatedNavIconHandle } from "@/components/animated-icons/_shared";
import { SOLAR_BODIES, type SolarIconName } from "./bodies";

export type SolarMotionPreset = "pop" | "lift" | "nudge" | "pulse" | "none";

const PRESETS: Record<Exclude<SolarMotionPreset, "none">, Variants> = {
  pop: { normal: { scale: 1 }, animate: { scale: 1.12 } },
  lift: { normal: { y: 0 }, animate: { y: -1.5 } },
  nudge: { normal: { x: 0 }, animate: { x: 1.5 } },
  pulse: { normal: { scale: 1 }, animate: { scale: [0.5, 1.15, 1] } },
};

const SPRING: Transition = { type: "spring", stiffness: 420, damping: 16, mass: 0.8 };
const PULSE: Transition = { duration: 0.32, ease: "easeOut" };

export interface SolarIconProps extends HTMLAttributes<HTMLSpanElement> {
  name: SolarIconName;
  size?: number;
  /** Hover micro-motion. Defaults to `pop`. */
  motionPreset?: SolarMotionPreset;
}

export const SolarIcon = forwardRef<AnimatedNavIconHandle, SolarIconProps>(function SolarIcon(
  { name, size = 16, motionPreset = "pop", className, onMouseEnter, onMouseLeave, ...props },
  ref,
) {
  const controls = useAnimation();
  const isControlledRef = useRef(false);
  const reduced = useReducedMotion();
  const animated = motionPreset !== "none" && !reduced;

  useImperativeHandle(ref, () => {
    isControlledRef.current = true;
    return {
      startAnimation: () => { if (animated) void controls.start("animate"); },
      stopAnimation: () => { if (animated) void controls.start("normal"); },
    };
  }, [animated, controls]);

  const handleMouseEnter = useCallback((e: MouseEvent<HTMLSpanElement>) => {
    if (isControlledRef.current) onMouseEnter?.(e);
    else if (animated) void controls.start("animate");
  }, [animated, controls, onMouseEnter]);
  const handleMouseLeave = useCallback((e: MouseEvent<HTMLSpanElement>) => {
    if (isControlledRef.current) onMouseLeave?.(e);
    else if (animated) void controls.start("normal");
  }, [animated, controls, onMouseLeave]);

  return (
    <span
      {...props}
      className={cn("inline-flex shrink-0", className)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <motion.svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
        xmlns="http://www.w3.org/2000/svg"
        style={{ display: "block", flexShrink: 0 }}
        initial="normal"
        animate={controls}
        variants={motionPreset === "none" ? undefined : PRESETS[motionPreset]}
        transition={motionPreset === "pulse" ? PULSE : SPRING}
        dangerouslySetInnerHTML={{ __html: SOLAR_BODIES[name] }}
      />
    </span>
  );
});
