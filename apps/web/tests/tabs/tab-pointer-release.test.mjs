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
await build({absWorkingDir:web, stdin:{contents:`export { startPaneDrag } from './lib/tabs/canvas-drag'; export { useTabPointerDrag } from './components/center-tabs/use-tab-pointer-drag'; export { useCenterTabs } from './lib/tabs/center-tabs-store'; export { useSessionStore } from './lib/session-store';`,resolveDir:web},bundle:true,format:'esm',platform:'node',packages:'external',outfile:join(dir,'test.mjs'),tsconfig:join(web,'tsconfig.json'),plugins:[{name:'services',setup(b){
 b.onResolve({filter:/desktop-bridge$/},()=>({path:'bridge',namespace:'stub'}));
 b.onResolve({filter:/\/i18n$/},()=>({path:'i18n',namespace:'stub'}));
 b.onResolve({filter:/net\/fetch-client/},()=>({path:'fetch',namespace:'stub'}));
 b.onLoad({filter:/.*/,namespace:'stub'},({path})=>({contents:path==='bridge'?`export const desktopBridge=()=>globalThis.bridge; export const buildTransferPayload=()=>({});`:path==='i18n'?`export const useTranslation=()=>({text:(en)=>en}); export const translateText=(en)=>en;`:`export const jsonFetch=(...args)=>globalThis.attachFetch(...args);`}));
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
const {startPaneDrag,useTabPointerDrag,useCenterTabs,useSessionStore}=await import(pathToFileURL(join(dir,'test.mjs')));

function assertResourcesCue() {
 const cue=document.querySelector('.canvas-drop-preview[data-drop-target="resources"]');
 assert.ok(cue,'Resources shows the same visible drop preview as canvas docking');
 assert.match(cue.textContent,/Release to add to Resources/);
 return cue;
}

test('pointer press preserves current conversation; release activates and drag/cancel suppress clicks',async()=>{
 let hook; const consumed={current:null}; let activated=0; let detached=0; let posts=0;
 globalThis.bridge={windowId:'main',tabTransfer:{prepare:()=> 'token',cancel:async()=>true,windowAtCursor:async()=>null,detach:async()=>{detached++;return 'new';}}};
 globalThis.attachFetch=async()=>{posts++;return {items:[{id:'assoc',resource_id:'page',source:'browser',kind:'web',session_id:'a',conversation_session_id:'a',tab_id:'w:b',title:'B',target:'https://b.test',status:'open'}]};};
 const tabs=[{id:'s:a',kind:'session',sessionId:'a',title:'A'},{id:'w:b',kind:'web',url:'https://b.test',title:'B'}];
 useCenterTabs.setState({tabs,groups:[],activeId:'s:a'});
 const host=document.createElement('div');document.body.append(host);
 const target=document.createElement('div');
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
 await fire('pointerdown');await fire('pointermove',210,150);
 const preview=document.querySelector('[data-tab-drag-preview]');
 assert.ok(preview, 'leaving strip must show a floating tab');
 assert.equal(preview.parentElement,document.body,'preview escapes clipping ancestors');
 assert.equal(preview.textContent,'B');
 assert.equal(preview.style.position,'fixed');
 assert.equal(preview.style.transform,'translate(10px, 130px)');
 assert.equal(el.style.visibility,'hidden','only one tab copy is visible');
 assert.equal(document.querySelectorAll('[data-tab-id="w:b"]').length,1);
 await fire('pointermove',220,20);
 assert.equal(document.querySelector('[data-tab-drag-preview]'),null,'return to strip removes overlay');
 assert.equal(el.style.visibility,'');
 await fire('pointermove',210,150);await fire('pointercancel');
 assert.equal(document.querySelector('[data-tab-drag-preview]'),null,'cancel removes overlay');
 assert.equal(el.style.visibility,'');
 await fire('pointerdown');await fire('pointermove',210,150);assert.equal(useCenterTabs.getState().activeId,'s:a');assert.equal(hook.detaching,true);assert.equal(el.getAttribute('data-detach-intent'),'');assert.equal(detached,0);await fire('pointerup',210,150);await fire('click');assert.equal(detached,1);assert.equal(document.querySelector('[data-tab-drag-preview]'),null,'release removes overlay');assert.equal(useCenterTabs.getState().activeId,'s:a');
 await fire('pointerdown');await fire('pointercancel');await fire('click');assert.equal(useCenterTabs.getState().activeId,'s:a');assert.equal(posts,0);
 target.dataset.resourceDropSession='a';target.getBoundingClientRect=()=>({left:700,right:800,top:100,bottom:500,width:100,height:400});document.body.append(target);
 await fire('pointerdown');await fire('pointermove',750,150);assert.equal(target.getAttribute('data-resource-drop-over'),'true');assertResourcesCue();assert.equal(posts,0);assert.equal(hook.detaching,false);
 await fire('pointermove',600,150);assert.equal(document.querySelector('[data-drop-target="resources"]'),null,'leaving Resources removes the tab drop preview');
 await fire('pointermove',750,150);assertResourcesCue();await fire('pointerup',750,150);await fire('click');assert.equal(posts,1);assert.equal(detached,1);assert.equal(useCenterTabs.getState().activeId,'s:a');assert.equal(target.hasAttribute('data-resource-drop-over'),false);assert.equal(document.querySelector('[data-drop-target="resources"]'),null,'release removes the Resources preview');
 globalThis.attachFetch=async()=>{posts++;throw new Error('offline');};
 await fire('pointerdown');await fire('pointermove',750,150);await fire('pointerup',750,150);await fire('click');assert.equal(posts,2);assert.equal(detached,1);assert.equal(useCenterTabs.getState().activeId,'s:a');assert.match(hook.resourceDropError,/Could not attach/);
 await fire('pointerdown');await fire('pointermove',750,150);assertResourcesCue();await fire('pointercancel');await fire('click');assert.equal(posts,2);assert.equal(target.hasAttribute('data-resource-drop-over'),false);assert.equal(document.querySelector('[data-drop-target="resources"]'),null,'cancel removes the tab Resources preview');
 target.remove();
 await fire('pointerdown');await fire('pointerup');await fire('click');assert.equal(useCenterTabs.getState().activeId,'w:b','next genuine click still activates');
 }finally{await fire('pointercancel');await act(async()=>root.unmount());host.remove();target.remove();}
});


test('pane grip drags a full tab label rather than the three dots',()=>{
 globalThis.bridge=null;
 const grip=document.createElement('div');grip.innerHTML='<i></i><i></i><i></i><span data-pane-drag-label hidden style="display:none"><svg></svg><span>Google</span></span>';
 document.body.append(grip);
 const strip=document.createElement('div');strip.setAttribute('role','tablist');
 strip.getBoundingClientRect=()=>({left:50,top:0,right:800,bottom:40,width:750,height:40});
 document.body.append(strip);
 grip.setPointerCapture=()=>{};grip.hasPointerCapture=()=>false;
 const fire=(type,x,y)=>{const e=new window.Event(type);Object.assign(e,{pointerId:7,clientX:x,clientY:y});window.dispatchEvent(e);};
 try {
  startPaneDrag({button:0,target:grip,currentTarget:grip,pointerId:7,clientX:100,clientY:20},'w:b',grip.querySelector('[data-pane-drag-label]'));
  fire('pointermove',102,21);
  assert.equal(document.querySelector('[data-pane-drag-preview]'),null);
  fire('pointermove',350,240);
  const preview=document.querySelector('[data-pane-drag-preview]');
  assert.ok(preview);assert.equal(preview.parentElement,document.body);
  assert.equal(preview.textContent,'Google');assert.ok(preview.querySelector('svg'));
  assert.equal(preview.querySelectorAll('i').length,0);
  assert.equal(preview.hasAttribute('hidden'),false);assert.equal(preview.style.width,'220px');
  assert.equal(preview.style.left,'240px');assert.equal(preview.style.top,'224px');
  assert.equal(grip.style.visibility,'hidden');
  fire('pointermove',350,20);
  const cue=document.querySelector('.canvas-drop-preview[data-drop-target="tab-strip"]');
  assert.ok(cue,'returning a pane to the strip shows a docking cue');
  assert.equal(cue.style.left,'54px');assert.equal(cue.style.width,'742px');
  fire('pointermove',20,20);
  assert.equal(document.querySelector('.canvas-drop-preview'),null,'outside strip horizontal bounds clears cue');
  fire('pointermove',350,20);
  assert.ok(document.querySelector('.canvas-drop-preview'));
  fire('pointercancel',350,240);
  assert.equal(document.querySelector('.canvas-drop-preview'),null,'cancel clears cue');
  assert.equal(document.querySelector('[data-pane-drag-preview]'),null);
  assert.notEqual(grip.style.visibility,'hidden');
 } finally {grip.remove();strip.remove();}
});


test('pane web drag highlights and attaches to the Resources panel conversation',async()=>{
 let posted;
 const toasts=[];const onToast=event=>toasts.push(event.detail);window.addEventListener('op:toast',onToast);
 globalThis.innerWidth=1200;globalThis.innerHeight=800;
 globalThis.bridge={windowId:'main',tabTransfer:{prepare:()=> 'token',cancel:async()=>true}};
 globalThis.attachFetch=async(path,options)=>{posted={path,body:JSON.parse(options.body)};return {items:[{id:'assoc',resource_id:'page',source:'browser',kind:'web',conversation_session_id:'b',tab_id:'w:c',status:'open'}]};};
 const ids=['s:a','s:b','w:c'];
 useCenterTabs.setState({tabs:[{id:ids[0],kind:'session',sessionId:'a',title:'A'},{id:ids[1],kind:'session',sessionId:'b',title:'B'},{id:ids[2],kind:'web',url:'https://example.test',title:'Web'}],activeId:ids[2],groups:[{id:'g',memberIds:ids,visibleIds:ids,focusedId:ids[2]}]});
 useSessionStore.setState({rightDock:{view:'activity',open:false}});
 const target=document.createElement('div');target.dataset.resourceDropSession='b';
 target.getBoundingClientRect=()=>({left:700,right:900,top:100,bottom:500,width:200,height:400});document.body.append(target);
 const grip=document.createElement('div');grip.innerHTML='<span data-pane-drag-label>Web</span>';document.body.append(grip);
 grip.setPointerCapture=()=>{};grip.hasPointerCapture=()=>false;
 const start=()=>startPaneDrag({button:0,target:grip,currentTarget:grip,pointerId:7,clientX:300,clientY:100},'w:c',grip.firstElementChild);
 const fire=async(type,x=750,y=150)=>{const e=new window.Event(type);Object.assign(e,{pointerId:7,clientX:x,clientY:y});window.dispatchEvent(e);await new Promise(resolve=>setImmediate(resolve));};
 try {
  start();await fire('pointermove');
  assert.equal(target.getAttribute('data-resource-drop-over'),'true','pane drag uses the same Resources feedback as a tab drag');
  const cue=assertResourcesCue();assert.equal(cue.style.left,'704px');assert.equal(cue.style.width,'192px');
  await fire('pointermove',600,150);assert.equal(target.hasAttribute('data-resource-drop-over'),false);assert.equal(document.querySelector('[data-drop-target="resources"]'),null,'leaving Resources removes the pane drop preview');
  await fire('pointermove');assertResourcesCue();await fire('pointercancel');assert.equal(target.hasAttribute('data-resource-drop-over'),false);assert.equal(document.querySelector('[data-drop-target="resources"]'),null,'cancel removes the pane Resources preview');assert.equal(posted,undefined);assert.equal(toasts.length,0);
  start();await fire('pointermove');await fire('pointerup');
  assert.equal(posted.path,'/api/session/b/resources/attach-web','drop goes to the shown chat, not the first grouped chat');
  assert.deepEqual(posted.body,{window_id:'main',tab_id:'w:c'});
  assert.equal(target.hasAttribute('data-resource-drop-over'),false);assert.equal(document.querySelector('[data-pane-drag-preview]'),null);assert.equal(document.querySelector('[data-drop-target="resources"]'),null);
  assert.match(toasts.at(-1)?.message??'',/added to Resources/,'successful pane drop gives visible confirmation');
  assert.deepEqual(useSessionStore.getState().rightDock,{view:'resources',open:true},'successful drop reveals Resources even while the webpage is active');
 } finally {await fire('pointercancel');window.removeEventListener('op:toast',onToast);grip.remove();target.remove();}
});

for (const failure of ['attach rejected','transfer cancellation rejected']) {
 test(`pane Resources drop reports ${failure} and preserves the existing layout`,async()=>{
  let posts=0;
  const toasts=[];const onToast=event=>toasts.push(event.detail);window.addEventListener('op:toast',onToast);
  globalThis.innerWidth=1200;globalThis.innerHeight=800;
  globalThis.bridge={windowId:'main',tabTransfer:{prepare:()=> 'token',cancel:async()=>failure!=='transfer cancellation rejected'}};
  globalThis.attachFetch=async()=>{posts++;throw new Error('offline');};
  const tabs=[{id:'s:a',kind:'session',sessionId:'a',title:'A'},{id:'w:b',kind:'web',url:'https://b.test',title:'B'}];
  const groups=[{id:'g',memberIds:['s:a','w:b'],visibleIds:['s:a','w:b'],focusedId:'w:b'}];
  useCenterTabs.setState({tabs,groups,activeId:'w:b'});
  useSessionStore.setState({rightDock:{view:'activity',open:false}});
  const target=document.createElement('div');target.dataset.resourceDropSession='a';target.getBoundingClientRect=()=>({left:700,right:900,top:100,bottom:500,width:200,height:400});document.body.append(target);
  const grip=document.createElement('div');grip.innerHTML='<span data-pane-drag-label>B</span>';document.body.append(grip);grip.setPointerCapture=()=>{};grip.hasPointerCapture=()=>false;
  const fire=async(type)=>{const event=new window.Event(type);Object.assign(event,{pointerId:11,clientX:750,clientY:150});window.dispatchEvent(event);await new Promise(resolve=>setImmediate(resolve));};
  try {
   startPaneDrag({button:0,target:grip,currentTarget:grip,pointerId:11,clientX:300,clientY:100},'w:b',grip.firstElementChild);
   await fire('pointermove');await fire('pointerup');
   assert.match(toasts.at(-1)?.message??'',/Could not attach/,'failure is visible rather than an unhandled event promise');
   assert.equal(posts,failure==='attach rejected'?1:0,'attachment waits for a successful native transfer cancellation');
   assert.deepEqual(useCenterTabs.getState().tabs,tabs);assert.deepEqual(useCenterTabs.getState().groups,groups);assert.equal(useCenterTabs.getState().activeId,'w:b');
   assert.deepEqual(useSessionStore.getState().rightDock,{view:'activity',open:false});
   assert.equal(document.querySelector('[data-drop-target="resources"]'),null);assert.equal(document.querySelector('[data-pane-drag-preview]'),null);assert.equal(target.hasAttribute('data-resource-drop-over'),false);
  } finally {await fire('pointercancel');window.removeEventListener('op:toast',onToast);grip.remove();target.remove();}
 });
}
