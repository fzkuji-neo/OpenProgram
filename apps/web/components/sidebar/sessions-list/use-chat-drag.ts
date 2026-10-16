import { useCallback, useEffect, useRef, useState } from "react";
import type { HTMLAttributes } from "react";

type Slot = { id: string; top: number; bottom: number };
type Drag = {
  id: string; label: string; from: string; pointerId: number; element: HTMLElement;
  startX: number; startY: number; x: number; y: number; active: boolean;
  scroller: HTMLElement; scrollTop: number; slots: Slot[];
};

/** A chat row picked up and carried onto another project group. */
export interface DraggingChat { id: string; label: string; x: number; y: number }

/**
 * Pointer-capture drag of a chat row onto a project group. The same
 * pattern as `useProjectDrag`: a press becomes a drag after 6px, the
 * project under the pointer is the drop target (never the chat's own),
 * release there calls `onMove`, and Escape, blur or a release elsewhere
 * cancels. A click after a drag is swallowed so the chat does not open.
 */
export function useChatDrag(
  enabled: boolean,
  onMove: (sessionId: string, projectId: string) => void,
) {
  const current = useRef<Drag | null>(null);
  const suppressClick = useRef<string | null>(null);
  const frame = useRef<number | null>(null);
  const [draggingChat, setDraggingChat] = useState<DraggingChat | null>(null);
  const [dropProject, setDropProject] = useState<string | null>(null);

  function targetAt(drag: Drag): string | null {
    const rect = drag.scroller.getBoundingClientRect();
    if (drag.x < rect.left || drag.x > rect.right || drag.y < rect.top || drag.y > rect.bottom) return null;
    // The groups' original layout: nothing moves aside during this drag.
    const y = drag.y + drag.scroller.scrollTop - drag.scrollTop;
    const slot = drag.slots.find(item => y >= item.top && y < item.bottom);
    return slot && slot.id !== drag.from ? slot.id : null;
  }
  function update(drag: Drag) {
    setDraggingChat({ id: drag.id, label: drag.label, x: drag.x, y: drag.y });
    const next = targetAt(drag);
    setDropProject(prev => (prev === next ? prev : next));
  }
  const finish = useCallback(() => {
    const drag = current.current;
    current.current = null;
    if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    frame.current = null;
    if (drag) {
      if (drag.active) suppressClick.current = drag.id;
      if (drag.element.hasPointerCapture(drag.pointerId)) drag.element.releasePointerCapture(drag.pointerId);
    }
    setDraggingChat(null);
    setDropProject(null);
  }, []);

  useEffect(() => {
    if (!enabled) { finish(); return; }
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") finish(); };
    window.addEventListener("keydown", escape);
    window.addEventListener("blur", finish);
    return () => {
      window.removeEventListener("keydown", escape);
      window.removeEventListener("blur", finish);
      finish();
    };
  }, [enabled, finish]);

  function autoScroll() {
    const drag = current.current;
    if (!drag?.active) return;
    const rect = drag.scroller.getBoundingClientRect();
    if (drag.x >= rect.left && drag.x <= rect.right) {
      const delta = drag.y < rect.top + 28 ? -8 : drag.y > rect.bottom - 28 ? 8 : 0;
      if (delta) {
        const previous = drag.scroller.scrollTop;
        drag.scroller.scrollTop += delta;
        if (drag.scroller.scrollTop !== previous) update(drag);
      }
    }
    frame.current = window.requestAnimationFrame(autoScroll);
  }

  /** Props for a chat row: `from` is the project group it sits in. */
  function rowProps(id: string, label: string, from: string): HTMLAttributes<HTMLDivElement> {
    return {
      style: { touchAction: "none" },
      onDragStart: event => event.preventDefault(),
      onPointerDown: event => {
        if (!enabled || current.current || !event.isPrimary || event.button !== 0
          || (event.target as Element).closest("button, input")) return;
        suppressClick.current = null;
        const element = event.currentTarget;
        const sidebar = element.closest<HTMLElement>("#sidebar");
        const scroller = element.closest<HTMLElement>(".overflow-y-auto");
        if (!sidebar || !scroller) return;
        const slots = Array.from(sidebar.querySelectorAll<HTMLElement>("[data-project-id]")).map(group => {
          const bounds = group.getBoundingClientRect();
          return { id: group.dataset.projectId!, top: bounds.top, bottom: bounds.top + bounds.height };
        });
        current.current = { id, label, from, element, pointerId: event.pointerId, scroller, scrollTop: scroller.scrollTop, slots,
          startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, active: false };
        element.setPointerCapture(event.pointerId);
      },
      onPointerMove: event => {
        const drag = current.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        drag.x = event.clientX; drag.y = event.clientY;
        if (!drag.active) {
          if (Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 6) return;
          drag.active = true;
          autoScroll();
        }
        event.preventDefault();
        update(drag);
      },
      onPointerUp: event => {
        const drag = current.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        drag.x = event.clientX; drag.y = event.clientY;
        const target = drag.active ? targetAt(drag) : null;
        finish();
        if (target) onMove(drag.id, target);
      },
      onPointerCancel: event => { if (current.current?.pointerId === event.pointerId) finish(); },
      onLostPointerCapture: event => { if (current.current?.pointerId === event.pointerId) finish(); },
      onClick: event => {
        if (suppressClick.current === id && event.detail !== 0) {
          suppressClick.current = null;
          event.preventDefault(); event.stopPropagation();
        }
      },
    };
  }
  return { draggingChat, dropProject, rowProps };
}
