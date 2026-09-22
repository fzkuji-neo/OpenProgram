import { useCenterTabs } from './center-tabs-store';
import { desktopBridge } from '../desktop/desktop-bridge';
import { jsonFetch } from '../net/fetch-client';
import { ingestBrowserResource, type BackendResource } from '../chat/session-resources';
import type { TabDragSubject } from './tab-drag-coordinator';

/** Pointer capture keeps event.target on the tab; hit-test the visible target instead. */
export function resourceDropTarget(subject: TabDragSubject, x: number, y: number): HTMLElement | null {
  if (subject.kind === 'group' || subject.tabIds.length !== 1 || !desktopBridge()) return null;
  const state = useCenterTabs.getState();
  if (!state.tabs.some(tab => tab.id === subject.tabIds[0] && tab.kind === 'web')) return null;
  const active = state.tabs.find(tab => tab.id === state.activeId);
  if (active?.kind !== 'session' || active.draft || !active.sessionId) return null;
  for (const element of document.querySelectorAll<HTMLElement>('[data-resource-drop-session]')) {
    if (element.dataset.resourceDropSession !== active.sessionId) continue;
    const r = element.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return element;
  }
  return null;
}

export async function attachWebTabResource(tabId: string, sessionId: string): Promise<void> {
  const bridge = desktopBridge();
  const tab = useCenterTabs.getState().tabs.find(tab => tab.id === tabId && tab.kind === 'web');
  if (!bridge || !tab) throw new Error('page_unavailable');
  const result = await jsonFetch(`/api/session/${encodeURIComponent(sessionId)}/resources/attach-web`, {
    method: 'POST', body: JSON.stringify({ window_id: bridge.windowId, tab_id: tabId }),
  }) as { items: BackendResource[] };
  if (!Array.isArray(result.items) || !result.items.some(row => row.tab_id === tabId && row.conversation_session_id === sessionId)) {
    throw new Error('attachment_unconfirmed');
  }
  for (const row of result.items) ingestBrowserResource(row, sessionId);
}
