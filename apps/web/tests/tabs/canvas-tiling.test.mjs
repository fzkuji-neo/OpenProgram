import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  PANE_MIN, dockLayout, leaves, presetLayout, resizeSplit, rowLayout, snapResize, tilePane, unitRects,
} from '../../lib/tabs/canvas-layout.ts';
import { rememberCanvas, takePreviousCanvas } from '../../lib/tabs/canvas-history.ts';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
const rectOf = (layout, content) => {
  const pane = leaves(layout.root).find(p => p.content === content);
  const r = unitRects(layout.root).get(pane.id);
  return [r.left, r.top, r.width, r.height].map(v => Math.round(v * 100) / 100);
};
const empties = (layout) => leaves(layout.root).filter(p => !p.content);

test('a corner drop on a lone tab takes a quarter and leaves an empty quarter to fill', () => {
  const next = dockLayout(rowLayout(['a']), ['b'], 'root', 'top-left');
  assert.deepEqual(rectOf(next, 'b'), [0, 0, 0.5, 0.5]);
  assert.deepEqual(rectOf(next, 'a'), [0.5, 0, 0.5, 1]);
  const [empty] = empties(next);
  assert.ok(empty, 'the other left quarter is an empty pane offering tabs');
  const r = unitRects(next.root).get(empty.id);
  assert.deepEqual([r.left, r.top, r.width, r.height], [0, 0.5, 0.5, 0.5]);
});

test('a corner drop splits the half that holds the corner into quarters', () => {
  const columns = dockLayout(rowLayout(['a', 'b']), ['c'], 'root', 'bottom-right');
  assert.deepEqual(rectOf(columns, 'c'), [0.5, 0.5, 0.5, 0.5]);
  assert.deepEqual(rectOf(columns, 'b'), [0.5, 0, 0.5, 0.5]);
  assert.deepEqual(rectOf(columns, 'a'), [0, 0, 0.5, 1]);
  assert.equal(empties(columns).length, 0);
  const rows = dockLayout(presetLayout('2x1', ['a', 'b']), ['c'], 'root', 'top-left');
  assert.deepEqual(rectOf(rows, 'c'), [0, 0, 0.5, 0.5]);
  assert.deepEqual(rectOf(rows, 'a'), [0.5, 0, 0.5, 0.5]);
});

test('edge drops take a half of the whole canvas and keep the rest arranged', () => {
  const next = dockLayout(rowLayout(['a', 'b']), ['c'], 'root', 'bottom');
  assert.deepEqual(rectOf(next, 'c'), [0, 0.5, 1, 0.5]);
  assert.deepEqual(rectOf(next, 'a'), [0, 0, 0.5, 0.5]);
});

test('dropping a pane on itself changes nothing', () => {
  const layout = rowLayout(['a', 'b']);
  const own = leaves(layout.root).find(p => p.content === 'a');
  assert.equal(dockLayout(layout, ['a'], own.id, 'left'), null);
});

test('Move and resize sends a pane to a half; the others keep their order in the rest', () => {
  const layout = presetLayout('main+2', ['a', 'b', 'c']);
  const c = leaves(layout.root).find(p => p.content === 'c');
  const next = tilePane(layout.root, c.id, 'left');
  assert.equal(next.paneId, c.id, 'the pane keeps its id so focus follows it');
  const tiled = { root: next.root, focusedPaneId: next.paneId };
  assert.deepEqual(rectOf(tiled, 'c'), [0, 0, 0.5, 1]);
  assert.ok(rectOf(tiled, 'a')[0] < rectOf(tiled, 'b')[0], 'a stays before b');
});

test('a quarter already taken trades places with the moving pane', () => {
  const layout = presetLayout('2x2', ['a', 'b', 'c', 'd']);
  const a = leaves(layout.root).find(p => p.content === 'a');
  const next = tilePane(layout.root, a.id, 'bottom-right');
  const tiled = { root: next.root, focusedPaneId: next.paneId };
  assert.deepEqual(rectOf(tiled, 'a'), [0.5, 0.5, 0.5, 0.5]);
  assert.deepEqual(rectOf(tiled, 'd'), [0, 0, 0.5, 0.5]);
  assert.equal(leaves(next.root).find(p => p.id === next.paneId).content, 'a', 'focus follows the moved tab');
});

test('a lone pane has nothing to tile against', () => {
  const layout = rowLayout(['a']);
  const next = tilePane(layout.root, leaves(layout.root)[0].id, 'left');
  assert.equal(next.root, layout.root);
});

test('dividers stick at a third, a half and two thirds', () => {
  assert.deepEqual(snapResize([0.5, 0.5], 0, 0.16, 600), { delta: 2 / 3 - 0.5, snap: 2 / 3 });
  assert.deepEqual(snapResize([0.4, 0.6], 0, 0.095, 600), { delta: 0.5 - 0.4, snap: 0.5 });
  assert.deepEqual(snapResize([0.5, 0.5], 0, 0.1, 600), { delta: 0.1, snap: null });
  // A snap point outside the two panes being resized is ignored.
  assert.equal(snapResize([0.2, 0.1, 0.7], 0, 0.125, 600).snap, null);
});

test('Return to previous layout finds a layout by any tab it involved', () => {
  const before = rowLayout(['x', 'y']);
  rememberCanvas(['g1', 'x', 'y'], before);
  assert.equal(takePreviousCanvas(['z']), undefined);
  assert.equal(takePreviousCanvas(['y']), before);
  assert.equal(takePreviousCanvas(['y']), undefined, 'each step is used once');
});

test('dragging a tab or a pane opens the window overview; its cards keep their splits', async () => {
  const overview = await read('lib/tabs/canvas-overview.ts');
  assert.match(overview, /const side: OverviewSide = px < OVERVIEW_SIDE \? "left" : px > 1 - OVERVIEW_SIDE \? "right" : py < 0\.5 \? "top" : "bottom";/, 'a card splits by quarter strips and halves, with no dead centre');
  assert.match(overview, /return \{ targetId: card\.dataset\.overviewTarget!, paneId: "root", side, rect, action: "dock", label \};/, 'a card merges beside the whole window');
  assert.match(overview, /action: "fill", label \};\s*\}\s*$/, 'empty space opens the tab on its own');
  assert.match(overview, /if \(x < r\.left \|\| x > r\.right \|\| y < r\.top \|\| y > r\.bottom\) \{ setHover\(null, ""\); return null; \}/, 'outside the overview the strip and detach keep working');
  const drag = await read('lib/tabs/canvas-drag.ts');
  assert.doesNotMatch(drag, /canvasDropAt|PANE_SIDE|canvasEdgeBand/, 'the in-canvas drop zones are gone');
  assert.match(drag, /if \(useCanvasOverview\.getState\(\)\.mode === "drag" && !overviewHeld\(\)\) closeOverview\(\);/, 'every drag end closes it unless a merge is landing');
  assert.match(drag, /event\.preventDefault\(\);\s*const grip = event\.currentTarget/, 'a pane drag does not select text');
  const tab = await read('components/center-tabs/use-tab-pointer-drag.ts');
  assert.match(tab, /if \(outsideBand\) \{\s*drag\.wantsOverview = true;/, 'a tab opens it once it leaves the strip, so reordering still works');
  assert.match(tab, /const canvasDrop = resourceTarget \? null : overviewDropAt\(e\.clientX, e\.clientY\);/);
  const view = await read('components/center-tabs/canvas-overview.tsx');
  assert.match(view, /for \(const p of leaves\(root\)\) if \(p\.content && leaving\.has\(p\.content\)\) root = removePane\(root, p\.id\);/, 'the dragged tab leaves its card');
  assert.match(view, /const geometry = canvasGeometry\(card\.root, viewport\);/, 'a split window stays split in its card');
  assert.match(view, /data-native-view-occluder="true"/, 'native web views hide under it');
  assert.match(view, /if \(!isPinch\(e\) \|\| e\.defaultPrevented\) return;/, 'a pinch opens it unless the content zooms itself');
  assert.match(view, /command\.command === "overview" && !useCanvasOverview\.getState\(\)\.mode/, 'a pinch in on a web page opens it too');
  const webPinch = await read('../desktop/main/webtab-preload.js');
  assert.match(webPinch, /if \(spent \|\| startScale > 1\.01\) return;/, 'only a page at its normal size hands the pinch to the overview');
  assert.match(webPinch, /!e\.isTrusted/, 'a page cannot fake the gesture');
  const webViews = await read('../desktop/main/web-views.js');
  assert.match(webViews, /setVisualZoomLevelLimits\?\.\(1, 3\)/, 'a pinch out magnifies a web page');
  assert.doesNotMatch(view, /\stitle=\{/, 'no native tooltips');
  const strip = await read('components/center-tabs/center-tab-strip.tsx');
  assert.match(strip, /className=\{styles\.overviewBtn\}\s*data-overview-toggle=""\s*aria-label=\{text\("Show all windows", "显示所有窗口"\)\}/, 'the strip button opens it, labelled without a native tooltip');
  const lifecycle = await read('components/center-tabs/use-tab-lifecycle.ts');
  assert.match(lifecycle, /window\.addEventListener\("op-activate-center-tab", onActivateTab\)/, 'a card click activates like a tab click');
  assert.match(lifecycle, /void captureVisiblePanes\(\)\.then\(\(\) => openOverview\("browse"\)\)/, 'the panes are pictured before the overview covers them');
  assert.match(tab, /if \(drag\.snapshotsReady\) openOverview\("drag", drag\.subject\.tabIds\);/);
  assert.match(drag, /void captureVisiblePanes\(\[tabId\]\)\.then\(\(\) => \{ if \(!finished\) openOverview\("drag", \[tabId\]\); \}\);/);
  assert.match(view, /\{shot \? <img className=\{styles\.shot\} src=\{shot\}/, 'cards show what each pane looked like');
  const shots = await read('lib/tabs/window-snapshots.ts');
  assert.match(shots, /const page = await bridge\.webTab\.capture\?\.\(id, "presentation"\)/, 'web pages are pictured from their own view');
  assert.match(shots, /g\.drawImage\(inner, \(frame\.left - pane\.left\) \* k, \(frame\.top - pane\.top\) \* k, frame\.width \* k, frame\.height \* k\);/, 'the page is drawn into its pane picture under the toolbar, keeping the pane proportions');
  assert.match(shots, /if \(shot && chrome\) remember\(\[\[id, await underChrome\(shot, chrome\)\]\]\);/, 'a page pictured off screen keeps the toolbar band it was seen with');
  assert.match(view, /function windowBox\(canvas: HTMLElement\): Box \{\n  return \{ left: 0, top: 0, width: canvas\.clientWidth, height: canvas\.clientHeight \};/, 'a card is the whole window and zooms onto it');
  assert.match(view, /const k = zoomed \|\| !cardWidth \? 1 : cardWidth \/ frame\.width;/, 'a card is drawn at its own scale, so the zoom only scales');
  assert.match(view, /borderRadius: split \? PANE_RADIUS \* k : 0,/, 'split pane corners shrink with the card, never jump');
  assert.match(view, /borderRadius: split \? 0 : radius \* k \}/, 'a lone window keeps the center card corners, scaled');
  assert.match(shots, /indexedDB\.open\(DB, 1\)/, 'pictures survive a restart');
  assert.match(shots, /root\.setAttribute\("data-capturing-panes", ""\)/, 'the pane grips stay out of the pictures');
  const overviewCss = await read('components/center-tabs/canvas-overview.module.css');
  assert.doesNotMatch(overviewCss, /\.card\[data-current\] \.mini/, 'nothing marks the current window: it zooms into its card');
  assert.match(view, /import \{ motion, type Transition \} from "framer-motion";/, 'the zoom is framer-motion layout animation, not hand-written transforms');
  assert.doesNotMatch(view, /mini\.animate\(|function lay\(/, 'no hand-written zoom transforms remain');
  assert.match(view, /if \(zoomAt\(activeKey, "out"\)\) requestAnimationFrame\(\(\) => setZoom\(z => z\?\.phase === "out" \? \{ \.\.\.z, phase: "in" \} : z\)\);/, 'opening shrinks the window into its card');
  assert.match(view, /if \(!zoomAt\(pick\?\.key \?\? activeKey, "closing"\)\) closeOverview\(\);/, 'closing grows the card back over the center area');
  assert.match(view, /if \(zoom\.phase === "closing"\) closeOverview\(\); else if \(zoom\.phase === "in"\) setZoom\(null\);/, 'the overview closes once the card has landed');
  assert.match(view, /if \(pick\) window\.dispatchEvent\(new CustomEvent\("op-activate-center-tab"/, 'a picked window is switched to before it lands');
  assert.match(view, /Date\.now\(\) - lastInput > 5000/, 'idle windows are pictured again, so a restart keeps a recent picture');
  assert.match(shots, /if \(!alive\.size\) return;/, 'a loading tab list never wipes the pictures');
  const base = await read('app/styles/base.css');
  assert.match(base, /\.app \.center-col:has\(\[data-canvas-overview\]\) \{\s*background: var\(--bg-secondary\);\s*box-shadow: none;/, 'no card edge around the overview');
  const main = await readFile(new URL('../../../desktop/main.js', import.meta.url), 'utf8');
  assert.match(main, /if \(!ctx \|\| event\.sender !== ctx\.win\.webContents\) return null;/, 'only a window\'s own page may picture itself');
});

test('a merge drop zooms the merged window out of the card it was dropped on', async () => {
  const overview = await read('lib/tabs/canvas-overview.ts');
  assert.match(overview, /if \(useCanvasOverview\.getState\(\)\.mode !== "drag" \|\| drop\.action !== "dock"\) return;/, 'only a merge holds the overview');
  const strip = await read('components/center-tabs/use-tab-pointer-drag.ts');
  assert.ok(strip.indexOf('holdOverviewLanding(canvasDrop, previewRect)') < strip.indexOf('const committed = dragCoordinator.commit();'), 'the strip holds it before the drag state clears');
  assert.ok(strip.indexOf('const previewRect =') < strip.indexOf('drag.teardown();\n    if (!drag.started) return;'), 'the carried window is measured before it is removed');
  assert.match(overview, /for \(const pane of card\.querySelectorAll<HTMLElement>\("\[data-overview-pane\]"\)\)/, 'each pane of the card is noted');
  const drag = await read('lib/tabs/canvas-drag.ts');
  assert.match(drag, /s\.dockCanvas\(sourceIds, drop\.targetId, drop\.paneId, drop\.side\);\n  landOverview\(drop\.targetId\);/, 'the commit lands it');
  assert.match(drag, /cleanup\(target\?\.drop\);/, 'a pane drop holds it too');
  const view = await read('components/center-tabs/canvas-overview.tsx');
  assert.match(view, /const from = held\.panes\[id\] \?\? held\.dropped;/, 'the merge first moves every pane into its place in the card');
  assert.match(view, /for \(const a of settles\) a\.finish\(\);\s*growFrom\.current = mini\.getBoundingClientRect\(\);\s*if \(!zoomAt\(card\.key, "closing"\)\) closeOverview\(\);\s*\}, MERGE_MS \* ZOOM_AFTER\);/, 'then the card zooms, taking over from the settle\'s slow tail');
  assert.match(view, /const key = held && contents\.includes\(landing!\) \? held\.cardKey : entry\.id;/, 'the landing card keeps its element, so its pictures do not blink');
  assert.match(view, /<span key=\{p\.content \?\? p\.id\} className=\{styles\.pane\}/, 'and so do its panes');
  assert.match(view, /const from = growFrom\.current, to = el\?\.getBoundingClientRect\(\);/, 'the card grows from where it sat in the grid');
  assert.match(view, /void grow\.finished\.then\(closeOverview, closeOverview\);/, 'and the overview closes when it lands');
});

test('the pane menu offers Move and resize, Arrange and the ⌃⌥ shortcuts', async () => {
  const controls = await read('components/center-tabs/canvas-controls.tsx');
  for (const id of ['left', 'right', 'top', 'bottom', 'fill', 'top-left', 'top-right', 'bottom-left', 'bottom-right']) {
    assert.match(controls, new RegExp(`\\{ id: "${id}", en:`));
  }
  for (const id of ['1x2', '2x1', 'main+2', '2x2', '1x1', '3x3', '4x4']) {
    assert.match(controls, new RegExp(`\\{ id: "${id.replace('+', '\\+')}", en:`), `${id} is still offered`);
  }
  assert.match(controls, /mac && e\.ctrlKey && e\.altKey && !e\.metaKey/);
  assert.match(controls, /e\.code === "KeyR"\) \{ e\.preventDefault\(\); restore\(\);/);
  assert.match(controls, /centerCanvasPresets/, 'saved layouts are kept');
  assert.doesNotMatch(controls, /\stitle=\{/, 'no native tooltips on canvas controls');
  assert.match(controls, /<span className=\{styles\.sheet\} aria-hidden="true" \/>/, 'the grip has a sheet that drops in under the pointer');
  const gripCss = await read('components/center-tabs/canvas-controls.module.css');
  assert.match(gripCss, /\.light \{\n  --light: var\(--text-muted\);[\s\S]*?width: 4px;\n  height: 4px;/, 'at rest the window buttons are the three grey dots of the grip');
  assert.match(gripCss, /\.handle\[data-open\] \.light,\n\.handle\[data-folding\] \.light \{\n  width: 12px;\n  height: 12px;\n  opacity: 1;\n  background: var\(--light\);/, 'under the pointer the dots grow into the coloured buttons');
  assert.match(gripCss, /\.sheet \{[\s\S]*?transform-origin: 50% 0;\n  transform: scale\(\.5, 0\);/, 'the grey sheet drops from the top edge');
  assert.match(controls, /if \(menu\?\.hover\) closeMenu\(\);/, 'pressing the grip closes a hover menu before a drag');
});

test('drags cannot hang: missed releases, errors and drag regions all end them', async () => {
  const drag = await read('lib/tabs/canvas-drag.ts');
  assert.match(drag, /if \(!owner \|\| event\.buttons !== 0 \|\| event\.pointerType === "touch"\) return;/, 'the first buttonless move ends a drag whose release was lost');
  assert.match(drag, /window\.addEventListener\("pointerdown", \(\) => owner\?\.cancel\(\), true\)/);
  assert.match(drag, /function resolveDrop[\s\S]*?catch \(error\)[\s\S]*?return \{ resource: null, drop: null, strip: null \}/, 'a failed drop lookup cannot skip cleanup');
  assert.doesNotMatch(drag, /style\.visibility/, 'the grip is hidden by a pane attribute, never inline style');
  const strip = await read('components/center-tabs/use-tab-pointer-drag.ts');
  assert.match(strip, /setCanvasDragging\(true, \{ cancel: cancelPointerDrag, release: onPointerDragUp \}\)/);
  const css = await read('app/styles/base.css');
  assert.match(css, /html\[data-canvas-dragging\] \* \{ -webkit-app-region: no-drag !important; \}/);
  assert.doesNotMatch(css.slice(css.indexOf('.canvas-drop-preview {'), css.indexOf('.canvas-drop-preview[data-drop-target="tab-strip"]')), /backdrop-filter|1\.15\)/);
  const controls = await read('components/center-tabs/canvas-controls.tsx');
  assert.match(controls, /requestAnimationFrame\(\(\) => \{ frame = 0; if \(latest && !done\) useCenterTabs\.getState\(\)\.previewCanvas\(targetId, latest\); \}\)/, 'divider drags paint per frame without persisting');
  assert.doesNotMatch(controls, /gripStart\.current = \{ x: e\.clientX, y: e\.clientY \}; focus\(/, 'pressing a grip does not refocus and reroute before a drag');
  const web = await read('components/center-tabs/web-tab-pane.tsx');
  assert.match(web, /const timer = window\.setTimeout\(hide, 160\);/, 'a native page stays visible until its snapshot is ready');
});

test('a divider stops at the panes\' minimum size and never squeezes a small pane further', () => {
  const layout = rowLayout(['a', 'b']);
  const span = 800;
  const widest = resizeSplit(layout.root, layout.root.id, 0, 0.9, span);
  assert.equal(Math.round(widest.sizes[1] * span), PANE_MIN.width, 'the right pane keeps its minimum width');
  const narrow = { ...layout.root, sizes: [0.2, 0.8] };
  const squeezed = resizeSplit(narrow, narrow.id, 0, -0.1, span);
  assert.equal(squeezed.sizes[0], 0.2, 'a pane already under the minimum does not shrink');
  const grown = resizeSplit(narrow, narrow.id, 0, 0.1, span);
  assert.ok(Math.abs(grown.sizes[0] - 0.3) < 1e-9, 'but it can grow');
});

test('the grip turns into macOS window buttons and unfolds the tiling menu from itself', async () => {
  const controls = await read('components/center-tabs/canvas-controls.tsx');
  for (const light of ['close', 'minimize', 'zoom']) assert.match(controls, new RegExp(`data-pane-light="${light}"`));
  assert.match(controls, /new CustomEvent\("op-close-center-tabs", \{ detail: \{ tabIds: \[tabId\] \} \}\)/, 'red closes the tab through the strip');
  assert.match(controls, /onClick=\{pressed\(\(\) => \{ closeMenu\(\); close\(p\.id\); \}\)\}/, 'yellow folds the pane back into the strip');
  assert.match(controls, /onClick=\{pressed\(\(\) => openAlone\(p\.id, p\.content\)\)\}/, 'green opens the tab on its own');
  assert.match(controls, /onClick=\{pressed\(\(\) => closeTab\(p\.id, p\.content\)\)\}/, 'red closes only on a real click');
  assert.match(controls, /if \(e\.detail > 0 && current\?\.moved\) return; run\(\);/, 'a press that moved never clicks a window button, even after a cancelled drag');
  assert.match(controls, /hoverTimer\.current = window\.setTimeout\(\(\) => openMenu\(p\.id, true\), 250\)/, 'resting on green unfolds the menu');
  assert.match(controls, /\{\(menu\?\.paneId === p\.id \|\| folding === p\.id\) && drawer\(p\.id, menu\?\.paneId !== p\.id\)\}/, 'the menu is attached to its grip and folds back into it when it closes');
  assert.match(controls, /\(quarters \? QUARTERS : MOVE\)/, 'Option shows the quarters');
  assert.doesNotMatch(controls, /Close pane", "关闭格子"\)\}<span/, 'closing moved to the red and yellow buttons');
  const lifecycle = await read('components/center-tabs/use-tab-lifecycle.ts');
  assert.match(lifecycle, /window\.addEventListener\("op-close-center-tabs", onCloseTabs\)/);
  const drag = await read('lib/tabs/canvas-drag.ts');
  assert.match(drag, /closest\("button:not\(\[data-pane-light\]\)"\)/, 'the window buttons drag like the grip');
  assert.match(drag, /started = true;[\s\S]{0,200}grip\.setPointerCapture\(pointerId\)/, 'capture waits for a real drag so a press still clicks');
  const css = await read('components/center-tabs/canvas-controls.module.css');
  assert.match(css, /\.divider\[aria-orientation="vertical"\]::after \{\s*width: 4px;\s*height: 36px;/, 'dividers are a short pill, not a full line');
  const base = await read('app/styles/base.css');
  assert.match(base, /\.app:has\(> \.center-col\[data-split\]\) \.sidebar\.collapsed \{\s*position: relative;/, 'narrow windows keep the rails beside a split');
});

test('a split window is one tab: its focused pane, a split mark and one close', async () => {
  const items = await read('components/center-tabs/tab-items.tsx');
  const css = await read('components/center-tabs/center-tabs.module.css');
  assert.match(items, /<SplitGlyph root=\{group\.canvas\?\.root \?\? rowLayout\(group\.memberIds\)\.root\} current=\{canonicalTab\.id\} \/>/, 'the split in miniature marks the focused pane');
  assert.match(items, /if \(!closing\) onClose\(event, memberTabs\.filter\(\(tab\) => !closingIds\.has\(tab\.id\)\)\);/, 'its close closes the whole window');
  assert.doesNotMatch(items, /memberTabs\.slice\(0, 2\)|canvasPaneCount/, 'no first-two titles and +N count');
  assert.match(css, /\.compoundTab \{[\s\S]*?flex: 0 1 200px;\n  min-width: 48px;/, 'as wide as any other tab');
  assert.match(css, /:global\(html\.is-desktop\) \.tabsFlow > \.tab,\n:global\(html\.is-desktop\) \.tabsFlow > \.compoundTab \{\n  width: 240px;/, 'and as wide as any other tab in the App');
});

test('browsing the overview: empty space is inert and there is no hint', async () => {
  const view = await read('components/center-tabs/canvas-overview.tsx');
  assert.doesNotMatch(view, /dataset\.overviewGrid !== undefined\) dismissOverview\(\)/, 'a click between cards does not open a window');
  assert.match(view, /const hint = mode === "drag" && !landing\n    \? label \|\| text\([\s\S]*?\)\n    : null;/, 'only a drag shows a hint');
});
