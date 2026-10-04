import { findCenterTabGroup, groupCenterTabs, normalizeCenterTabLayout } from "./center-tab-groups.ts";
import { replaceGroupTabId } from "./center-tabs-persistence.ts";
import type { CenterTabsState } from "./store/types.ts";

export interface FilePreviewTarget { projectId: string; path: string; readOnly?: boolean; }
export function filePreviewLayout(state: Pick<CenterTabsState, "tabs" | "groups" | "activeId">, sessionId: string, target: FilePreviewTarget, automatic = false) {
  const chat = state.tabs.find(tab => tab.kind === "session" && tab.sessionId === sessionId);
  if (!chat) return null;
  const group = findCenterTabGroup(state.groups, chat.id);
  const activeGroup = state.activeId ? findCenterTabGroup(state.groups, state.activeId) : undefined;
  if (automatic && state.activeId !== chat.id && (!activeGroup || !activeGroup.memberIds.includes(chat.id))) return null;
  const peers = group?.memberIds.filter(id => id !== chat.id).map(id => state.tabs.find(tab => tab.id === id)) ?? [];
  const ownedSplit = group?.id === `g:preview:${sessionId}` && peers.length === 1
    && peers[0]?.previewOwnerSessionId === sessionId;
  if (automatic && group && (!ownedSplit || peers.some(tab => tab?.dirty))) return null;
  const id = `f:preview:${sessionId}:${target.projectId}:${target.path}`;
  let tabs = state.tabs.some(tab => tab.id === id) ? state.tabs : [...state.tabs, {
    id, kind: "file" as const, title: target.path.replace(/\\/g, "/").split("/").pop() || target.path,
    ...target, fileSessionId: sessionId, previewOwnerSessionId: sessionId,
  }];
  const existingGroup = findCenterTabGroup(state.groups, id);
  // An explicit open can focus an existing/manual layout without replacing it.
  if ((group && !ownedSplit) || (existingGroup && existingGroup.id !== group?.id)) {
    if (automatic) return null;
    return { tabs, groups: state.groups, activeId: id };
  }
  const layout = { tabIds: tabs.map(tab => tab.id), groups: state.groups };
  const next = ownedSplit ? normalizeCenterTabLayout({ ...layout,
    groups: replaceGroupTabId(state.groups, peers[0]!.id, id),
  }) : groupCenterTabs(layout, id, chat.id, 1, `g:preview:${sessionId}`).layout;
  const byId = new Map(tabs.map(tab => [tab.id, tab]));
  tabs = next.tabIds.map(tabId => byId.get(tabId)!).filter(Boolean);
  return { tabs, groups: next.groups, activeId: chat.id };
}
