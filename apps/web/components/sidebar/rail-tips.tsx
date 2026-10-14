"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/** A collapsed rail shows icons only, so each one names itself on hover,
 *  as the Dock does: the row's own label (hidden while collapsed), or its
 *  aria-label. One tip for both rails, beside the rail and away from it.
 *  The first one waits so a pointer passing over never flashes tips;
 *  moving on along the rail swaps it at once. */
// The toggle has no label in either state, so it names itself open too.
const TARGET = ".sidebar.collapsed :is(.sidebar-nav-item, [data-rail-tip]), .sidebar .sidebar-toggle";
const DWELL_MS = 600, CARRY_MS = 400;

type Tip = { label: string; x: number; y: number; side: "left" | "right" };

function labelOf(el: HTMLElement): string {
  return (el.dataset.railTip
    || (el.classList.contains("sidebar-toggle") ? el.getAttribute("aria-label") : null)
    || el.querySelector<HTMLElement>(".sidebar-nav-label")?.textContent
    || el.getAttribute("aria-label")
    || "").trim();
}

export function RailTips() {
  const [tip, setTip] = useState<Tip | null>(null);
  useEffect(() => {
    let timer: number | undefined, current: HTMLElement | null = null, hiddenAt = 0, shown = false;
    const place = (el: HTMLElement) => {
      const label = labelOf(el);
      if (!label) return;
      const r = el.getBoundingClientRect();
      const right = !!el.closest(".right-sidebar");
      shown = true;
      setTip({ label, y: r.top + r.height / 2, x: right ? r.left - 10 : r.right + 10, side: right ? "left" : "right" });
    };
    const hide = () => {
      window.clearTimeout(timer);
      if (shown) hiddenAt = performance.now();
      shown = false;
      current = null;
      setTip(null);
    };
    const over = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.<HTMLElement>(TARGET) ?? null;
      if (el === current) return;
      const carry = shown || performance.now() - hiddenAt < CARRY_MS;
      hide();
      if (!el || e.pointerType === "touch") return;
      current = el;
      if (carry) place(el);
      else timer = window.setTimeout(() => { if (current === el && el.isConnected) place(el); }, DWELL_MS);
    };
    // A press acts on the control: its name is no longer needed.
    const press = () => { if (current) { window.clearTimeout(timer); shown = false; setTip(null); } };
    const leave = (e: PointerEvent) => { if (!e.relatedTarget) hide(); };
    document.addEventListener("pointerover", over);
    document.addEventListener("pointerdown", press, true);
    document.addEventListener("pointerout", leave);
    window.addEventListener("blur", hide);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerdown", press, true);
      document.removeEventListener("pointerout", leave);
      window.removeEventListener("blur", hide);
    };
  }, []);
  if (!tip) return null;
  return createPortal(
    <div
      role="tooltip"
      className="hover-tip rail-tip pointer-events-none fixed z-[100000] whitespace-nowrap rounded-[8px] px-[10px] py-[6px] text-[13px] shadow-[var(--shadow-popover)]"
      data-side={tip.side}
      style={{ top: tip.y, left: tip.x, transform: `translate(${tip.side === "left" ? "-100%" : "0"}, -50%)` }}
    >
      {tip.label}
    </div>,
    document.body,
  );
}
