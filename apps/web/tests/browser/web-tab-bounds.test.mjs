import assert from 'node:assert/strict';
import test from 'node:test';
import { clipWebTabBounds } from '../../lib/browser/web-tab-bounds.ts';

test('a pane measured mid-move never sends bounds past its canvas', () => {
  // The left rail moved the canvas to 191; the pane still has its old width.
  const canvas = { left: 185, top: 40, right: 1368, bottom: 929 };
  assert.deepEqual(clipWebTabBounds({ x: 191, y: 100, width: 1244, height: 800 }, canvas), { x: 191, y: 100, width: 1177, height: 800 });
});

test('a pane inside its canvas, or one without a canvas, is sent as measured', () => {
  const bounds = { x: 300, y: 100, width: 600, height: 400 };
  assert.deepEqual(clipWebTabBounds(bounds, { left: 0, top: 0, right: 1400, bottom: 900 }), bounds);
  assert.deepEqual(clipWebTabBounds(bounds, null), bounds);
});
