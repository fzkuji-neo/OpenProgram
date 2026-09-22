import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';
const web = dirname(fileURLToPath(new URL('../../package.json', import.meta.url)));
const dir = await mkdtemp(join(web, '.tab-pointer-test-'));
after(() => rm(dir, {recursive:true, force:true}));
await build({absWorkingDir:web, stdin:{contents:`export { useTabPointerDrag } from './components/center-tabs/use-tab-pointer-drag'; export { useCenterTabs } from './lib/tabs/center-tabs-store';`,resolveDir:web},bundle:true,format:'esm',platform:'node',packages:'external',outfile:join(dir,'test.mjs'),tsconfig:join(web,'tsconfig.json'),plugins:[{name:'services',setup(b){
 b.onResolve({filter:/desktop-bridge$/},()=>({path:'bridge',namespace:'stub'}));
 b.onResolve({filter:/\/i18n$/},()=>({path:'i18n',namespace:'stub'}));
 b.onResolve({filter:/net\/fetch-client/},()=>({path:'fetch',namespace:'stub'}));
 b.onLoad({filter:/.*/,namespace:'stub'},({path})=>({contents:path==='bridge'?`export const desktopBridge=()=>globalThis.bridge; export const buildTransferPayload=()=>({});`:path==='i18n'?`export const useTranslation=()=>({text:(en)=>en});`:`export const jsonFetch=(...args)=>globalThis.attachFetch(...args);`}));
}}]});
const {window}=parseHTML('<html><body></body></html>');
Object.assign(globalThis,{window,document:window.document,HTMLElement:window.HTMLElement,Element:window.Element,CustomEvent:window.CustomEvent,IS_REACT_ACT_ENVIRONMENT:true,requestAnimationFrame:cb=>cb()});
Object.defineProperty(globalThis,'localStorage',{value:{getItem:()=>null,setItem(){},removeItem(){}},configurable:true});
globalThis.CSS={escape:s=>s.replaceAll(':','\\:')};
window.location={pathname:'/s/a'};
window.getComputedStyle=()=>({paddingLeft:'0',paddingRight:'0'});
globalThis.getComputedStyle=window.getComputedStyle;
const {createElement:h,act}=await import('react');
const {createRoot}=await import('react-dom/client');
const {useTabPointerDrag,useCenterTabs}=await import(pathToFileURL(join(dir,'test.mjs')));

test('pointer press preserves current conversation; release activates and drag/cancel suppress clicks',async()=>{
 let hook; const consumed={current:null}; let activated=0; let detached=0; let posts=0;
 globalThis.bridge={windowId:'main',tabTransfer:{prepare:()=> 'token',cancel:async()=>true,windowAtCursor:async()=>null,detach:async()=>{detached++;return 'new';}}};
 globalThis.attachFetch=async()=>{posts++;return {items:[{id:'assoc',resource_id:'page',source:'browser',kind:'web',session_id:'a',conversation_session_id:'a',tab_id:'w:b',title:'B',target:'https://b.test',status:'open'}]};};
 const tabs=[{id:'s:a',kind:'session',sessionId:'a',title:'A'},{id:'w:b',kind:'web',url:'https://b.test',title:'B'}];
 useCenterTabs.setState({tabs,groups:[],activeId:'s:a'});
 const host=document.createElement('div');document.body.append(host);
 const root=createRoot(host);const strip={current:null};const flow={current:null};
 function Harness(){hook=useTabPointerDrag({stripRef:strip,tabsFlowRef:flow,releaseFrozenWidths(){},onTabClick(tab){activated++;useCenterTabs.getState().setActive(tab.id);},suppressedClickRef:consumed,tabMenuRef:{current:null},applyDrop:()=>false,setDragAnnouncement(){}});return h('div',{ref:e=>{strip.current=e;flow.current=e}},tabs.map(tab=>h('div',{key:tab.id,'data-tab-id':tab.id,onPointerDown:e=>hook.onTabPointerDown({kind:'tab',tabIds:[tab.id]},e),onClick:()=>{if(consumed.current===tab.id){consumed.current=null;return;}activated++;useCenterTabs.getState().setActive(tab.id);}},tab.title)));}
 await act(async()=>root.render(h(Harness)));
 const el=host.querySelector('[data-tab-id="w:b"]');
 const rect={left:0,right:800,top:0,bottom:40,width:800,height:40};strip.current.getBoundingClientRect=()=>rect;strip.current.getClientRects=()=>[rect];
 for(const [i,e] of [...flow.current.children].entries()){e.getBoundingClientRect=()=>({...rect,left:i*150,right:(i+1)*150,width:150});e.setPointerCapture=()=>{};e.releasePointerCapture=()=>{};}
 async function fire(type,x=200,y=20){await act(async()=>{const e=new window.Event(type,{bubbles:true,cancelable:true});Object.assign(e,{button:0,buttons:type==='pointerup'?0:1,pointerId:1,clientX:x,clientY:y,screenX:x,screenY:y});el.dispatchEvent(e);});}
 try{
 await fire('pointerdown');assert.equal(useCenterTabs.getState().activeId,'s:a','press must not navigate');assert.equal(activated,0);assert.equal(el.getAttribute('data-pointer-pressed'),'true');
 await fire('pointerup');await fire('click');assert.equal(useCenterTabs.getState().activeId,'w:b');assert.equal(activated,1);
 useCenterTabs.setState({activeId:'s:a'});
 await fire('pointerdown');await fire('pointermove',210,150);assert.equal(useCenterTabs.getState().activeId,'s:a');assert.ok(hook.detachCue);assert.equal(detached,0);await fire('pointerup',210,150);await fire('click');assert.equal(detached,1);assert.equal(useCenterTabs.getState().activeId,'s:a');
 await fire('pointerdown');await fire('pointercancel');await fire('click');assert.equal(useCenterTabs.getState().activeId,'s:a');assert.equal(posts,0);
 const target=document.createElement('div');target.dataset.resourceDropSession='a';target.getBoundingClientRect=()=>({left:700,right:800,top:100,bottom:500,width:100,height:400});document.body.append(target);
 await fire('pointerdown');await fire('pointermove',750,150);assert.equal(target.getAttribute('data-resource-drop-over'),'true');assert.equal(posts,0);assert.equal(hook.detachCue,null);await fire('pointerup',750,150);await fire('click');assert.equal(posts,1);assert.equal(detached,1);assert.equal(useCenterTabs.getState().activeId,'s:a');assert.equal(target.hasAttribute('data-resource-drop-over'),false);
 globalThis.attachFetch=async()=>{posts++;throw new Error('offline');};
 await fire('pointerdown');await fire('pointermove',750,150);await fire('pointerup',750,150);await fire('click');assert.equal(posts,2);assert.equal(detached,1);assert.equal(useCenterTabs.getState().activeId,'s:a');assert.match(hook.resourceDropError,/Could not attach/);
 await fire('pointerdown');await fire('pointermove',750,150);await fire('pointercancel');await fire('click');assert.equal(posts,2);assert.equal(target.hasAttribute('data-resource-drop-over'),false);
 target.remove();
 await fire('pointerdown');await fire('pointerup');await fire('click');assert.equal(useCenterTabs.getState().activeId,'w:b','next genuine click still activates');
 }finally{await act(async()=>root.unmount());host.remove();}
});
