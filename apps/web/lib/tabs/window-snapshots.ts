import { create } from "zustand";
import { desktopBridge } from "../desktop/desktop-bridge";
import { useCenterTabs } from "./center-tabs-store";

/** Last-seen pictures of panes for the window overview, keyed by tab id.
 *  Like Mission Control and the iPad switcher, a window that is not on
 *  screen shows how it looked when it was; web pages are captured live
 *  from their own view. Kept in memory only. */
export const useWindowSnapshots = create<{ shots: Record<string, string> }>(() => ({ shots: {} }));

/** Pictures also live in IndexedDB, so cards keep them across restarts. */
const DB = "openprogram-window-snapshots", STORE = "shots";
let db: Promise<IDBDatabase | null> | null = null;
function openDb() {
  if (!db) db = new Promise(resolve => {
    try {
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
  return db;
}
async function persist(entries: ReadonlyArray<readonly [string, string | null]>) {
  const handle = await openDb();
  if (!handle) return;
  try {
    const store = handle.transaction(STORE, "readwrite").objectStore(STORE);
    for (const [id, shot] of entries) if (shot) store.put(shot, id); else store.delete(id);
  } catch { /* storage unavailable: memory still works */ }
}
/** Load the saved pictures once; fresher ones taken meanwhile win. */
export async function restoreSnapshots() {
  const handle = await openDb();
  if (!handle) return;
  try {
    const store = handle.transaction(STORE, "readonly").objectStore(STORE);
    const [keys, values] = await Promise.all([store.getAllKeys(), store.getAll()].map(request => new Promise<unknown[]>(resolve => {
      request.onsuccess = () => resolve(request.result as unknown[]);
      request.onerror = () => resolve([]);
    })));
    const saved = Object.fromEntries(keys.map((key, i) => [String(key), String(values[i])]));
    useWindowSnapshots.setState(s => ({ shots: { ...saved, ...s.shots } }));
  } catch { /* nothing saved */ }
}
function remember(fresh: ReadonlyArray<readonly [string, string]>) {
  if (!fresh.length) return;
  useWindowSnapshots.setState(s => ({ shots: { ...s.shots, ...Object.fromEntries(fresh) } }));
  void persist(fresh);
}

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
      remember(results.filter((entry): entry is readonly [string, string] => !!entry[1]));
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
      if (shot) remember([[id, shot]]);
    }).catch(() => {});
  }
}

/** Drop pictures of tabs that no longer exist. An empty tab list is the
 *  store still loading, never a reason to forget everything. */
export function pruneSnapshots(alive: Set<string>) {
  if (!alive.size) return;
  const { shots } = useWindowSnapshots.getState();
  const gone = Object.keys(shots).filter(id => !alive.has(id));
  if (!gone.length) return;
  useWindowSnapshots.setState({ shots: Object.fromEntries(Object.entries(shots).filter(([id]) => alive.has(id))) });
  void persist(gone.map(id => [id, null] as const));
}
