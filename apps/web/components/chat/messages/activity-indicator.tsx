"use client";

import { useId } from "react";

/** Replaces only the existing empty-reply loading mark. */
export function ActivityIndicator() {
  const id = useId();
  return (
    <span className="activity-indicator activity-thinking" aria-hidden="true">
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
            <circle className="activity-arc activity-inner" cx="9" cy="9" r="2.85" pathLength="360" strokeWidth="1.15" strokeDasharray="125 235" strokeDashoffset="-20" />
            <circle className="activity-arc activity-inner activity-secondary" cx="9" cy="9" r="2.85" pathLength="360" strokeWidth="1.05" strokeDasharray="78 282" strokeDashoffset="-200" opacity="0.8" />
          </g>
        </g>
      </svg>
    </span>
  );
}
