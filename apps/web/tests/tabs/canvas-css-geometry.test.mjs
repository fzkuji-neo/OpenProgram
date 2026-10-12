import assert from 'node:assert/strict';
import test from 'node:test';
import { canvasCssGeometry, canvasGeometry, canvasViewport, presetLayout, leaves } from '../../lib/tabs/canvas-layout.ts';

// Resolves calc(P% + Npx) against a containing length.
const resolve = (css, size) => {
  const m = /^calc\((-?[\d.]+)% \+ (-?[\d.]+)px\)$/.exec(css);
  assert.ok(m, `calc form: ${css}`);
  return Number(m[1]) / 100 * size + Number(m[2]);
};

test('panes and dividers written as shares of the canvas land where the pixel layout puts them, at any canvas size', () => {
  const layout = presetLayout('main+2', ['a', 'b', 'c']);
  const css = canvasCssGeometry(layout.root);
  for (const [width, height] of [[1305, 889], [1080, 700], [777, 512]]) {
    const px = canvasGeometry(layout.root, canvasViewport(width, height));
    for (const pane of leaves(layout.root)) {
      const a = px.panes.get(pane.id), b = css.panes.get(pane.id);
      assert.ok(Math.abs(resolve(b.left, width) - a.left) < 0.01);
      assert.ok(Math.abs(resolve(b.width, width) - a.width) < 0.01);
      assert.ok(Math.abs(resolve(b.top, height) - a.top) < 0.01);
      assert.ok(Math.abs(resolve(b.height, height) - a.height) < 0.01);
    }
    px.dividers.forEach((d, i) => assert.ok(Math.abs(resolve(css.dividers[i].left, width) - d.left) < 0.01));
  }
});

test('the inset of a split canvas comes off every side', () => {
  const layout = presetLayout('main+2', ['a', 'b', 'c']);
  const [pane] = leaves(layout.root);
  const plain = canvasCssGeometry(layout.root).panes.get(pane.id), inset = canvasCssGeometry(layout.root, 1).panes.get(pane.id);
  assert.ok(Math.abs(resolve(inset.left, 1200) - resolve(plain.left, 1200) - 1) < 0.01);
  assert.ok(Math.abs(resolve(plain.width, 1200) - resolve(inset.width, 1200) - 2) < 0.01);
});
