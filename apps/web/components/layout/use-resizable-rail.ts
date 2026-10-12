"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { beginRailMotion } from "@/lib/layout/rail-motion";

// Keep in sync with --rail-collapsed-w in app/styles/base.css.
const COLLAPSED_RAIL_WIDTH = 63;
const RAIL_MS = 150;
const RAIL_TRANSITION =
  "width 0.15s cubic-bezier(0.165, 0.84, 0.44, 1), min-width 0.15s cubic-bezier(0.165, 0.84, 0.44, 1)";

interface ResizableRailOptions {
  open: boolean;
  minWidth: number;
  maxWidth: number;
  defaultWidth: number;
  direction: 1 | -1;
}

export function useResizableRail({
  open,
  minWidth,
  maxWidth,
  defaultWidth,
  direction,
}: ResizableRailOptions) {
  const [width, setWidth] = useState(defaultWidth);
  // The width follows `open` once the web panes have swapped to pictures
  // (lib/layout/rail-motion). A change before the first paint (restoring
  // the saved state) applies at once.
  const [shownOpen, setShownOpen] = useState(open);
  const painted = useRef(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => { painted.current = true; });
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    if (!painted.current) { setShownOpen(open); return; }
    let current = true;
    void beginRailMotion(RAIL_MS).then(() => { if (current) setShownOpen(open); });
    return () => { current = false; };
  }, [open]);
  const [resizing, setResizing] = useState(false);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = { startX: event.clientX, startWidth: width };
      setResizing(true);
    },
    [width],
  );

  const finishResize = useCallback(() => {
    dragRef.current = null;
    setResizing(false);
  }, []);

  useEffect(() => {
    if (!resizing) return;
    window.addEventListener("pointerup", finishResize);
    window.addEventListener("pointercancel", finishResize);
    window.addEventListener("blur", finishResize);
    return () => {
      window.removeEventListener("pointerup", finishResize);
      window.removeEventListener("pointercancel", finishResize);
      window.removeEventListener("blur", finishResize);
    };
  }, [resizing, finishResize]);

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (event.buttons === 0) {
        finishResize();
        return;
      }
      const next = drag.startWidth + (event.clientX - drag.startX) * direction;
      setWidth(Math.max(minWidth, Math.min(maxWidth, next)));
    },
    [direction, maxWidth, minWidth, finishResize],
  );


  const style: CSSProperties = {
    width: shownOpen ? `${width}px` : `${COLLAPSED_RAIL_WIDTH}px`,
    minWidth: shownOpen ? `${minWidth}px` : `${COLLAPSED_RAIL_WIDTH}px`,
    transition: resizing ? "none" : RAIL_TRANSITION,
  };

  return {
    style,
    resizeHandleProps: {
      className: "rail-resize-handle",
      "data-edge": direction === 1 ? "right" : "left",
      "data-resizing": resizing,
      onPointerDown,
      onPointerMove,
      onPointerUp: finishResize,
      onPointerCancel: finishResize,
      onLostPointerCapture: finishResize,
    },
  };
}
