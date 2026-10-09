import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DOT_OPACITY,
  DOT_PITCH,
  DOT_RADIUS,
  DOT_ROWS,
  THUMB_WIDTH,
  TRACK_HEIGHT,
  captionAlignment,
  layoutDotMatrix,
  thumbCenterX,
} from '../../lib/effort-matrix.ts';

const WIDTH = 200;
const COUNT = 5;
const close = (a, b) => Math.abs(a - b) < 1e-9;

test('thumb centre follows Radix: half a thumb in from each edge, linear between', () => {
  assert.equal(thumbCenterX(0, COUNT, WIDTH), THUMB_WIDTH / 2);
  assert.equal(thumbCenterX(COUNT - 1, COUNT, WIDTH), WIDTH - THUMB_WIDTH / 2);
  assert.equal(thumbCenterX(2, COUNT, WIDTH), WIDTH / 2);
  assert.equal(thumbCenterX(0, 1, WIDTH), WIDTH / 2, 'a single option sits in the middle');
  assert.equal(thumbCenterX(9, COUNT, WIDTH), WIDTH - THUMB_WIDTH / 2, 'index is clamped');
});

test('the matrix fills the track with DOT_ROWS rows on a DOT_PITCH grid, centred both ways', () => {
  const dots = layoutDotMatrix(WIDTH, thumbCenterX(2, COUNT, WIDTH));
  const cols = Math.floor(WIDTH / DOT_PITCH);
  assert.equal(dots.length, cols * DOT_ROWS);

  const xs = [...new Set(dots.map((d) => d.cx))].sort((a, b) => a - b);
  assert.equal(xs.length, cols);
  for (let i = 1; i < xs.length; i++) assert.ok(close(xs[i] - xs[i - 1], DOT_PITCH));
  assert.ok(close(xs[0], WIDTH - xs[xs.length - 1]), 'equal margins left and right');

  const ys = [...new Set(dots.map((d) => d.cy))].sort((a, b) => a - b);
  assert.equal(ys.length, DOT_ROWS);
  for (let i = 1; i < ys.length; i++) assert.ok(close(ys[i] - ys[i - 1], DOT_PITCH));
  assert.ok(close((ys[0] + ys[ys.length - 1]) / 2, TRACK_HEIGHT / 2), 'rows centred on the track');
});

test('dots grow and brighten continuously towards the right', () => {
  const dots = layoutDotMatrix(WIDTH, thumbCenterX(0, COUNT, WIDTH));
  const firstRowY = Math.min(...dots.map((d) => d.cy));
  const row = dots.filter((d) => d.cy === firstRowY).sort((a, b) => a.cx - b.cx);
  assert.ok(close(row[0].r, DOT_RADIUS.min), 'leftmost dot is the smallest');
  assert.ok(close(row[row.length - 1].r, DOT_RADIUS.max), 'rightmost dot is the largest');
  for (let i = 1; i < row.length; i++) {
    assert.ok(row[i].r > row[i - 1].r, `radius keeps growing at column ${i}`);
    if (row[i].ahead && row[i - 1].ahead) {
      assert.ok(row[i].opacity > row[i - 1].opacity, `opacity keeps climbing at column ${i}`);
    }
  }
  assert.ok(close(row[row.length - 1].opacity, DOT_OPACITY.ahead.max));
});

test('dots behind the thumb are dim, dots ahead of it are the bright lavender field', () => {
  const thumbX = thumbCenterX(2, COUNT, WIDTH);
  const dots = layoutDotMatrix(WIDTH, thumbX);
  for (const d of dots) assert.equal(d.ahead, d.cx > thumbX);
  const behind = dots.filter((d) => !d.ahead);
  const ahead = dots.filter((d) => d.ahead);
  assert.ok(behind.length > 0 && ahead.length > 0);
  assert.ok(Math.max(...behind.map((d) => d.opacity)) <= DOT_OPACITY.behind.max + 1e-9);
  assert.ok(Math.min(...behind.map((d) => d.opacity)) >= DOT_OPACITY.behind.min - 1e-9);
  assert.ok(Math.max(...ahead.map((d) => d.opacity)) >= 0.99);

  // At the last option nothing visible is left ahead of the thumb.
  const atMax = thumbCenterX(COUNT - 1, COUNT, WIDTH);
  const stillAhead = layoutDotMatrix(WIDTH, atMax).filter((d) => d.ahead);
  assert.ok(stillAhead.every((d) => d.cx <= atMax + THUMB_WIDTH / 2), 'only dots hidden under the thumb');
});

test('an unmeasured track draws nothing', () => {
  assert.deepEqual(layoutDotMatrix(0, 0), []);
  assert.deepEqual(layoutDotMatrix(Number.NaN, 0), []);
});

test('the Recommended caption hugs the edges for the end options and centres otherwise', () => {
  assert.equal(captionAlignment(0, COUNT), 'start');
  assert.equal(captionAlignment(COUNT - 1, COUNT), 'end');
  assert.equal(captionAlignment(2, COUNT), 'center');
  assert.equal(captionAlignment(0, 1), 'center');
  assert.equal(captionAlignment(0, 2), 'start');
  assert.equal(captionAlignment(1, 2), 'end');
});
