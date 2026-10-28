/**
 * Canvas keyboard (dag/rendering.md §13): the tool keys, Delete,
 * Esc and ⌘Z. Active only while the graph is on screen and the keyboard
 * is not in a text field — typing "v" in the composer is a "v".
 *
 *   H / V / L        switch tool (hand, select, lasso — any registered
 *                    tool's ``key``)
 *   F                camera to the next working agent (else HEAD)
 *   Shift+1 / Shift+0  fit the graph / zoom back to 100%
 *   + / −            zoom in / out one step
 *   Delete / ⌫       delete the selection
 *   Esc              clear the selection
 *   ⌘Z / Ctrl+Z      undo the last delete in this session
 *   Space (held)     pan with a drag under any tool
 */

import {
  activeTool,
  clearSelection,
  dagTools,
  dagVisible,
  isEditableFocus,
  selectedIds,
  setSpaceHeld,
  setTool,
} from "./selection";
import { fitCanvas, focusAgent, resetZoom, zoomStep } from "./canvas";
import { canUndoDeletion, deleteSelection, undoDeletion } from "./node-delete";

function onKeyDown(e: KeyboardEvent): void {
  if (e.defaultPrevented || isEditableFocus() || !dagVisible()) return;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "z") {
    if (!canUndoDeletion()) return;
    e.preventDefault();
    undoDeletion();
    return;
  }
  if (mod || e.altKey) return;
  if (e.key === "Delete" || e.key === "Backspace") {
    if (!selectedIds().length) return;
    e.preventDefault();
    deleteSelection();
    return;
  }
  if (e.key === "Escape") {
    if (!selectedIds().length) return;
    e.preventDefault();
    clearSelection();
    return;
  }
  if (e.key === " ") {
    // A focused button would also "click" on Space — the canvas owns it.
    e.preventDefault();
    if (!e.repeat) setSpaceHeld(true);
    return;
  }
  // View keys, as design tools have them. By physical key, so Shift+1
  // is Shift+1 on every layout ("!" on US, something else elsewhere).
  const view = e.shiftKey && e.code === "Digit1" ? fitCanvas
    : e.shiftKey && e.code === "Digit0" ? resetZoom
    : e.key === "+" || e.key === "=" ? () => zoomStep(1)
    : e.key === "-" || e.key === "_" ? () => zoomStep(-1)
    : null;
  if (view) {
    e.preventDefault();
    view();
    return;
  }
  if (e.shiftKey || e.repeat) return;
  if (e.key.toLowerCase() === "f") {
    e.preventDefault();
    focusAgent();
    return;
  }
  const tool = dagTools().find((t) => t.key === e.key.toLowerCase());
  if (tool && tool.id !== activeTool().id) {
    e.preventDefault();
    setTool(tool.id);
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", (e) => {
    if (e.key === " ") setSpaceHeld(false);
  });
  window.addEventListener("blur", () => setSpaceHeld(false));
}
