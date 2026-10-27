/**
 * Renderer: white-fill visibility for nodes whose chat row is on-screen.
 *
 * Two modes:
 *   * ``viewport`` — scan ``#chatArea`` for visible bubbles and mark
 *     the matching DAG nodes with a white fill. No propagation —
 *     only direct bubble hits get the fill.
 *   * ``context``  — bypass chat-scroll entirely; the white-fill marks
 *     the node set the next LLM call will load as context (from
 *     ``/api/sessions/:id/context-range``).
 *
 * Also owns the ``scroll``/``mutation``/manual-wheel wiring that
 * triggers recomputation.
 */

import {
  _chatMutationObserver,
  _chatScrollWired,
  _contextSet,
  _highlightMode,
  _visibleIds,
  setChatMutationObserver,
  setChatScrollWired,
  setVisibleIds,
} from "../store/globals";

export function _applyVisibility(nodeEl: Element, visible: boolean): void {
  // Covered = part of what the next request carries (dag/rendering.md §8):
  // the tile fills with its tone; outside it, the tile is an outline.
  // The colours live in app/styles/dag/nodes.css.
  nodeEl.classList.toggle("is-covered", visible);
}

export function _setVisibleSet(newSet: Record<string, boolean>): void {
  const panel = document.getElementById("historyPanel");
  if (!panel) return;
  const body = panel.querySelector(".history-body") as HTMLElement | null;
  if (!body) return;
  body.querySelectorAll(".history-node").forEach((g) => {
    const id = g.getAttribute("data-msg-id") || "";
    const nowVisible = !!newSet[id];
    const wasVisible = !!_visibleIds[id];
    if (nowVisible !== wasVisible) _applyVisibility(g, nowVisible);
  });
  setVisibleIds(newSet);
  // No auto-scroll: the canvas is a camera the user drives, not a scroll
  // box (``../interaction/canvas.ts``). Yanking it to whatever the transcript last
  // highlighted would fight every pan.
}

export function _recomputeVisibility(): void {
  if (_highlightMode === "context") {
    const newSet: Record<string, boolean> = Object.create(null);
    if (_contextSet) {
      for (const id in _contextSet) newSet[id] = true;
    }
    _setVisibleSet(newSet);
    return;
  }
  const area = document.getElementById("chatArea");
  if (!area) return;
  const container = document.getElementById("chatMessages");
  if (!container) return;
  const rect = area.getBoundingClientRect();
  // The transcript is hidden (the pane is on the DAG perspective, see
  // components/chat/dag-view.tsx), so every bubble measures 0×0. That is
  // "no information", not "nothing is visible" — recomputing here would
  // blank the white fill on every node. Keep the last known set.
  if (rect.width === 0 && rect.height === 0) return;
  const bubbles = container.querySelectorAll("[data-msg-id], [data-msg-ids]");
  const newSet: Record<string, boolean> = Object.create(null);
  for (let i = 0; i < bubbles.length; i++) {
    const br = bubbles[i].getBoundingClientRect();
    if (br.bottom <= rect.top || br.top >= rect.bottom) continue;
    const multi = bubbles[i].getAttribute("data-msg-ids");
    if (multi) {
      const parts = multi.split(/\s+/);
      for (let j = 0; j < parts.length; j++) {
        if (parts[j]) newSet[parts[j]] = true;
      }
    } else {
      const single = bubbles[i].getAttribute("data-msg-id");
      if (single) newSet[single] = true;
    }
  }
  _setVisibleSet(newSet);
}

export function _wireChatScrollSync(): void {
  if (_chatScrollWired) return;
  const area = document.getElementById("chatArea");
  if (!area) return;
  setChatScrollWired(true);
  let raf = 0;
  area.addEventListener(
    "scroll",
    () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        _recomputeVisibility();
      });
    },
    { passive: true },
  );
}

export function _wireChatMutationSync(): void {
  if (typeof MutationObserver === "undefined") return;
  const container = document.getElementById("chatMessages");
  if (!container) return;
  // Disconnect previous observer if any (container may have been
  // replaced by load_session).
  if (_chatMutationObserver) {
    _chatMutationObserver.disconnect();
  }
  let raf = 0;
  const mo = new MutationObserver(() => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      _recomputeVisibility();
    });
  });
  mo.observe(container, { childList: true, subtree: true });
  setChatMutationObserver(mo);
}
