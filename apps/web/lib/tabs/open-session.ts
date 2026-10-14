// Open a session from outside the sidebar: a notification click or the
// command palette. Mirrors the sidebar row's click: the active session tab
// navigates (a web or file tab gets a session tab), then the route follows.
import { displayTitle } from "@/components/sidebar/sessions-list/helpers";
import { useSessionStore } from "@/lib/session-store";
import { useCenterTabs } from "@/lib/tabs/center-tabs-store";
import { pushPath } from "@/lib/shallow-nav";

export function openSession(sessionId: string): void {
  const conv = useSessionStore.getState().conversations[sessionId];
  useCenterTabs.getState().openSessionTab(sessionId, (conv && displayTitle(conv)) || "");
  pushPath("/s/" + sessionId);
}
