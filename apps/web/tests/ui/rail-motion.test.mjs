import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.window ??= globalThis;
const { beginRailMotion, holdRailMotion, onRailMotion, railMoving } = await import('../../lib/layout/rail-motion.ts');

test('a rail moves once the web panes have swapped to pictures, and they come back after it', async () => {
  let pictured = null;
  const seen = [];
  const off = onRailMotion(() => {
    seen.push(railMoving());
    if (railMoving()) holdRailMotion(new Promise(resolve => { pictured = resolve; }));
  });
  let moved = false;
  const started = beginRailMotion(20).then(() => { moved = true; });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(moved, false, 'the rail waits for the picture');
  pictured();
  await started;
  assert.equal(railMoving(), true, 'panes stay pictures while the rail moves');
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(railMoving(), false);
  assert.deepEqual(seen, [true, false], 'panes hear the start and the end');
  off();
});

test('a pane that never pictures itself does not hold the rail long', async () => {
  const off = onRailMotion(() => { if (railMoving()) holdRailMotion(new Promise(() => {})); });
  const t0 = Date.now();
  await beginRailMotion(0);
  assert.ok(Date.now() - t0 < 400, 'the wait is bounded');
  off();
  await new Promise(resolve => setTimeout(resolve, 100));
});
