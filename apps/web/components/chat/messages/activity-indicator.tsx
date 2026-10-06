"use client";

import { useId, type CSSProperties } from "react";
import type { ActivityPhase } from "@/lib/chat/activity-phase";

/** Equal radial samples let CSS interpolate open circle/polygon contours. */
function contour(radius: number, sides: number, gapCenter: number): string {
  const points = Array.from({ length: 65 }, (_, i) => {
    const theta = (gapCenter + 25 + i * 310 / 64) * Math.PI / 180;
    const offset = sides === 4 ? Math.PI / 4 : 0;
    const sector = 2 * Math.PI / sides;
    const delta = ((theta - offset + 2 * Math.PI) % sector) - Math.PI / sides;
    const r = sides ? radius * Math.cos(Math.PI / sides) / Math.cos(delta) : radius;
    return [9 + r * Math.sin(theta), 9 - r * Math.cos(theta)];
  });
  return points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(3)} ${y.toFixed(3)}`).join(" ");
}

const outlines = [
  { radius: 7.05, gap: 90 },
  { radius: 3, gap: 270 },
].map(({ radius, gap }) => {
  const [circle, triangle, square] = [0, 3, 4].map((sides) => contour(radius, sides, gap));
  return {
    circle,
    style: {
      "--activity-circle": `path("${circle}")`,
      "--activity-triangle": `path("${triangle}")`,
      "--activity-square": `path("${square}")`,
    } as CSSProperties,
  };
});

export function ActivityIndicator({ phase }: { phase: ActivityPhase }) {
  const id = useId();
  return (
    <span className={`activity-indicator activity-${phase}`} data-activity-phase={phase} aria-hidden="true">
      <svg viewBox="0 0 18 18" width="18" height="18" fill="none" focusable="false">
        <defs>
          <linearGradient id={id} x1="1" y1="1" x2="17" y2="17" gradientUnits="userSpaceOnUse">
            <stop className="activity-color-start" />
            <stop className="activity-color-end" offset="1" />
          </linearGradient>
        </defs>
        <g stroke={`url(#${id})`} strokeLinecap="round" strokeLinejoin="round">
          {phase === "tool" ? (
            <g className="activity-tool-orbit">
              {outlines.map((outline, i) => (
                <path key={i} className={`activity-outline activity-${i ? "inner" : "outer"}`}
                  d={outline.circle} style={outline.style} strokeWidth={i ? 1 : 1.2} opacity={i ? 0.72 : 0.98} />
              ))}
            </g>
          ) : (
            <>
              <g className="activity-orbit activity-orbit-outer">
                <circle className="activity-arc activity-outer" cx="9" cy="9" r="6.9" pathLength="360" strokeWidth="1.25" strokeDasharray="165 195" />
                <circle className="activity-arc activity-outer activity-secondary" cx="9" cy="9" r="6.9" pathLength="360" strokeWidth="1.15" strokeDasharray="64 296" strokeDashoffset="-203" opacity="0.65" />
              </g>
              <g className="activity-orbit activity-orbit-inner">
                <circle className="activity-arc activity-inner" cx="9" cy="9" r={phase === "thinking" ? 2.85 : 3.45} pathLength="360" strokeWidth="1.15" strokeDasharray="125 235" strokeDashoffset="-20" />
                <circle className="activity-arc activity-inner activity-secondary" cx="9" cy="9" r={phase === "thinking" ? 2.85 : 3.45} pathLength="360" strokeWidth="1.05" strokeDasharray="78 282" strokeDashoffset="-200" opacity="0.8" />
              </g>
            </>
          )}
        </g>
      </svg>
    </span>
  );
}
