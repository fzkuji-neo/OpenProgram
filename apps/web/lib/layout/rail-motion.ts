/** A rail opening or closing resizes the centre for a moment. A native web
 *  view lags behind a resize: until its page paints at the new size,
 *  Chromium keeps drawing the old, wider frame past the view's new edge,
 *  over the other rail. So while a rail moves, every web pane on screen
 *  shows a picture of its page instead, and the rail starts moving only
 *  once those pictures are up (or after a short wait at most). */

const listeners = new Set<() => void>();
let moving = 0;
let holds: Promise<void>[] = [];

export function railMoving() { return moving > 0; }
export function onRailMotion(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
/** A web pane calls this while a motion starts, with a promise that
 *  settles once its native view is hidden behind its picture. */
export function holdRailMotion(ready: Promise<void>) { holds.push(ready); }

const MAX_WAIT = 150;

/** Start a rail motion of `duration` ms: resolves when the rail may move. */
export function beginRailMotion(duration: number): Promise<void> {
  moving += 1;
  holds = [];
  for (const listener of [...listeners]) listener();
  const ready = Promise.race([
    Promise.all(holds).then(() => {}),
    new Promise<void>(resolve => window.setTimeout(resolve, MAX_WAIT)),
  ]);
  holds = [];
  void ready.then(() => window.setTimeout(() => {
    moving -= 1;
    for (const listener of [...listeners]) listener();
  }, duration + 60));
  return ready;
}
