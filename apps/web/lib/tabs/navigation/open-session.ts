// Open a session or a new chat from outside the sidebar rows: a
// notification click, the command palette or the sidebar's New chat.
import { displayTitle } from "@/components/sidebar/sessions-list/helpers";
import { newSession } from "@/lib/runtime-bridge/session/conversations";
import { useSessionStore } from "@/lib/session-store";
import { useCenterTabs } from "@/lib/tabs/center-tabs-store";
import { pushPath } from "@/lib/shallow-nav";

/** Mirrors a sidebar row click: the active session tab navigates (a web or
 *  file tab gets a session tab), then the route follows. */
export function openSession(sessionId: string): void {
  const conv = useSessionStore.getState().conversations[sessionId];
  useCenterTabs.getState().openSessionTab(sessionId, (conv && displayTitle(conv)) || "");
  pushPath("/s/" + sessionId);
}

/** Focus-or-create, like a browser's address bar: an open unsent draft tab
 *  or New tab page is reused instead of adding another empty tab. Returns
 *  the draft id. The tab strip's + still opens extra empty chats. */
export function openNewChat(): string {
  const s = useCenterTabs.getState();
  const existingDraft = s.tabs.find(
    (t) => t.kind === "session" && t.draft && t.sessionId,
  );
  const existingNtp = existingDraft
    ? null
    : s.tabs.find((t) => t.kind === "ntp");
  let draftId: string;
  if (existingDraft) {
    if (s.activeId !== existingDraft.id) s.setActive(existingDraft.id);
    draftId = existingDraft.sessionId!;
  } else if (existingNtp) {
    // The New tab page becomes the draft, as when New session is clicked on it.
    if (s.activeId !== existingNtp.id) s.setActive(existingNtp.id);
    draftId = useCenterTabs.getState().claimDraftSessionTab();
  } else {
    draftId = s.openDraftSessionTab();
  }
  newSession(draftId);
  return draftId;
}
