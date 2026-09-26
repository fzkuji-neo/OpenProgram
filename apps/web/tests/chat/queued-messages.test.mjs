import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';
const web = dirname(fileURLToPath(new URL('../../package.json', import.meta.url)));
const dir = await mkdtemp(join(web, '.queue-ui-test-'));
after(() => rm(dir, {recursive:true, force:true}));
await build({absWorkingDir:web, stdin:{contents:`export { QueuedMessages } from './components/chat/messages/queued-messages'; export { useSendQueue, registerChatSender } from './lib/chat/send-queue'; export { queuedMessagePayload } from './lib/chat/queued-attachments';`,resolveDir:web},bundle:true,format:'esm',platform:'node',packages:'external',outfile:join(dir,'test.mjs'),jsx:'automatic',tsconfig:join(web,'tsconfig.json'),plugins:[{name:'ports',setup(b){
 b.onResolve({filter:/^react$/},()=>({path:'react',external:true}));
 b.onResolve({filter:/\.module\.css$/},()=>({path:'css',namespace:'stub'}));
 b.onResolve({filter:/desktop-bridge$/},()=>({path:'bridge',namespace:'stub'}));
 b.onResolve({filter:/\/i18n$/},()=>({path:'i18n',namespace:'stub'}));
 b.onResolve({filter:/\/session-store$/},()=>({path:'session',namespace:'stub'}));
 b.onResolve({filter:/lazy-document-window$/},()=>({path:'viewer',namespace:'stub'}));
 b.onLoad({filter:/.*/,namespace:'stub'},({path})=>({contents:({
 css:`export default new Proxy({}, {get:(_,key)=>String(key)});`,
 bridge:`export const desktopBridge=()=>({getPathForFile:file=>'/fixture/'+file.name});`,
 i18n:`export const useTranslation=()=>({text:(en)=>en});`,
 session:`export const useSessionStore=selector=>selector(globalThis.sessions); useSessionStore.getState=()=>globalThis.sessions;`,
 viewer:`import {createElement} from 'react'; export const DocumentWindow=props=>createElement('div',{'data-document-path':props.path,'data-document-session':props.sessionId},'Document preview');`,
 })[path]}));
}}]});
const {window}=parseHTML('<html><body></body></html>');
Object.assign(globalThis,{window,document:window.document,HTMLElement:window.HTMLElement,Element:window.Element,CustomEvent:window.CustomEvent,IS_REACT_ACT_ENVIRONMENT:true,requestAnimationFrame:cb=>cb()});
Object.defineProperty(globalThis,'localStorage',{value:{getItem:()=>null,setItem(){},removeItem(){}},configurable:true});
globalThis.sessions={activeChatKey:'A',currentSessionId:'A',runningTasks:{A:{msg_id:'busy'}}};
window.location={pathname:'/s/A'};
const {createElement:h,act}=await import('react');
const {createRoot}=await import('react-dom/client');
const {QueuedMessages,useSendQueue,registerChatSender,queuedMessagePayload}=await import(pathToFileURL(join(dir,'test.mjs')));

test('queued bubble previews attachments and edits files without changing order or another draft',async()=>{
 const doc={id:'old',filename:'old.txt',ext:'txt',sizeBytes:3,content:'old',sourcePath:'/fixture/old.txt',order:0};
 const settings={thinking:'medium',toolsEnabled:true,webSearchEnabled:false,background:false};
 const id=useSendQueue.getState().enqueue('A',{...settings,text:'first',docs:[doc]});
 const second=useSendQueue.getState().enqueue('A',{...settings,text:'second'});
 useSendQueue.getState().enqueue('B',{...settings,text:'other session'});
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 const click=async el=>{assert.ok(el);await act(async()=>el.dispatchEvent(new window.Event('click',{bubbles:true})));};
 const button=name=>[...host.querySelectorAll('button')].find(el=>el.getAttribute('aria-label')===name || el.textContent===name);
 const sent=[];registerChatSender(args=>{sent.push(args);return true;});
 try {
 await act(async()=>root.render(h(QueuedMessages,{sessionId:'A'})));
 assert.equal(host.querySelectorAll('[data-queued-message]').length,2);
 assert.doesNotMatch(host.textContent,/other session/);
 globalThis.sessions.currentSessionId='B'; // Preview remains local even while a peer has focus.
 await click(host.querySelector('[data-attachment-preview]'));
 assert.equal(Boolean(document.querySelector('[data-document-path]')),false, 'unsent native files must not request backend path access');
 assert.match(document.querySelector('[role="dialog"]').textContent,/old/);
 await click(document.querySelector('[aria-label="Close preview"]'));
 assert.equal(document.querySelector('[role="dialog"]'),null);
 await click(button('Edit queued message'));
 assert.equal(useSendQueue.getState().queues.A[0].editing,true);
 await click(host.querySelector('[data-attachment-remove]'));
 // The queue snapshot remains unchanged until Save.
 assert.equal(useSendQueue.getState().queues.A[0].docs[0].filename,'old.txt');
 const input=host.querySelector('input[type="file"]');
 Object.defineProperty(input,'files',{value:[{name:'new.txt',type:'text/plain',size:3,text:async()=> 'new'}],configurable:true});
 await act(async()=>input.dispatchEvent(new window.Event('change',{bubbles:true})));
 assert.match(host.textContent,/new.txt/);
 await click(button('Save'));
 assert.equal(useSendQueue.getState().queues.A[0].id,id);
 assert.equal(useSendQueue.getState().queues.A[0].docs[0].filename,'new.txt');
 assert.equal(useSendQueue.getState().queues.A[1].id,second);
 await click(button('Edit queued message'));
 await click(host.querySelector('[data-attachment-remove]'));
 await click(button('Cancel'));
 assert.equal(useSendQueue.getState().queues.A[0].docs[0].filename,'new.txt');
 // Native PDF bytes are preview-only and are snapshotted before drain.
 const pdfBytes=Buffer.from('%PDF-1.4\nfixture').toString('base64');
 globalThis.FileReader=class { readAsDataURL(){this.result='data:application/pdf;base64,'+pdfBytes;queueMicrotask(()=>this.onload());} };
 await click(button('Edit queued message'));
 const pdfInput=host.querySelector('input[type="file"]');
 Object.defineProperty(pdfInput,'files',{value:[{name:'local.pdf',type:'application/pdf',size:17}],configurable:true});
 await act(async()=>pdfInput.dispatchEvent(new window.Event('change',{bubbles:true})));
 await click(button('Save'));
 const queued=useSendQueue.getState().queues.A[0];
 assert.equal(queued.docs[1].dataB64,pdfBytes);
 assert.equal(queued.docs[1].loading,false);
 assert.equal(queuedMessagePayload(queued).attachments.length,0,'native PDF remains a path reference');
 await click([...host.querySelectorAll('[data-attachment-preview]')].find(el=>el.textContent.includes('local.pdf')));
 assert.match(document.querySelector('iframe')?.getAttribute('src') || '',/^blob:/);
 assert.equal(Boolean(document.querySelector('[data-document-path]')),false);
 await click(document.querySelector('[aria-label="Close preview"]'));
 await click(button('Remove from queue'));
 assert.equal(useSendQueue.getState().queues.A[0].id,second);
 assert.equal(useSendQueue.getState().queues.B[0].text,'other session');
 assert.equal(sent.length,0);
 await click(button('1 queued'));
 assert.equal(host.querySelectorAll('[data-queued-message]').length,0);
 } finally {await act(async()=>root.unmount());host.remove();}
});
