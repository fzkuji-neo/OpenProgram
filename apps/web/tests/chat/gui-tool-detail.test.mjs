import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import { presentTool } from '../../components/chat/messages/tool-presentation.ts';
import { guiToolView, guiStatus, recordedScreenshot } from '../../components/chat/messages/gui-tool-view.ts';
import { summarizeToolGroup } from '../../components/chat/messages/tool-group-summary.ts';

const web = dirname(fileURLToPath(new URL('../../package.json', import.meta.url)));
const dir = await mkdtemp(join(web, '.gui-detail-'));
after(() => rm(dir, { recursive: true, force: true }));
const file = join(dir, 'detail.mjs');
await build({
  absWorkingDir: web, entryPoints: ['components/right-sidebar/detail-panel.tsx'],
  bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', outfile: file,
  loader: { '.css': 'empty' },
  plugins: [{ name: 'detail-services', setup(b) {
    b.onResolve({ filter: /session-store$|i18n$|\/markdown$|llm-node-content$|attachment-preview$/ }, a => ({ path: a.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, a => ({ resolveDir: web, contents:
      a.path.includes('session-store') ? 'export const useSessionStore = s => s(globalThis.guiDetailState);' :
      a.path.endsWith('i18n') ? 'export const useTranslation=()=>({text:(en)=>en,t:k=>k});' :
      a.path.endsWith('markdown') ? 'export const useMarkdownReady=()=>{}, renderMarkdown=t=>t;' :
      a.path.endsWith('attachment-preview') ? 'import {createElement} from "react"; export const AttachmentPreview=p=>createElement("div",{"data-preview-session":p.sessionId,"data-preview-path":p.path});' :
      'export const LlmNodeContent=()=>null;'
    }));
  }}],
});
const { DetailPanel } = await import(pathToFileURL(file));
const en = s => s;
const output = {
  status: 'infeasible', blocker: 'Window closed', handoff_instruction: 'Reopen TextEdit',
  history: [{type: 'capability_call', step: 1, capability: 'computer_use', input: {app_name: 'TextEdit'},
    output: {status: 'applied', success: true, step: {plan: {call: 'window_press'}, screenshot_artifact: '/tmp/recorded.png'}}}],
};
function render(value = output, extra = {}) {
  globalThis.guiDetailState = { currentSessionId: 'unrelated', detailNode: {
    path: 'gui-call', name: 'gui_agent', status: 'completed', session_id: 'owner',
    output: JSON.stringify(value), ...extra,
  }};
  return renderToStaticMarkup(createElement(DetailPanel));
}

test('GUI calls identify the task in the public tool presentation', () => {
  assert.equal(presentTool('gui_agent', JSON.stringify({task: 'Inspect TextEdit'}), en).title, 'GUI Agent');
  assert.equal(presentTool('gui_agent', JSON.stringify({task: 'Inspect TextEdit'}), en).target, 'Inspect TextEdit');
});

test('Details renders recorded GUI steps and handoff without opening an image', () => {
  const html = render();
  assert.match(html, /aria-label="GUI activity"/);
  assert.match(html, /Needs takeover/);
  assert.match(html, /Reopen TextEdit/);
  assert.match(html, /Computer Use/);
  assert.match(html, /Open recorded screenshot/);
  assert.doesNotMatch(html, /<img/);
});

test('history is ordered and takes precedence over duplicated capability children', () => {
  const history = ['computer_use', 'browser_use', 'vm_use'].map((capability, step) => ({
    type: 'capability_call', capability, step: step + 1, output: { status: 'applied', success: true },
  }));
  const view = guiToolView({ name: 'gui_agent', status: 'completed', output: {history},
    tree_root: {children: [{name: 'computer_use', output: {status: 'applied'}}]} });
  assert.deepEqual(view.steps.map(step => step.capability), ['computer_use', 'browser_use', 'vm_use']);
  assert.equal(view.status, 'unknown', 'completed function is not a verified task');
});

test('running calls use visible capability results without duplicating nested planners', () => {
  const view = guiToolView({ name: 'gui_agent', status: 'running', tree_root: {children: [
    { name: 'computer_use', status: 'completed', params: {app_name: 'TextEdit'},
      output: {status:'applied',success:true}, children:[{name:'computer_use'}] },
    { name: 'browser_use', status: 'running', params: {url: 'https://example.com'} },
    { name: 'vm_use', expose: 'hidden' },
  ]} });
  assert.equal(view.status, 'running');
  assert.deepEqual(view.steps.map(s => s.status), ['applied', 'running']);
  assert.equal(view.steps[0].target, 'TextEdit');
});

test('failure, cancellation and takeover do not become successful completion', () => {
  assert.equal(guiStatus({status: 'applied', success: false}), 'failed');
  assert.equal(guiStatus({status: 'succeeded'}, 'cancelled'), 'cancelled');
  assert.equal(guiStatus({status: 'infeasible', success: false}), 'infeasible');
  assert.equal(guiStatus({success: true}, 'completed'), 'unknown');
  const view = guiToolView({name:'computer_use',status:'completed',output:{status:'applied',step:{exec_result:{success:false,error:'Control unavailable'}}}});
  assert.equal(view.status, 'failed');
  assert.equal(view.summary, 'Control unavailable');
});

test('malformed, truncated and unrelated results keep raw details without false steps', () => {
  assert.equal(guiToolView({name:'custom_tool',status:'completed',output}), null);
  for (const output of ['{"history":[', 'plain text', 'null', '[]', undefined]) {
    const view = guiToolView({name:'gui_agent',status:'completed',output});
    assert.equal(view.status, 'unknown');
    assert.equal(view.steps.length, 0);
  }
  assert.doesNotMatch(render(output, {name:'custom_tool'}), /aria-label="GUI activity"/);
});

test('screenshots require a local image path and explicit original session', () => {
  for (const path of ['https://example.com/a.png','//example.com/a.png','data:image/png;base64,AAA','/tmp/a.svg','/tmp/a.png\n','relative.png']) {
    assert.equal(recordedScreenshot(path), undefined, path);
  }
  assert.equal(recordedScreenshot('/tmp/a\nb.png'), undefined);
  assert.equal(recordedScreenshot('/tmp/a.png'), '/tmp/a.png');
  assert.equal(recordedScreenshot('C:\\shots\\a.png'), 'C:\\shots\\a.png');
  assert.doesNotMatch(render(output, {session_id:undefined}), /Open recorded screenshot/);
  assert.doesNotMatch(render({...output,blocker:'<script>alert(1)</script>'}), /<script>/);
});

test('screenshot click keeps its source conversation and selection changes close it', async () => {
  const {window} = parseHTML('<html><body><div id="root"></div></body></html>');
  const oldWindow=globalThis.window, oldDocument=globalThis.document, oldAct=globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.window=window; globalThis.document=window.document; globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  const root=createRoot(window.document.getElementById('root'));
  try {
    render();
    await act(async()=>root.render(createElement(DetailPanel)));
    assert.equal(window.document.querySelector('[data-preview-session]'),null);
    const button=[...window.document.querySelectorAll('button')].find(b=>b.textContent==='Open recorded screenshot');
    assert.ok(button);
    await act(async()=>button.click());
    assert.equal(window.document.querySelector('[data-preview-session]').getAttribute('data-preview-session'),'owner');
    assert.equal(window.document.querySelector('[data-preview-path]').getAttribute('data-preview-path'),'/tmp/recorded.png');
    globalThis.guiDetailState.detailNode={...globalThis.guiDetailState.detailNode,path:'another-call',session_id:'another-owner'};
    await act(async()=>root.render(createElement(DetailPanel)));
    assert.equal(window.document.querySelector('[data-preview-session]'),null);
  } finally {
    await act(async()=>root.unmount());
    globalThis.window=oldWindow;globalThis.document=oldDocument;globalThis.IS_REACT_ACT_ENVIRONMENT=oldAct;
  }
});

test('GUI activity participates in collapsed conversation summaries', () => {
  const block = {type:'tool',tool:'gui_agent',tool_call_id:'g1'};
  assert.equal(summarizeToolGroup([block],{text:en}).label,'Ran a GUI call');
  assert.equal(summarizeToolGroup([block],{text:en,active:true,runningIds:new Set(['g1'])}).label,'Running a GUI call…');
});
