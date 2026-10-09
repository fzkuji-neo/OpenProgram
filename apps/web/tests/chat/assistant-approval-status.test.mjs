import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const web = dirname(fileURLToPath(new URL('../../package.json', import.meta.url)));
const dir = await mkdtemp(join(web, '.approval-status-'));
after(() => rm(dir, { recursive: true, force: true }));
const file = join(dir, 'bubble.mjs');
await build({
  absWorkingDir: web, entryPoints: ['components/chat/messages/assistant-bubble.tsx'],
  external: ['react'], bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', outfile: file,
  plugins: [{ name: 'bubble-services', setup(b) {
    b.onResolve({ filter: /^(@\/|\.\/)/ }, a => a.importer.endsWith('assistant-bubble.tsx') && !['@/lib/format-utils/format','./activity-indicator'].includes(a.path) ? { path: a.path, namespace: 'stub' } : null);
    b.onLoad({ filter: /.*/, namespace: 'stub' }, a => ({ resolveDir: web, contents:
      a.path.includes('session-store') ? 'export const useSessionStore = selector => selector(globalThis.approvalState);' :
      a.path.includes('agent-style') ? 'export const agentColor=()=>"", agentInitial=()=>"", agentDisplayName=()=>"Agent", useAgentProfile=()=>({name:"Agent"});' :
      a.path.includes('i18n') ? 'export const useTranslation=()=>({text:(en)=>en});' :
      a.path.includes('use-avatar-align') ? 'export const useAvatarAlign=()=>({containerRef:null,avatarTop:0});' :
      a.path.endsWith('/markdown') ? 'export const useMarkdownReady=()=>{}, renderMarkdown=t=>t;' :
      a.path.includes('markdown-render') ? 'export const typesetMath=()=>{};' :
      a.path.includes('user-attachments') ? 'export const parseAttachments=text=>({attachments:[],text}), AttachmentChips=()=>null;' :
      a.path.includes('turn-files-presentation') ? 'export const shouldRenderTurnFiles=()=>false;' :
      a.path.includes('assistant-file-cards') ? 'export const AssistantFileCards=()=>null;' :
      'import {createElement} from "react"; export const Avatar=()=>null, UserBubble=()=>null, AttachCard=()=>null, ExecutionStrip=({children,streaming})=>createElement("section",{"data-active":String(!!streaming)},children), summarizeToolGroup=()=>({label:"",failed:0,added:null,removed:null}), FunctionStep=()=>null, StepRow=()=>null, SPAWNING_TOOL_NAMES=new Set(), SubAgentStep=()=>null, ThinkingStep=({text})=>text, MessageActions=()=>null, MessageTimestamp=()=>null, RuntimeBlock=()=>null, TurnFilesChips=()=>null;'
    }));
  }}],
});
const { AssistantBubble } = await import(pathToFileURL(file));
const decision = { kind:'approval', sessionId:'s1', executionId:'e1' };
const order = { sessionId:'s1', messageIds:['m1'], terminal:false };
function render(decisions, orders, sessionId='s1', messageId='m1') {
  globalThis.approvalState={currentSessionId:sessionId,pendingDecisions:decisions,executionUpdateOrders:orders};
  return renderToStaticMarkup(createElement(AssistantBubble,{msg:{id:messageId,content:'',status:'running'},sessionIdOverride:sessionId}));
}
test('only the canonical approval owner shows a waiting status, removed on resolution', () => {
  assert.match(render([decision],{e1:order}), /Waiting for approval/);
  assert.doesNotMatch(render([],{e1:order}), /Waiting for approval/);
  assert.doesNotMatch(render([decision],{e1:order},'s1','old-message'), /Waiting for approval/);
  assert.doesNotMatch(render([decision],{e1:order},'s2'), /Waiting for approval/);
  assert.doesNotMatch(render([decision],{e1:{...order,sessionId:'s2'}}), /Waiting for approval/);
  assert.doesNotMatch(render([decision],{e1:{...order,terminal:true}}), /Waiting for approval/);
  assert.doesNotMatch(render([{...decision,kind:'ask'}],{e1:order}), /Waiting for approval/);
  assert.doesNotMatch(render([decision],{}), /Waiting for approval/);
});

test('a failed assistant retains the streamed text alongside the error notice', () => {
  globalThis.approvalState={currentSessionId:'s1',pendingDecisions:[],executionUpdateOrders:{}};
  const html = renderToStaticMarkup(createElement(AssistantBubble,{msg:{
    id:'failed', role:'assistant', status:'error', content:'provider disconnected',
    blocks:[{type:'thinking',text:'Checking evidence'},{type:'text',text:'Partial response'}],
  },sessionIdOverride:'s1'}));
  assert.match(html, /Checking evidence/);
  assert.match(html, /Partial response/);
  assert.match(html, /provider disconnected/);
});

function renderBlocks(blocks, status='running', usage) {
  globalThis.approvalState={currentSessionId:'s1',pendingDecisions:[],executionUpdateOrders:{}};
  return renderToStaticMarkup(createElement(AssistantBubble,{msg:{id:'m1',role:'assistant',status,blocks,usage},sessionIdOverride:'s1'}));
}
test('only the final active execution segment animates and text ends that animation', () => {
  const blocks=[{type:'thinking',text:'Earlier'},{type:'text',text:'Update'},{type:'thinking',text:'Current'}];
  assert.deepEqual([...renderBlocks(blocks).matchAll(/data-active="(true|false)"/g)].map(m=>m[1]),['false','true']);
  assert.doesNotMatch(renderBlocks([...blocks,{type:'text',text:'Answer'}]), /data-active="true"/);
  assert.doesNotMatch(renderBlocks(blocks,'done'), /data-active="true"/);
});
test('assistant replies do not display the usage footer', () => {
  assert.doesNotMatch(renderBlocks([{type:'text',text:'Answer'}],'done',{input_tokens:89000,output_tokens:327,service_tiers:['priority']}), /runtime-usage-footer|Fast served|89.0k/);
});

test('only the original empty reply placeholder has the new logo', () => {
  assert.match(renderBlocks([]), /class="activity-indicator activity-thinking"/);
  assert.doesNotMatch(renderBlocks([{type:'thinking',text:'Current'}]), /class="activity-indicator/);
  assert.doesNotMatch(renderBlocks([{type:'text',text:'Answer'}]), /class="activity-indicator/);
  globalThis.approvalState={currentSessionId:'s1',pendingDecisions:[],executionUpdateOrders:{}};
  const activeTool=renderToStaticMarkup(createElement(AssistantBubble,{msg:{
    id:'m1',role:'assistant',status:'running',content:'Update',
    tools:[{id:'t1',tool:'search',status:'running'}],
    blocks:[{type:'text',text:'Update'},{type:'tool',tool:'search',tool_call_id:'t1'}],
  }}));
  assert.doesNotMatch(activeTool, /class="activity-indicator/);
  for (const status of ['done','error','cancelled','interrupted']) {
    assert.doesNotMatch(renderBlocks([{type:'thinking',text:'Current'}],status), /class="activity-indicator/);
  }
  assert.doesNotMatch(render([decision],{e1:order}), /class="activity-indicator/);
});

test('live tools suppress motion alongside text and retry keeps its status label', () => {
  globalThis.approvalState={currentSessionId:'s1',pendingDecisions:[],executionUpdateOrders:{}};
  const msg={id:'m1',role:'assistant',status:'running',content:'Update',
    tools:[{id:'t1',tool:'search',status:'running'}],
    blocks:[{type:'tool',tool:'search',tool_call_id:'t1'},{type:'text',text:'Update'}]};
  const html=renderToStaticMarkup(createElement(AssistantBubble,{msg}));
  assert.doesNotMatch(html, /class="activity-indicator/);
  assert.doesNotMatch(html, /class="activity-indicator/);
  const parallelThinking=renderToStaticMarkup(createElement(AssistantBubble,{msg:{...msg,
    blocks:[...msg.blocks,{type:'thinking',text:'Current'}]}}));
  assert.equal([...parallelThinking.matchAll(/data-active="true"/g)].length,1);
  const retry=renderToStaticMarkup(createElement(AssistantBubble,{msg:{...msg,retryStatus:{attempt:2,reason:'transport'}}}));
  assert.match(retry,/Retrying 2/);
  assert.doesNotMatch(retry,/class="activity-indicator/);
  const modelRetry=renderToStaticMarkup(createElement(AssistantBubble,{msg:{id:"m1",role:"assistant",status:"running",retryStatus:{attempt:2}}}));
  assert.doesNotMatch(modelRetry,/class="activity-indicator/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(AssistantBubble,{msg:{...msg,status:'cancelled'}})),/class="activity-indicator/);
});

test('the owning terminal execution stops activity even when the last message flag trails completion', () => {
  const msg={id:'m1',role:'assistant',status:'streaming',content:'',blocks:[]};
  const htmlFor=executionOrder=>{
    globalThis.approvalState={currentSessionId:'s1',pendingDecisions:[],executionUpdateOrders:{e1:executionOrder}};
    return renderToStaticMarkup(createElement(AssistantBubble,{msg,sessionIdOverride:'s1'}));
  };
  assert.doesNotMatch(htmlFor({...order,terminal:true}),/class="activity-indicator/);
  assert.match(htmlFor(order),/class="activity-indicator/);
  assert.match(htmlFor({...order,terminal:true,sessionId:'s2'}),/class="activity-indicator/);
  assert.match(htmlFor({...order,terminal:true,messageIds:['old-message']}),/class="activity-indicator/);
});

for (const [status,label] of [['cancelled','Cancelled'],['interrupted','Interrupted']]) {
  test(`${status} empty and partial replies show terminal status`, () => {
    for (const blocks of [[],[{type:'text',text:'Saved partial reply'}]]) {
      const html=renderBlocks(blocks,status);
      assert.match(html, new RegExp(label));
      assert.doesNotMatch(html, /data-active="true"|typing-indicator/);
      if (blocks.length) assert.match(html,/Saved partial reply/);
    }
    assert.doesNotMatch(renderBlocks([],'done'),new RegExp(label));
  });
}
