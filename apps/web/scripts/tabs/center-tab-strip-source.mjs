import { readFileSync } from "node:fs";

/**
 * The center tab strip is split across one component file and its
 * submodules (drag engine, context menu, lifecycle, drop actions, tab
 * rendering). The strip assertions in the check scripts read the strip as
 * ONE source text, so concatenate the parts in the order the original
 * single file had them: strip shell → drag subject helpers → pointer drag
 * engine → drop actions → menu state/actions → menu panel → lifecycle →
 * tab items. Slice sentinels used by the assertions (onPrepareDrag,
 * onPointerDragMove, onPointerDragUp, targetBeforeId, applyDrop,
 * onTabListKeyDown, onTabListWheel, moveMenuTab,
 * onTabClick, onOpenNewTab, finishClose, labelOf, CompoundTabItem,
 * TabItem) keep their relative order under this concatenation.
 */
const STRIP_PARTS = [
  "strip/center-tab-strip.tsx",
  "tab-actions/tab-drag-subject.ts",
  "tab-actions/use-tab-pointer-drag.ts",
  "tab-actions/use-tab-drop-actions.ts",
  "tab-actions/use-tab-menu.ts",
  "tab-actions/tab-context-menu.tsx",
  "tab-actions/use-tab-lifecycle.ts",
  "strip/tab-items.tsx",
];

export function readCenterTabStripSource() {
  return STRIP_PARTS.map((name) =>
    readFileSync(
      new URL(`../../components/center-tabs/${name}`, import.meta.url),
      "utf8",
    ).replaceAll("\r\n", "\n"),
  ).join("\n");
}
