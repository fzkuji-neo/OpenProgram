import type { StoreApi } from "zustand";
import type { CenterTabsState } from "./types";
import { commitCenterTabsState } from "./core";
import { findCenterTabGroup, ungroupCenterTab } from "../center-tab-groups";
import { leaves, rowLayout, insertPane, removePane, mapNode, sanitizeLayout, type CanvasLayout } from "../canvas-layout";

export function canvasActions(set: StoreApi<CenterTabsState>["setState"]): Pick<CenterTabsState, "setCanvas" | "dockCanvas"> {
  return {
    setCanvas: (targetId, canvas) => set(s => {
      const group = findCenterTabGroup(s.groups, targetId);
      canvas = sanitizeLayout(canvas, new Set(s.tabs.map(t => t.id)));
      const memberIds = leaves(canvas.root).flatMap(p => p.content ? [p.content] : []);
      let tabs = s.tabs;
      if (!memberIds.length) {
        const existing = s.tabs.find(t => t.canvasAnchor && t.id === targetId);
        const anchor = existing ?? { id: `canvas-empty:${crypto.randomUUID()}`, kind: "ntp" as const, title: "Layout", canvasAnchor: true };
        if (!existing) tabs = [...tabs, anchor];
        memberIds.push(anchor.id);
      }
      const focusedId = leaves(canvas.root).find(p => p.id === canvas.focusedPaneId)?.content ?? (memberIds.includes(targetId) ? targetId : memberIds[0]);
      const next = { id: group?.id ?? `g:${crypto.randomUUID()}`, memberIds, visibleIds: memberIds, focusedId, canvas };
      let groups = s.groups.filter(g => g.id !== group?.id);
      for (const id of memberIds) groups = ungroupCenterTab({ tabIds: tabs.map(t => t.id), groups }, id).groups;
      groups.push(next);
      tabs = tabs.filter(t => !t.canvasAnchor || groups.some(g => g.memberIds.includes(t.id)));
      return commitCenterTabsState(s, { tabs, groups, activeId: focusedId ?? s.activeId, splitWebTabId: null });
    }),
    dockCanvas: (source, targetId, paneId, side) => set(s => {
      const sourceIds = typeof source === "string" ? [source] : source;
      const sourceId = sourceIds[0];
      if (!sourceId || sourceIds.some(id => !s.tabs.some(t => t.id === id)) || !s.tabs.some(t => t.id === targetId)) return {};
      const targetGroup = findCenterTabGroup(s.groups, targetId);
      const sourceGroup = findCenterTabGroup(s.groups, sourceId);
      if (sourceIds.length > 1 && sourceGroup?.id === targetGroup?.id) return {};
      const original = targetGroup?.canvas ?? rowLayout([targetId]);
      const target = paneId === "root" ? "root" : leaves(original.root).find(p => p.id === paneId)?.id ?? leaves(original.root)[0].id;
      const sourcePane = leaves(original.root).find(p => p.content === sourceId);
      if (sourceIds.length === 1 && sourcePane?.id === target) return {};
      let root = original.root;
      for (const id of sourceIds) {
        const p = leaves(root).find(p => p.content === id);
        if (p) root = removePane(root, p.id);
      }
      const inserted = insertPane(root, target, side, sourceId);
      if (sourceIds.length > 1 && sourceGroup?.canvas) {
        inserted.root = mapNode(inserted.root, inserted.paneId, () => sourceGroup.canvas!.root);
        inserted.paneId = sourceGroup.canvas.focusedPaneId;
      }
      const canvas: CanvasLayout = { root: inserted.root, focusedPaneId: inserted.paneId };
      let detached = { tabIds: s.tabs.map(t => t.id), groups: s.groups };
      for (const id of sourceIds) detached = ungroupCenterTab(detached, id);
      const memberIds = leaves(canvas.root).flatMap(p => p.content ? [p.content] : []);
      const group = { id: targetGroup?.id ?? `g:${crypto.randomUUID()}`, memberIds, visibleIds: memberIds, focusedId: sourceId, canvas };
      const groups = [...detached.groups.filter(g => g.id !== group.id), group];
      const tabs = s.tabs.filter(t => !t.canvasAnchor || groups.some(g => g.memberIds.includes(t.id)));
      return commitCenterTabsState(s, { tabs, groups, activeId: sourceId, splitWebTabId: null });
    }),
  };
}
