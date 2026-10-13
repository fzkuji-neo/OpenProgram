import assert from 'node:assert/strict';
import test, {after} from 'node:test';
import {mkdtemp, rm} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
const root = dirname(fileURLToPath(new URL('../../package.json', import.meta.url)));
const require = createRequire(join(root, 'package.json'));
const {parseHTML} = require('linkedom');
const dir = await mkdtemp(join(root, '.canvas-transition-'));
after(() => rm(dir, {recursive: true, force: true}));
await build({absWorkingDir: root, stdin: {contents: `
export {captureCanvasTransition, playCanvasTransition} from './lib/tabs/canvas-transition';
export {canvasDragging} from './lib/tabs/canvas-drag';
`, resolveDir: root}, bundle: true, format: 'esm', platform: 'node', packages: 'external',
  tsconfig: join(root, 'tsconfig.json'), outfile: join(dir, 'probe.mjs'), loader: {'.css': 'empty'}});

const {window} = parseHTML('<html><body><div data-canvas-root><div id="chatArea-shell" data-center-tab-id="a"><div id="chatArea" class="chat-area">A</div></div><div data-center-tab-id="b">B</div></div></body></html>');
const document = window.document;
const rects = new Map();
const animations = [];
const store = new Map();
const storage = {getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k)};
Object.assign(globalThis, {window, document, localStorage: storage, sessionStorage: storage, CSS: {escape: s => s}, matchMedia: () => ({matches: false})});
window.location = {pathname: '/chat', hash: '', search: '', protocol: 'http:', host: '127.0.0.1:18100'};
globalThis.location = window.location;
window.history = {state: null, pushState() {}, replaceState() {}};
globalThis.history = window.history;
globalThis.getComputedStyle = el => ({display: el.style?.display === 'none' ? 'none' : 'block', backgroundColor: 'transparent', color: 'gray'});
const frames = [];
globalThis.requestAnimationFrame = callback => frames.push(callback);
globalThis.DOMRect = class { constructor(x = 0, y = 0, w = 0, h = 0) { Object.assign(this, {left: x, top: y, width: w, height: h, x, y, right: x + w, bottom: y + h}); } };
const proto = Object.getPrototypeOf(document.createElement('div'));
proto.getBoundingClientRect = function () {
  if (this.hasAttribute('data-canvas-root')) return new DOMRect(0, 0, 1000, 600);
  if (this.getAttribute('role') === 'tab') return rects.get('tab:' + this.getAttribute('data-tab-id')) ?? new DOMRect(0, 0, 0, 0);
  const key = this.getAttribute('data-center-tab-id');
  return rects.get(key) ?? new DOMRect(0, 0, 0, 0);
};
proto.animate = function (frames, options) {
  const finished = Promise.resolve();
  animations.push({el: this, frames, options});
  return {finished, cancel() {}};
};
const {captureCanvasTransition, playCanvasTransition, canvasDragging} = await import(pathToFileURL(join(dir, 'probe.mjs')));
const canvas = document.querySelector('[data-canvas-root]');

test('a close plays once its tab is gone: the ghost is a still copy and the other pane grows', () => {
  rects.set('a', new DOMRect(0, 0, 500, 600));
  rects.set('b', new DOMRect(500, 0, 500, 600));
  captureCanvasTransition({b: 'close'});
  assert.equal(canvasDragging(), true, 'web panes freeze from the capture on');
  playCanvasTransition();
  assert.equal(animations.length, 0, 'the tab is still here, so the change has not committed');
  canvas.querySelector('[data-center-tab-id="b"]').remove();
  rects.set('a', new DOMRect(0, 0, 1000, 600));
  playCanvasTransition();
  const move = animations.find(a => a.el.getAttribute('data-center-tab-id') === 'a');
  assert.deepEqual([move.frames[0].width, move.frames[1].width], ['500px', '1000px']);
  const ghost = canvas.querySelector('[data-canvas-ghost]');
  assert.ok(ghost, 'the closed pane leaves as a ghost');
  assert.equal(ghost.querySelector('[id]'), null, 'nothing may find the ghost by id');
  assert.equal(ghost.hasAttribute('data-center-tab-id'), false);
  assert.equal(canvas.hasAttribute('data-canvas-animating'), true);
});

test('a capture the layout never follows lapses instead of playing later', () => {
  animations.length = 0;
  const realNow = performance.now.bind(performance);
  captureCanvasTransition({a: 'close'});
  performance.now = () => realNow() + 5000;
  rects.set('a', new DOMRect(0, 0, 400, 600));
  canvas.querySelector('[data-center-tab-id="a"]').setAttribute('data-center-tab-id', 'c');
  playCanvasTransition();
  performance.now = realNow;
  assert.equal(animations.length, 0);
});

test('yellow folds the pane into the bottom edge of its tab, then the tab lights once', () => {
  animations.length = 0;
  canvas.innerHTML = '<div data-center-tab-id="a">A</div><div data-center-tab-id="b"><p>B</p></div>';
  const tab = document.createElement('div');
  tab.setAttribute('role', 'tab');
  tab.setAttribute('data-tab-id', 'b');
  document.body.prepend(tab);
  rects.set('tab:b', new DOMRect(600, -36, 160, 28));
  rects.set('a', new DOMRect(0, 0, 500, 600));
  rects.set('b', new DOMRect(500, 0, 500, 600));
  captureCanvasTransition({b: 'minimize'});
  canvas.querySelector('[data-center-tab-id="b"]').remove();
  rects.set('a', new DOMRect(0, 0, 1000, 600));
  playCanvasTransition();
  const layer = canvas.querySelector('[data-canvas-ghost]');
  assert.ok(layer, 'the folding pane leaves as a ghost layer');
  assert.ok(layer.children.length >= 6, 'cut into bands');
  assert.match(layer.style.clipPath, /-8px/, 'nothing is drawn above the tab bottom edge');
  assert.equal(layer.querySelector('[data-center-tab-id]'), null);
  const grow = animations.find(a => a.el.getAttribute('data-center-tab-id') === 'a');
  assert.ok(grow.options.delay > 0, 'the neighbour fills after the fold leads');
  const realNow = performance.now.bind(performance);
  performance.now = () => realNow() + 10_000;
  while (frames.length) frames.shift()(performance.now());
  performance.now = realNow;
  assert.ok(animations.some(a => a.el === tab), 'the tab lights as it takes the pane in');
  assert.equal(layer.isConnected, false, 'the layer is gone once the fold ends');
  tab.remove();
});
