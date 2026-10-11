import { create } from "zustand";
import { desktopBridge } from "../desktop/desktop-bridge";
import { useCenterTabs } from "./center-tabs-store";

/** Last-seen pictures of panes for the window overview, keyed by tab id.
 *  Like Mission Control and the iPad switcher, a window that is not on
 *  screen shows how it looked when it was; web pages are captured live
 *  from their own view. Kept in memory only. */
export const useWindowSnapshots = create<{ shots: Record<string, string> }>(() => ({ shots: {} }));

let inFlight: Promise<void> | null = null;

/** Capture every pane on screen now, except the tabs being dragged (the
 *  drag label floats over them). Resolves within `limit` ms either way,
 *  so an overview never waits long for a picture. */
export function captureVisiblePanes(skip: readonly string[] = [], limit = 260): Promise<void> {
  const bridge = desktopBridge();
  if (!bridge?.captureRegion || document.querySelector("[data-canvas-overview]")) return Promise.resolve();
  if (!inFlight) {
    const panes = [...document.querySelectorAll<HTMLElement>("[data-canvas-root] [data-canvas-content]")]
      .filter(pane => pane.offsetWidth > 0 && pane.offsetHeight > 0 && !skip.includes(pane.dataset.canvasContent!));
    const tabs = useCenterTabs.getState().tabs;
    inFlight = Promise.all(panes.map(async pane => {
      const id = pane.dataset.canvasContent!;
      const tab = tabs.find(candidate => candidate.id === id);
      const r = pane.getBoundingClientRect();
      const shot = tab?.kind === "web"
        ? await bridge.webTab.capture?.(id, "presentation").catch(() => null)
        : await bridge.captureRegion!({ x: r.left, y: r.top, width: r.width, height: r.height }).catch(() => null);
      return [id, shot] as const;
    })).then(results => {
      const fresh = results.filter((entry): entry is readonly [string, string] => !!entry[1]);
      if (fresh.length) useWindowSnapshots.setState(s => ({ shots: { ...s.shots, ...Object.fromEntries(fresh) } }));
    }).finally(() => { inFlight = null; });
  }
  return Promise.race([inFlight, new Promise<void>(resolve => window.setTimeout(resolve, limit))]);
}

/** Pictures of web pages that are not on screen, taken from their views. */
export function captureWebTabs(ids: string[]) {
  const capture = desktopBridge()?.webTab.capture;
  if (!capture) return;
  for (const id of ids) {
    void capture(id, "presentation").then(shot => {
      if (shot) useWindowSnapshots.setState(s => ({ shots: { ...s.shots, [id]: shot } }));
    }).catch(() => {});
  }
}

/** Drop pictures of tabs that no longer exist. */
export function pruneSnapshots(alive: Set<string>) {
  const { shots } = useWindowSnapshots.getState();
  if (Object.keys(shots).some(id => !alive.has(id))) {
    useWindowSnapshots.setState({ shots: Object.fromEntries(Object.entries(shots).filter(([id]) => alive.has(id))) });
  }
}
