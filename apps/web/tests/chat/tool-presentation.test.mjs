import assert from 'node:assert/strict';
import test from 'node:test';
import { presentTool, summarizeResult } from '../../components/chat/messages/tool-presentation.ts';

const en = (english) => english;

test('commands read as a verb with the first command line', () => {
  const view = presentTool('bash', JSON.stringify({ command: 'npm test\necho done' }), en);
  assert.equal(view.tone, 'shell');
  assert.equal(view.title, 'Ran');
  assert.equal(view.target, 'npm test');
});

test('file tools shorten long paths to their last segments', () => {
  const view = presentTool('edit', JSON.stringify({ path: '/Users/me/project/src/app/page.tsx' }), en);
  assert.equal(view.tone, 'edit');
  assert.equal(view.target, '…/src/app/page.tsx');
});

test('browser tools combine command and url; unknown tools keep their name', () => {
  assert.equal(presentTool('web_use', JSON.stringify({ command: 'observe' }), en).target, 'observe');
  const unknown = presentTool('custom_tool', JSON.stringify({ query: 'abc' }), en);
  assert.equal(unknown.tone, 'function');
  assert.equal(unknown.title, 'custom_tool');
  assert.equal(unknown.target, 'abc');
});

test('raw input that is not JSON still yields a target', () => {
  assert.equal(presentTool('bash', 'ls -la', en).target, 'ls -la');
});

test('every tool glyph is a vendored Solar Bold Duotone icon', async () => {
  const { SOLAR_BODIES } = await import('../../components/solar-icons/bodies.ts');
  assert.equal(presentTool('bash', '{}', en).icon, 'programming');
  assert.equal(presentTool('custom_tool', '{}', en).icon, 'sledgehammer');
  const names = ['bash', 'execute_code', 'edit', 'read', 'list', 'glob', 'grep', 'lsp_definition',
    'web_search', 'web_use', 'image_generate', 'image_analyze', 'send_file', 'agent', 'read_conversation',
    'ask_user_question', 'enter_plan_mode', 'cron', 'program', 'skill', 'resource', 'todo_write',
    'memory_search', 'worktree_create', 'self_update', 'mcp_call', 'custom_tool'];
  for (const name of names) {
    const { icon } = presentTool(name, '{}', en);
    assert.ok(icon in SOLAR_BODIES, `${name} -> ${icon} must be in bodies.ts`);
  }
});

test('JSON results are summarised instead of printed raw', () => {
  assert.equal(summarizeResult('{"ok": true, "title": "Google", "url": "https://google.com"}', en), 'Google · https://google.com');
  assert.equal(summarizeResult('{"ok": false, "error": "timeout"}', en), 'timeout');
  assert.equal(summarizeResult('[1, 2, 3]', en), '3 items');
  assert.equal(summarizeResult('{"ok": true, "pages": [1, 2]}', en), '2 items');
  assert.equal(summarizeResult('plain\nsecond line', en), 'plain');
  assert.equal(summarizeResult('{"frame_id": "f1", "title": "Google", "url": "https://www.google.com/webhp', en), 'Google');
  assert.equal(summarizeResult('{"frame_id": "f1", "nodes": [1, 2', en), 'structured output');
});

test('the public computer_use tool reads as the action in the app; the GUI capability keeps its label', () => {
  const click = presentTool('computer_use', JSON.stringify({ action: 'click', app: 'Calculator', element_index: 20 }), en);
  assert.equal(click.title, 'Clicked in Calculator');
  assert.equal(click.icon, 'monitor');
  assert.equal(presentTool('computer_use', JSON.stringify({ action: 'press_key', app: 'Notes', key: 'super+c' }), en).target, 'super+c');
  assert.equal(presentTool('computer_use', JSON.stringify({ action: 'list_apps' }), en).title, 'Listed apps');
  const menu = presentTool('computer_use', JSON.stringify({ action: 'menu', app: 'Notes', menu_path: ['File', 'Export as PDF…'] }), en);
  assert.equal(menu.title, 'Used the menu in Notes');
  assert.equal(menu.target, 'File › Export as PDF…');
  const batch = presentTool('computer_use', JSON.stringify({ action: 'batch', app: 'Notes', actions: [{ action: 'click' }, { action: 'type_text' }] }), en);
  assert.equal(batch.title, 'Ran steps in Notes');
  assert.equal(batch.target, '2 steps');
  const capability = presentTool('computer_use', JSON.stringify({ task: 'inspect', app_name: 'TextEdit' }), en);
  assert.equal(capability.title, 'Computer Use');
  assert.equal(capability.target, 'TextEdit');
});

test('web_use shows the nested act action rather than the command', () => {
  assert.equal(presentTool('web_use', JSON.stringify({ command: 'act', arguments: { action: 'drag', ref: 'e1', to_ref: 'e2' } }), en).target, 'drag');
  assert.equal(presentTool('web_use', JSON.stringify({ command: 'observe', arguments: { url: 'https://example.com' } }), en).target, 'observe https://example.com');
});
