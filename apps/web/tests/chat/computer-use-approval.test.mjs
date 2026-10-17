import assert from 'node:assert/strict';
import test from 'node:test';
import { computerUseStep, readsWhat, setArgs } from '../../components/chat/composer/modes/question/computer-use-step.ts';
import { computerUseRuleApp } from '../../lib/computer-use-rule.ts';

const zh = (_english, chinese) => chinese;

test('an approval names the one step it covers', () => {
  assert.deepEqual(computerUseStep({ action: 'get_app_state', app: 'Calculator' }, zh), { verb: '读取窗口内容', target: '' });
  assert.deepEqual(computerUseStep({ action: 'click', element_index: 7 }, zh), { verb: '点击', target: '元素 #7' });
  assert.deepEqual(computerUseStep({ action: 'click', x: 10, y: 20, click_count: 2 }, zh), { verb: '双击', target: '(10, 20)' });
  assert.deepEqual(computerUseStep({ action: 'type_text', text: '你好 world' }, zh), { verb: '输入', target: '8 个字' });
  assert.deepEqual(computerUseStep({ action: 'menu', menu_path: ['显示', '科学型'] }, zh), { verb: '选择菜单', target: '显示 › 科学型' });
  assert.deepEqual(computerUseStep({ action: 'batch', actions: [{}, {}, {}, {}] }, zh), { verb: '连续执行', target: '4 步' });
});

test('a read says what it returns, and details drop empty arguments', () => {
  assert.equal(readsWhat({ action: 'get_app_state' }, zh), '截图 + 界面元素');
  assert.equal(readsWhat({ action: 'get_app_state', include: 'tree' }, zh), '界面元素');
  assert.equal(readsWhat({ action: 'click' }, zh), '');
  assert.deepEqual(setArgs({ action: 'click', app: 'Notes', x: null, text: '', actions: [], element_index: 0 }),
    { action: 'click', app: 'Notes', element_index: 0 });
});

test('only computer_use rules that name an app belong to the apps section', () => {
  assert.equal(computerUseRuleApp('computer_use(calculator)'), 'calculator');
  assert.equal(computerUseRuleApp(' computer_use( google chrome ) '), 'google chrome');
  assert.equal(computerUseRuleApp('computer_use'), null);
  assert.equal(computerUseRuleApp('bash(git:*)'), null);
});
