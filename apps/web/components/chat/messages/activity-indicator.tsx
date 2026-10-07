"use client";

import { useId } from "react";
import type { ActivityPhase } from "@/lib/chat/activity-phase";

export function ActivityIndicator({ phase }: { phase: ActivityPhase }) {
  const id = useId();
  // Calls already have a timeline and type icon; only model activity adds motion.
  if (phase === "tool") return null;
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
          <g className="activity-orbit activity-orbit-outer">
            <circle className="activity-arc activity-outer" cx="9" cy="9" r="6.9" pathLength="360" strokeWidth="1.25" strokeDasharray="165 195" />
            <circle className="activity-arc activity-outer activity-secondary" cx="9" cy="9" r="6.9" pathLength="360" strokeWidth="1.15" strokeDasharray="64 296" strokeDashoffset="-203" opacity="0.65" />
          </g>
          <g className="activity-orbit activity-orbit-inner">
            <circle className="activity-arc activity-inner" cx="9" cy="9" r={phase === "thinking" ? 2.85 : 3.45} pathLength="360" strokeWidth="1.15" strokeDasharray="125 235" strokeDashoffset="-20" />
            <circle className="activity-arc activity-inner activity-secondary" cx="9" cy="9" r={phase === "thinking" ? 2.85 : 3.45} pathLength="360" strokeWidth="1.05" strokeDasharray="78 282" strokeDashoffset="-200" opacity="0.8" />
          </g>
        </g>
      </svg>
    </span>
  );
}
