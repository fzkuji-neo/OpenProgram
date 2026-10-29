"use client";

/**
 * The canvas's key sheet (dag/rendering.md §13): every key and mouse
 * gesture the graph answers to, in one panel left of the zoom column, the way a game lists
 * its controls. It is a guide, like the legend beside its button, and
 * behaves like it: ``?`` or the column's controls button opens it, and
 * only those (or opening the legend, which takes its spot) close it —
 * clicks on the canvas and Esc leave it be. The key tags are the app's
 * menu parts; the frame is the minimap's (dag/panels/tools.css).
 */

import { useEffect, useSyncExternalStore } from "react";

import { useTranslation } from "@/lib/i18n";
import { GROUP_LABEL, MENU_PANEL, MENU_TRAILING } from "@/components/chat/top-bar/menu-styles";
import { MenuKey, type MenuKeys } from "@/components/ui/menu-parts";
import { keySheetOpen, setKeySheet, subscribeKeySheet } from "@/lib/runtime-bridge/dag/interaction/selection/key-sheet";

type Row = [en: string, zh: string, keys: MenuKeys[]];

const GROUPS: [en: string, zh: string, rows: Row[]][] = [
  ["Mouse and trackpad", "鼠标与触控板", [
    ["Select", "选中", [{ key: "Click" }]],
    ["Select with a box", "框选", [{ key: "Drag" }]],
    ["Add to the selection", "加选 / 取消", [{ key: "Click", shift: true }]],
    ["Pan", "平移", [{ key: "Right-drag" }, { key: "Two-finger scroll" }]],
    ["Zoom", "缩放", [{ key: "Wheel" }, { key: "Pinch" }]],
  ]],
  ["Camera", "镜头", [
    ["Find the working agent", "找到正在工作的 agent", [{ key: "F" }]],
    ["Show the whole graph", "显示整张图", [{ key: "1", shift: true }]],
    ["Back to 100%", "回到 100%", [{ key: "0", shift: true }]],
    ["Zoom in / out", "放大 / 缩小", [{ key: "+" }, { key: "−" }]],
    ["Hide / show the minimap", "隐藏 / 显示小地图", [{ key: "M" }]],
    ["Leave full screen", "退出全屏", [{ key: "Esc" }]],
  ]],
  ["Selection", "选择", [
    ["Fit the selection", "缩放到所选", [{ key: "2", shift: true }]],
    ["Delete", "删除", [{ key: "⌫" }]],
    ["Clear", "取消选择", [{ key: "Esc" }]],
    ["Undo the delete", "撤销删除", [{ key: "Z", mod: true }]],
  ]],
];

/** Mouse gestures written in words, in the reader's language. */
const GESTURE: Record<string, string> = { Drag: "拖动", "Right-drag": "右键拖动", Wheel: "滚轮", Click: "单击",
  "Two-finger scroll": "双指滑动", Pinch: "捏合" };

export function useKeySheetOpen(): boolean {
  return useSyncExternalStore(subscribeKeySheet, keySheetOpen, () => false);
}

export function DagKeySheet() {
  const { text } = useTranslation();
  const open = useKeySheetOpen();
  useEffect(() => () => setKeySheet(false), []);
  if (!open) return null;
  return (
    <div className={`dag-key-sheet ${MENU_PANEL}`} role="dialog"
      aria-label={text("Keyboard shortcuts", "快捷键")}>
      {GROUPS.map(([gEn, gZh, rows]) => (
        <div key={gEn} className="flex flex-col">
          <div className={GROUP_LABEL}>{text(gEn, gZh)}</div>
          {rows.map(([en, zh, keys]) => (
            <div key={en} className="flex min-h-7 items-center gap-1.5 px-1.5 py-1 text-sm">
              <span className="flex-1 whitespace-nowrap">{text(en, zh)}</span>
              <span className={MENU_TRAILING}>
                {keys.map((k) => (
                  <MenuKey key={k.key} keys={{ ...k, key: GESTURE[k.key] ? text(k.key, GESTURE[k.key]) : k.key }} />
                ))}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
