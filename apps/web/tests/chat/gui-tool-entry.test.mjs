import assert from 'node:assert/strict';
import test, {after} from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {parseHTML} from 'linkedom';
import {guiToolView} from '../../components/chat/messages/execution/gui-tool-view.ts';
const web=dirname(fileURLToPath(new URL('../../package.json',import.meta.url)));
const dir=await mkdtemp(join(web,'.gui-entry-'));
after(()=>rm(dir,{recursive:true,force:true}));
const file=join(dir,'entry.mjs');
const mocks={
  '@/lib/session-store': 'export const useSessionStore=s=>s(globalThis.guiEntryStore);useSessionStore.getState=()=>globalThis.guiEntryStore;',
  '@/lib/i18n': 'export const useTranslation=()=>({text:(en)=>en});',
  '@/components/solar-icons': 'export const SolarIcon=()=>null;',
  '@/lib/execution-stream': 'export const useExecutionStreamStore=s=>s({byNodeId:{}}),streamPreviewForNode=()=>({});',
  '@/lib/net/tool-output': 'export const fetchFullToolOutput=(...args)=>globalThis.guiFetch(...args);',
  '@/lib/runtime-bridge/state': 'export const getSocket=()=>null;',
  '@/lib/runtime-bridge/session-load': 'export const sendRuntimeCommand=()=>false;',
  '@/components/plugins/plugin-slot': 'export const PluginSlot=()=>null;',
  './llm-node-content': 'export const LlmNodeContent=()=>null;',
  '../bubbles/markdown': 'export const renderMarkdown=t=>t,useMarkdownReady=()=>{};',
  '../bubbles/message-actions': 'export const MessageTimestamp=()=>null;',
};
await build({absWorkingDir:web,entryPoints:['components/chat/messages/execution/execution-strip.tsx'],outfile:file,
  bundle:true,packages:'external',platform:'node',format:'esm',jsx:'automatic',plugins:[{name:'services',setup(b){
    b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:null);
    b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],resolveDir:web}));
  }}]});
const {FunctionStep,TreeStep}=await import(pathToFileURL(file));
async function mount(run){
  const {window}=parseHTML('<html><body><main id="root"></main></body></html>');
  const before={window:globalThis.window,document:globalThis.document,act:globalThis.IS_REACT_ACT_ENVIRONMENT};
  Object.assign(globalThis,{window,document:window.document,IS_REACT_ACT_ENVIRONMENT:true});
  const store={currentSessionId:'wrong-session',llmContentOpen:{},showDetail:n=>{store.detailNode=n;},populateDetail:n=>{store.detailNode=n;}};
  globalThis.guiEntryStore=store;
  const root=createRoot(window.document.getElementById('root'));
  try{await run({store,root,document:window.document});}finally{
    await act(async()=>root.unmount());
    Object.assign(globalThis,{window:before.window,document:before.document,IS_REACT_ACT_ENVIRONMENT:before.act});
  }
}
test('model-call entry supplies its tree, owner and subsequent result to selected details',async()=>mount(async({root,document,store})=>{
  const block={type:'tool',tool:'gui_agent',tool_call_id:'g1',input:'{"task":"Inspect window"}'};
  const tree={name:'gui_agent',children:[{name:'computer_use',status:'running'}]};
  await act(async()=>root.render(createElement(FunctionStep,{block,tree,running:true,sessionId:'owner'})));
  await act(async()=>document.querySelector('.tl-step-link').click());
  assert.equal(store.detailNode.session_id,'owner');
  assert.equal(guiToolView(store.detailNode).steps[0].status,'running');
  await act(async()=>root.render(createElement(FunctionStep,{block:{...block,result:'{"status":"infeasible","handoff_instruction":"Reopen app"}'},tree,running:false,sessionId:'owner'})));
  assert.equal(guiToolView(store.detailNode).handoff,'Reopen app');
  assert.equal(store.detailNode.status,'completed');
  store.detailNode={path:'different'};
  await act(async()=>root.render(createElement(FunctionStep,{block:{...block,result:'{"status":"succeeded"}'},tree,running:false,sessionId:'owner'})));
  assert.equal(store.detailNode.path,'different');
}));
test('manual tree entry preserves structured output and source conversation',async()=>mount(async({root,document,store})=>{
  const node={path:'manual',name:'computer_use',status:'completed',params:{app_name:'TextEdit'},output:{status:'applied',success:true,step:{plan:{call:'window_press'}}}};
  await act(async()=>root.render(createElement(TreeStep,{node,sessionId:'manual-owner'})));
  await act(async()=>document.querySelector('.tl-step-link').click());
  assert.equal(store.detailNode.session_id,'manual-owner');
  assert.equal(guiToolView(store.detailNode).status,'applied');
  assert.doesNotMatch(store.detailNode.output,/\[object Object\]/);
}));
test('full-output loading does not replace another selected call',async()=>mount(async({root,document,store})=>{
  let resolve;
  globalThis.guiFetch=(session)=>{assert.equal(session,'owner');return new Promise(r=>{resolve=r;});};
  const block={type:'tool',tool:'gui_agent',tool_call_id:'g1',node_id:'n1',message_id:'m1',truncated:true,result:'{"history":['};
  await act(async()=>root.render(createElement(FunctionStep,{block,sessionId:'owner'})));
  await act(async()=>document.querySelector('.tl-step-link').click());
  assert.equal(store.detailNode.status,'running');
  store.detailNode={path:'different'};
  await act(async()=>resolve({result:'{"status":"succeeded"}'}));
  assert.equal(store.detailNode.path,'different');
}));

test('full-output failure remains visible and a later click can retry',async()=>mount(async({root,document,store})=>{
  globalThis.guiFetch=async()=>({error:'Result no longer available'});
  const block={type:'tool',tool:'gui_agent',tool_call_id:'g1',node_id:'n1',message_id:'m1',truncated:true,result:'{"history":['};
  await act(async()=>root.render(createElement(FunctionStep,{block,sessionId:'owner'})));
  await act(async()=>document.querySelector('.tl-step-link').click());
  assert.equal(store.detailNode.error,'Result no longer available');
  assert.equal(store.detailNode.status,'completed','a failed fetch is not a failed tool call');
  globalThis.guiFetch=async()=>({result:{status:'infeasible',handoff_instruction:'Open app'}});
  await act(async()=>document.querySelector('.tl-step-link').click());
  assert.equal(store.detailNode.error,undefined);
  assert.equal(guiToolView(store.detailNode).status,'infeasible');
}));
