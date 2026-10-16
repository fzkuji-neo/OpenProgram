import { useCallback, useEffect, useRef, useState } from "react";
import type { HTMLAttributes } from "react";

type Slot = { id: string; top: number; bottom: number };
/** A header or chat row of the project lists, in document order. */
type Item = { key: string; group: string; row: boolean; top: number; bottom: number };
type Drag = {
  id: string; from: string; pointerId: number; element: HTMLElement;
  startX: number; startY: number; x: number; y: number; active: boolean;
  scroller: HTMLElement; scrollTop: number; slots: Slot[];
  items: Item[]; source: number; height: number;
};

/** A chat row picked up and carried onto another project group. */
export interface DraggingChat { id: string; dy: number }

/** Props a chat row spreads: `data-dragging` marks the row being carried. */
export type ChatRowProps = HTMLAttributes<HTMLDivElement> & { "data-dragging"?: true; "data-chat-row": string };

const rowKey = (id: string) => `r:${id}`;
const headerKey = (projectId: string) => `h:${projectId}`;

/**
 * Pointer-capture drag of a chat row onto a project group. The same
 * pattern as `useProjectDrag`: a press becomes a drag after 6px, the
 * row itself slides with the pointer (no separate label), the project
 * under the pointer is the drop target (never the chat's own), release
 * there calls `onMove`, and Escape, blur or a release elsewhere
 * cancels. A click after a drag is swallowed so the chat does not open.
 *
 * While the row is over another project the lists make room for it:
 * the rows and headers between its old place and the pointer shift by
 * one row, closing the gap it left and opening one where it would
 * land (`rowOffset` / `headerOffset`). The order inside a project is
 * by time, so the gap only shows the project it will join.
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
  const [offsets, setOffsets] = useState<Record<string, number>>({});

  // Pointer y in the lists' coordinates at the press (their own scroll
  // since then is added back), where the item bounds were measured.
  const listY = (drag: Drag) => drag.y + drag.scroller.scrollTop - drag.scrollTop;

  function targetAt(drag: Drag): string | null {
    const rect = drag.scroller.getBoundingClientRect();
    if (drag.x < rect.left || drag.x > rect.right || drag.y < rect.top || drag.y > rect.bottom) return null;
    const y = listY(drag);
    const slot = drag.slots.find(item => y >= item.top && y < item.bottom);
    return slot && slot.id !== drag.from ? slot.id : null;
  }
  /**
   * Where the row would land in `target`: the index of the item the gap
   * opens before. The gap is the one whose centre is nearest the carried
   * row's centre, so the row hovers over its gap rather than ahead of it:
   * above its old place a gap before an item sits where that item was,
   * below it the gap sits one row higher (the items between moved up).
   */
  function insertionAt(drag: Drag, target: string): number {
    const source = drag.items[drag.source];
    const centre = (source.top + source.bottom) / 2 + listY(drag) - drag.startY;
    let last = -1;
    for (let index = 0; index < drag.items.length; index++) {
      const item = drag.items[index];
      if (item.group !== target) continue;
      if (item.row && (index < drag.source ? item.bottom : item.top) > centre) return index;
      last = index;
    }
    return last + 1;
  }
  function offsetsFor(drag: Drag, target: string | null): Record<string, number> {
    const next: Record<string, number> = {};
    if (!target) return next;
    const insertion = insertionAt(drag, target);
    // Items between the row's old place and the gap move by one row.
    if (insertion > drag.source) {
      for (let index = drag.source + 1; index < insertion; index++) next[drag.items[index].key] = -drag.height;
    } else {
      for (let index = insertion; index < drag.source; index++) next[drag.items[index].key] = drag.height;
    }
    return next;
  }
  function update(drag: Drag) {
    // The row follows the pointer vertically, in its own scroller: the
    // scroll the drag itself caused moves it along with the list.
    setDraggingChat({ id: drag.id, dy: drag.y - drag.startY + drag.scroller.scrollTop - drag.scrollTop });
    const next = targetAt(drag);
    setDropProject(prev => (prev === next ? prev : next));
    const shifted = offsetsFor(drag, next);
    setOffsets(prev => {
      const keys = Object.keys(shifted);
      if (keys.length === Object.keys(prev).length && keys.every(key => prev[key] === shifted[key])) return prev;
      return shifted;
    });
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
    setOffsets({});
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

  /** How far (px) a chat row has moved aside for the carried one. */
  const rowOffset = (id: string) => offsets[rowKey(id)] || 0;
  /** How far (px) a project header has moved aside for the carried chat. */
  const headerOffset = (projectId: string) => offsets[headerKey(projectId)] || 0;

  /** Props for a chat row: `from` is the project group it sits in. */
  function rowProps(id: string, from: string): ChatRowProps {
    const carried = draggingChat?.id === id;
    const shift = rowOffset(id);
    return {
      style: carried
        ? { touchAction: "none", transform: `translateY(${draggingChat.dy}px)`, zIndex: 5 }
        : shift ? { touchAction: "none", transform: `translateY(${shift}px)` } : { touchAction: "none" },
      "data-dragging": carried || undefined,
      "data-chat-row": id,
      onDragStart: event => event.preventDefault(),
      onPointerDown: event => {
        if (!enabled || current.current || !event.isPrimary || event.button !== 0
          || (event.target as Element).closest("button, input")) return;
        suppressClick.current = null;
        const element = event.currentTarget;
        const sidebar = element.closest<HTMLElement>("#sidebar");
        const scroller = element.closest<HTMLElement>(".overflow-y-auto");
        if (!sidebar || !scroller) return;
        const slots: Slot[] = [];
        const items: Item[] = [];
        for (const group of Array.from(sidebar.querySelectorAll<HTMLElement>("[data-project-id]"))) {
          const projectId = group.dataset.projectId!;
          const bounds = group.getBoundingClientRect();
          slots.push({ id: projectId, top: bounds.top, bottom: bounds.top + bounds.height });
          for (const node of Array.from(group.querySelectorAll<HTMLElement>("[data-project-header], [data-chat-row]"))) {
            const rect = node.getBoundingClientRect();
            const row = node.dataset.chatRow !== undefined;
            items.push({ key: row ? rowKey(node.dataset.chatRow!) : headerKey(projectId), group: projectId, row,
              top: rect.top, bottom: rect.top + rect.height });
          }
        }
        const source = items.findIndex(item => item.key === rowKey(id));
        if (source < 0) return;
        const after = items[source + 1];
        const height = after && after.group === from ? after.top - items[source].top : items[source].bottom - items[source].top + 1;
        current.current = { id, from, element, pointerId: event.pointerId, scroller, scrollTop: scroller.scrollTop, slots,
          items, source, height, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, active: false };
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
  return { draggingChat, dropProject, rowProps, rowOffset, headerOffset };
}
