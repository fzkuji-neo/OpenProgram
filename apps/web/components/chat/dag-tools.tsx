"use client";

/**
 * The DAG canvas's tool rail and selection action bar
 * (dag/rendering.md §13).
 *
 * The rail runs down the canvas's left edge, one button per registered
 * tool (lib/runtime-bridge/dag/interaction/selection.ts owns what each
 * tool DOES; this file only gives it a face). The action bar appears at
 * the top right, beside the perspective controls, while something is
 * selected — and for a few seconds after a delete, as the way back.
 */

import { useSyncExternalStore } from "react";
import {
  Copy,
  Hand,
  Lasso,
  MousePointer2,
  SquareDashed,
  Trash2,
  Undo2,
  X,
  type LucideIcon,
} from "lucide-react";

import { useTranslation } from "@/lib/i18n";
import {
  activeTool,
  clearSelection,
  dagTools,
  selectedIds,
  selectionVersion,
  setTool,
  subscribeSelection,
} from "@/lib/runtime-bridge/dag/interaction/selection";
import {
  deleteSelection,
  deletionPending,
  lastDeletion,
  undoDeletion,
} from "@/lib/runtime-bridge/dag/interaction/node-delete";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Each tool's face. A tool registered without one shows its id. */
const FACES: Record<string, { Icon: LucideIcon; en: string; zh: string }> = {
  hand: { Icon: Hand, en: "Browse", zh: "浏览" },
  pointer: { Icon: MousePointer2, en: "Select", zh: "点选" },
  marquee: { Icon: SquareDashed, en: "Box select", zh: "框选" },
  lasso: { Icon: Lasso, en: "Lasso select", zh: "套索" },
};

function useCanvasTools(): number {
  return useSyncExternalStore(subscribeSelection, selectionVersion, selectionVersion);
}

function DagToolRail() {
  const { text } = useTranslation();
  useCanvasTools();
  const current = activeTool().id;
  return (
    <div className="dag-tool-rail" role="toolbar" aria-orientation="vertical"
      aria-label={text("Canvas tools", "画布工具")}>
      {dagTools().map((tool) => {
        const face = FACES[tool.id];
        const label = face ? text(face.en, face.zh) : tool.id;
        const Icon = face?.Icon;
        return (
          <button
            key={tool.id}
            type="button"
            className="dag-tool-btn"
            aria-pressed={tool.id === current}
            aria-label={label}
            data-tip={`${label} (${tool.key.toUpperCase()})`}
            onClick={() => setTool(tool.id)}
          >
            {Icon ? <Icon size={16} strokeWidth={2} /> : tool.id.slice(0, 1)}
          </button>
        );
      })}
    </div>
  );
}

function DagSelectionBar() {
  const { text } = useTranslation();
  useCanvasTools();
  const ids = selectedIds();
  const pending = deletionPending();
  const last = lastDeletion();
  const chip = cn(buttonVariants({ variant: "elevated", size: "sm" }));
  if (!ids.length && !last) return null;
  if (!ids.length && last) {
    return (
      <div className={`dag-select-bar ${chip}`} role="status">
        <span className="dag-select-count">
          {text(`Deleted ${last.count} node${last.count === 1 ? "" : "s"}`,
            `已删除 ${last.count} 个节点`)}
        </span>
        <button type="button" className="dag-select-act" disabled={pending}
          onClick={() => undoDeletion()} data-tip={text("Undo (⌘Z)", "撤销 (⌘Z)")}>
          <Undo2 size={14} strokeWidth={2} />
          <span>{text("Undo", "撤销")}</span>
        </button>
      </div>
    );
  }
  return (
    <div className={`dag-select-bar ${chip}`} role="toolbar"
      aria-label={text("Selection", "选择")}>
      <span className="dag-select-count">
        {text(`${ids.length} selected`, `已选 ${ids.length}`)}
      </span>
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
      <DagSelectionBar />
    </>
  );
}
