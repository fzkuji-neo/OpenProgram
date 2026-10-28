"use client";

/**
 * The canvas's key sheet (dag/rendering.md §13): every key the graph
 * answers to, in one panel beside the tool rail, the way a game lists
 * its controls. ``?`` or the rail's keyboard button opens it; Esc, ``?``
 * again or a press outside closes it. The frame and the key tags are the
 * app's menu parts, so it reads as one of its menus.
 */

import { useEffect, useRef, useSyncExternalStore } from "react";

import { useTranslation } from "@/lib/i18n";
import { GROUP_LABEL, MENU_PANEL, MENU_TRAILING } from "@/components/chat/top-bar/menu-styles";
import { MenuKey, type MenuKeys } from "@/components/ui/menu-parts";
import { keySheetOpen, setKeySheet, subscribeKeySheet } from "@/lib/runtime-bridge/dag/interaction/help";

type Row = [en: string, zh: string, keys: MenuKeys[]];

const GROUPS: [en: string, zh: string, rows: Row[]][] = [
  ["Tools", "工具", [
    ["Browse", "浏览", [{ key: "H" }]],
    ["Select", "选择", [{ key: "V" }]],
    ["Lasso", "套索", [{ key: "L" }]],
    ["Pan under any tool", "任意工具下平移", [{ key: "Space" }]],
  ]],
  ["Camera", "镜头", [
    ["Find the working agent", "找到正在工作的 agent", [{ key: "F" }]],
    ["Show the whole graph", "显示整张图", [{ key: "1", shift: true }]],
    ["Back to 100%", "回到 100%", [{ key: "0", shift: true }]],
    ["Zoom in / out", "放大 / 缩小", [{ key: "+" }, { key: "−" }]],
  ]],
  ["Selection", "选择", [
    ["Delete", "删除", [{ key: "⌫" }]],
    ["Clear", "取消选择", [{ key: "Esc" }]],
    ["Undo the delete", "撤销删除", [{ key: "Z", mod: true }]],
  ]],
];

export function useKeySheetOpen(): boolean {
  return useSyncExternalStore(subscribeKeySheet, keySheetOpen, () => false);
}

export function DagKeySheet() {
  const { text } = useTranslation();
  const open = useKeySheetOpen();
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    // A press outside closes it; the rail's own button toggles it itself.
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element;
      if (ref.current?.contains(t) || t.closest?.("[data-key-sheet-toggle]")) return;
      setKeySheet(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);
  useEffect(() => () => setKeySheet(false), []);
  if (!open) return null;
  return (
    <div ref={ref} className={`dag-key-sheet ${MENU_PANEL}`} role="dialog"
      aria-label={text("Keyboard shortcuts", "快捷键")}>
      {GROUPS.map(([gEn, gZh, rows]) => (
        <div key={gEn} className="flex flex-col">
          <div className={GROUP_LABEL}>{text(gEn, gZh)}</div>
          {rows.map(([en, zh, keys]) => (
            <div key={en} className="flex min-h-7 items-center gap-1.5 px-1.5 py-1 text-sm">
              <span className="flex-1 whitespace-nowrap">{text(en, zh)}</span>
              <span className={MENU_TRAILING}>
                {keys.map((k) => <MenuKey key={k.key} keys={k} />)}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
