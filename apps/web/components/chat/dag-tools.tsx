"use client";

/**
 * The DAG canvas's rail and selection action bar
 * (dag/rendering.md §13).
 *
 * The rail runs down the canvas's left edge as one raised strip, the
 * app's button material. There are no tools to switch: one mouse pans,
 * clicks and (with Shift/⌘) selects, so the rail holds the camera —
 * find the working agent, show the whole graph — and, under a hairline,
 * the keyboard button that opens the key sheet (dag-key-sheet.tsx).
 * The action bar appears at the top left while something is selected,
 * and for a few seconds after a delete, as the way back. The top right
 * belongs to the pane's perspective controls.
 */

import { useSyncExternalStore } from "react";
import {
  Copy,
  Keyboard,
  LocateFixed,
  Maximize2,
  Trash2,
  Undo2,
  X,
  type LucideIcon,
} from "lucide-react";

import { useTranslation } from "@/lib/i18n";
import {
  clearSelection,
  selectedIds,
  selectionVersion,
  subscribeSelection,
} from "@/lib/runtime-bridge/dag/interaction/selection";
import {
  deleteSelection,
  deletionPending,
  lastDeletion,
  undoDeletion,
} from "@/lib/runtime-bridge/dag/interaction/node-delete";
import { fitCanvas, focusAgent } from "@/lib/runtime-bridge/dag/interaction/canvas";
import { keySheetOpen, setKeySheet } from "@/lib/runtime-bridge/dag/interaction/help";
import { DagKeySheet, useKeySheetOpen } from "./dag-key-sheet";

function useSelectionVersion(): number {
  return useSyncExternalStore(subscribeSelection, selectionVersion, selectionVersion);
}

function DagToolRail() {
  const { text } = useTranslation();
  const sheetOpen = useKeySheetOpen();
  return (
    <div className="dag-tool-rail" role="toolbar" aria-orientation="vertical"
      aria-label={text("Canvas", "画布")}>
      <button
        type="button"
        className="dag-tool-btn"
        aria-label={text("Find the working agent", "找到正在工作的 agent")}
        aria-keyshortcuts="F"
        data-tip={text("Find the agent · F\nAgain for the next one", "找到 agent · F\n再按换下一个")}
        data-tip-side="right"
        onClick={() => focusAgent()}
      >
        <LocateFixed size={16} strokeWidth={2} />
      </button>
      {/* The rail always shows, while the HUD's Fit can be tucked behind
          the composer: the camera keeps one way to see everything. */}
      <button
        type="button"
        className="dag-tool-btn"
        aria-label={text("Show the whole graph", "显示整张图")}
        aria-keyshortcuts="Shift+1"
        data-tip={text("Show the whole graph · ⇧1", "显示整张图 · ⇧1")}
        data-tip-side="right"
        onClick={() => fitCanvas()}
      >
        <Maximize2 size={16} strokeWidth={2} />
      </button>
      <span className="dag-tool-sep" aria-hidden="true" />
      <button
        type="button"
        className="dag-tool-btn"
        data-key-sheet-toggle=""
        aria-pressed={sheetOpen}
        aria-label={text("Keyboard shortcuts", "快捷键")}
        aria-keyshortcuts="?"
        data-tip={sheetOpen ? undefined : text("Keyboard shortcuts · ?", "快捷键 · ?")}
        data-tip-side="right"
        onClick={() => setKeySheet(!keySheetOpen())}
      >
        <Keyboard size={16} strokeWidth={2} />
      </button>
    </div>
  );
}

function DagSelectionBar() {
  const { text } = useTranslation();
  useSelectionVersion();
  const ids = selectedIds();
  const pending = deletionPending();
  const last = lastDeletion();
  if (!ids.length && !last) return null;
  if (!ids.length && last) {
    return (
      <div className="dag-select-bar" role="status">
        <span className="dag-select-count">
          {text(`Deleted ${last.count} node${last.count === 1 ? "" : "s"}`,
            `已删除 ${last.count} 个节点`)}
        </span>
        <span className="dag-select-sep" aria-hidden="true" />
        <button type="button" className="dag-select-act" disabled={pending}
          onClick={() => undoDeletion()} data-tip={text("Undo (⌘Z)", "撤销 (⌘Z)")}>
          <Undo2 size={14} strokeWidth={2} />
          <span>{text("Undo", "撤销")}</span>
        </button>
      </div>
    );
  }
  return (
    <div className="dag-select-bar" role="toolbar"
      aria-label={text("Selection", "选择")}>
      <span className="dag-select-count">
        {text(`${ids.length} selected`, `已选 ${ids.length}`)}
      </span>
      <span className="dag-select-sep" aria-hidden="true" />
      <button type="button" className="dag-select-act"
        data-tip={text("Copy node IDs", "复制节点 ID")}
        onClick={() => { void navigator.clipboard?.writeText(ids.join("\n")); }}>
        <Copy size={14} strokeWidth={2} />
        <span>{text("Copy ID", "复制 ID")}</span>
      </button>
      <button type="button" className="dag-select-act dag-select-danger"
        disabled={pending}
        data-tip={text("Delete (⌫) — what follows joins the node before", "删除 (⌫)，后续接到前一个节点")}
        onClick={() => deleteSelection()}>
        <Trash2 size={14} strokeWidth={2} />
        <span>{text("Delete", "删除")}</span>
      </button>
      <button type="button" className="dag-select-act dag-select-icon"
        aria-label={text("Clear selection", "取消选择")}
        data-tip={text("Clear selection (Esc)", "取消选择 (Esc)")}
        onClick={() => clearSelection()}>
        <X size={14} strokeWidth={2} />
      </button>
    </div>
  );
}

/** Both overlays, absolutely placed over the canvas host. */
export function DagCanvasTools() {
  return (
    <>
      <DagToolRail />
      <DagKeySheet />
      <DagSelectionBar />
    </>
  );
}
