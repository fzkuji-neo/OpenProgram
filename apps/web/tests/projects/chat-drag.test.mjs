import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";
const { window } = parseHTML('<html><body></body></html>');
globalThis.window = window;
globalThis.document = window.document;
globalThis.Event = window.Event;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement: h, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { useChatDrag } = await import('../../components/sidebar/sessions-list/use-chat-drag.ts');

test('a chat row dropped on another project moves there; its own project, a cancel and a plain click do nothing', async () => {
  const groups = { a: ['s1', 's2'], b: ['s3'] };
  const moves = [];
  let clicks = 0;
  let last;
  const frames = new Map(); let frameId = 0;
  window.requestAnimationFrame = callback => { frames.set(++frameId, callback); return frameId; };
  window.cancelAnimationFrame = id => frames.delete(id);
  function Harness({ enabled = true }) {
    last = useChatDrag(enabled, (sessionId, projectId) => moves.push([sessionId, projectId]));
    return h('div', { id: 'sidebar', className: 'overflow-y-auto' }, Object.entries(groups).map(([project, chats]) =>
      h('div', { key: project, 'data-project-id': project, 'data-drop-target': last.dropProject === project || undefined },
        h('div', { className: 'header' }, project),
        ...chats.map(id => h('div', { key: id, id, ...last.rowProps(id, `Chat ${id}`, project), role: 'button',
          onClick: event => { last.rowProps(id, `Chat ${id}`, project).onClick(event); if (!event.defaultPrevented) clicks++; } },
          `Chat ${id}`, h('button', {}, '⋮'))))));
  }
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(h(Harness)));
  const scroller = host.firstElementChild;
  scroller.scrollTop = 0;
  scroller.getBoundingClientRect = () => ({ top: 0, bottom: 200, left: 0, right: 200 });
  // Project a fills y 0–100, project b y 100–160.
  host.querySelector('[data-project-id="a"]').getBoundingClientRect = () => ({ top: 0, height: 100 });
  host.querySelector('[data-project-id="b"]').getBoundingClientRect = () => ({ top: 100, height: 60 });
  const row = id => host.querySelector(`#${id}`);
  const capture = new Set();
  for (const id of ['s1', 's2', 's3']) {
    const el = row(id);
    el.setPointerCapture = p => capture.add(p);
    el.hasPointerCapture = p => capture.has(p);
    el.releasePointerCapture = p => capture.delete(p);
  }
  async function fire(id, type, x, y, extra = {}) {
    await act(async () => {
      const event = new window.Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, { button: 0, isPrimary: true, pointerId: 1, clientX: x, clientY: y, detail: 1 }, extra);
      row(id).dispatchEvent(event);
    });
  }
  // Carried from a onto b: b lights up, release moves the chat, the click is swallowed.
  await fire('s1', 'pointerdown', 10, 40);
  await fire('s1', 'pointermove', 10, 42);
  assert.equal(last.draggingChat, null, 'a 2px wiggle is not a drag');
  await fire('s1', 'pointermove', 10, 120);
  assert.deepEqual(last.draggingChat, { id: 's1', label: 'Chat s1', x: 10, y: 120 });
  assert.equal(last.dropProject, 'b');
  assert.ok(host.querySelector('[data-project-id="b"]').hasAttribute('data-drop-target'));
  assert.equal(frames.size, 1, 'edge auto-scroll is armed while dragging');
  await fire('s1', 'pointerup', 10, 120);
  assert.deepEqual(moves, [['s1', 'b']]);
  assert.equal(last.draggingChat, null); assert.equal(last.dropProject, null);
  assert.equal(capture.size, 0); assert.equal(frames.size, 0);
  await fire('s1', 'click', 10, 120); assert.equal(clicks, 0);
  // A plain press and release still opens the chat.
  await fire('s1', 'pointerdown', 10, 40);
  await fire('s1', 'pointerup', 10, 41);
  await fire('s1', 'click', 10, 41); assert.equal(clicks, 1);
  // Over its own project nothing is a target, and a release there moves nothing.
  await fire('s2', 'pointerdown', 10, 60);
  await fire('s2', 'pointermove', 10, 20);
  assert.equal(last.dropProject, null);
  await fire('s2', 'pointerup', 10, 20);
  assert.equal(moves.length, 1);
  for (const cancel of ['Escape', 'blur', 'pointercancel', 'lostpointercapture', 'outside', 'disabled']) {
    await fire('s3', 'pointerdown', 10, 130);
    await fire('s3', 'pointermove', 10, 40);
    assert.equal(last.dropProject, 'a', cancel);
    if (cancel === 'outside') await fire('s3', 'pointerup', 300, 40);
    else if (cancel === 'disabled') await act(async () => root.render(h(Harness, { enabled: false })));
    else if (cancel === 'Escape' || cancel === 'blur') await act(async () => {
      const event = new window.Event(cancel === 'Escape' ? 'keydown' : 'blur');
      event.key = 'Escape'; window.dispatchEvent(event);
    });
    else await fire('s3', cancel, 10, 40);
    assert.equal(moves.length, 1, cancel); assert.equal(last.draggingChat, null, cancel);
    assert.equal(capture.size, 0, cancel); assert.equal(frames.size, 0, cancel);
    if (cancel === 'disabled') await act(async () => root.render(h(Harness)));
  }
  // The row's own button and a secondary pointer never start a drag.
  await act(async () => {
    const event = new window.Event('pointerdown', { bubbles: true });
    Object.assign(event, { button: 0, isPrimary: true, pointerId: 1, clientX: 10, clientY: 40 });
    row('s1').querySelector('button').dispatchEvent(event);
  });
  assert.equal(capture.size, 0);
  await fire('s1', 'pointerdown', 10, 40, { button: 2 }); assert.equal(capture.size, 0);
  await act(async () => root.unmount());
  host.remove();
});
