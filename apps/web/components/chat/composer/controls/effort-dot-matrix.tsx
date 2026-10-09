"use client";

/**
 * EffortDotMatrix — the SVG dot field that is the effort slider's track.
 *
 * Geometry (pitch, rows, size and opacity ramps) comes from
 * `lib/effort-matrix.ts`; this component only turns the dots into
 * circles. Colours are CSS variables so each theme paints its own: dots
 * the thumb has passed use `currentColor` (effort-pill.css sets the svg's
 * colour to `--text-muted`), dots still ahead of it use `--accent-purple`.
 * The field is static — nothing animates on its own; the only motion is
 * the short fill crossfade in effort-pill.css, which prefers-reduced-motion
 * switches off.
 */

import React from "react";

import { layoutDotMatrix, TRACK_HEIGHT } from "@/lib/effort-matrix";

export function EffortDotMatrix({
  width,
  thumbX,
}: {
  /** Measured track width in px; 0 (not yet measured) draws nothing. */
  width: number;
  /** X of the thumb's centre, px from the track's left edge. */
  thumbX: number;
}) {
  const dots = React.useMemo(() => layoutDotMatrix(width, thumbX), [width, thumbX]);
  if (dots.length === 0) return null;
  return (
    <svg
      className="effort-matrix"
      width={width}
      height={TRACK_HEIGHT}
      viewBox={`0 0 ${width} ${TRACK_HEIGHT}`}
      aria-hidden="true"
      focusable="false"
    >
      {dots.map((dot, i) => (
        <circle
          key={i}
          cx={dot.cx}
          cy={dot.cy}
          r={dot.r}
          style={{
            fill: dot.ahead ? "var(--accent-purple)" : "currentColor",
            fillOpacity: dot.opacity,
          }}
        />
      ))}
    </svg>
  );
}
