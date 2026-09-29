import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';
const web = dirname(fileURLToPath(new URL('../../package.json', import.meta.url)));
const dir = await mkdtemp(join(web, '.sidebar-focus-'));
after(() => rm(dir, { recursive: true, force: true }));
const stubs = {
  'next/navigation': 'export const usePathname=()=>"/s/a";',
  '@/lib/i18n': 'export const useTranslation=()=>({t:x=>x,text:x=>x});',
  '@/lib/net/ws-request': 'export const wsRequest=(...args)=>globalThis.sidebarRequest(...args);',
  '../session-resources/session-resources-panel': 'export const SessionResourcesPanel=()=>null;',
  './context-commit-timeline': 'export const ContextCommitTimeline=()=>null;',
  '../animated-icons': 'import {forwardRef} from "react"; const Icon=forwardRef(()=>null); export const ActivityIcon=Icon,BoxIcon=Icon,FolderOpenIcon=Icon,PanelLeftCloseIcon=Icon,PanelLeftOpenIcon=Icon;',
  '../files/file-tree': 'import React from "react"; export const FileTree=({projectId})=>React.createElement("output",{"data-project":projectId},projectId);',
  './running-panel': 'import React from "react"; export const RunningPanel=({sessionId})=>React.createElement("output",{"data-activity":sessionId},sessionId);',
  '../layout/use-resizable-rail': 'export const useResizableRail=()=>({style:{},resizeHandleProps:{}});',
  './detail-panel': 'export const DetailPanel=()=>null,SessionViewSwitch=()=>null,VIEW_CONTEXT="context",VIEW_DETAIL="detail";',
};
await build({ absWorkingDir:web, stdin:{contents:`export {RightSidebar} from './components/right-sidebar/right-sidebar'; export {useCenterTabs} from './lib/tabs/center-tabs-store'; export {useSessionStore} from './lib/session-store';`,resolveDir:web},bundle:true,format:'esm',platform:'node',packages:'external',jsx:'automatic',outfile:join(dir,'test.mjs'),tsconfig:join(web,'tsconfig.json'),loader:{'.css':'empty'},plugins:[{name:'fixtures',setup(b){ b.onResolve({filter:/.*/},a=>a.path in stubs ? {path:a.path,namespace:'fixture'}:null);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:stubs[a.path],resolveDir:web})); }}] });
const {window}=parseHTML('<html><body></body></html>');
Object.assign(globalThis,{window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
globalThis.localStorage={getItem:()=>null,setItem(){},removeItem(){}};
window.location={pathname:'/s/a'};
window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
const {act,createElement}=await import('react');
const {createRoot}=await import('react-dom/client');
const {RightSidebar,useCenterTabs,useSessionStore}=await import(pathToFileURL(join(dir,'test.mjs')));

test('canvas focus switches activity and project without waiting for the legacy route',async()=>{
  const requests=[];
  globalThis.sidebarRequest=(action,args,_type,_match,_timeout,options)=>new Promise(resolve=>requests.push({action,args,options,resolve}));
  const a={id:'s:a',kind:'session',sessionId:'a',title:'A'};
  const b={id:'s:b',kind:'session',sessionId:'b',title:'B'};
  useCenterTabs.setState({tabs:[a,b],activeId:a.id,groups:[{id:'g',memberIds:[a.id,b.id],visibleIds:[a.id,b.id],focusedId:a.id,canvas:{focusedPaneId:'pa',root:{kind:'split',id:'row',dir:'row',sizes:[0.5,0.5],children:[{kind:'pane',id:'pa',content:a.id},{kind:'pane',id:'pb',content:b.id}]}}}]});
  useSessionStore.setState({currentSessionId:'a',activeChatKey:'a'});
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  const reply=(request,id)=>request.resolve({session_id:request.args.session_id,current_project_id:id,projects:[{id,path:`/${id}`,name:id}]});
  try {
    await act(async()=>root.render(createElement(RightSidebar)));
    assert.equal(host.querySelector('[data-activity]').getAttribute('data-activity'),'a');
    await act(async()=>reply(requests.at(-1),'project-a'));
    assert.equal(host.querySelector('[data-project]').getAttribute('data-project'),'project-a');
    await act(async()=>useCenterTabs.getState().setActive(b.id));
    assert.equal(useSessionStore.getState().currentSessionId,'a','legacy session deliberately stays unchanged');
    assert.equal(host.querySelector('[data-activity]').getAttribute('data-activity'),'b');
    assert.equal(host.querySelector('[data-project]'),null,'do not show the previous conversation project');
    assert.equal(requests.at(-1).args.session_id,'b');
    const pendingB=requests.at(-1);
    await act(async()=>useCenterTabs.getState().setActive(a.id));
    await act(async()=>{reply(pendingB,'project-b');reply(requests.at(-1),'project-a');});
    assert.equal(host.querySelector('[data-activity]').getAttribute('data-activity'),'a');
    assert.equal(host.querySelector('[data-project]').getAttribute('data-project'),'project-a','late B response must not replace A');
  } finally {await act(async()=>root.unmount());host.remove();}
});
