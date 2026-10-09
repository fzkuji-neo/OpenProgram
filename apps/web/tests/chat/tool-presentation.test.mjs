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
