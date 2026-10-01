import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {parseHTML} from 'linkedom';
const web=dirname(fileURLToPath(new URL('../../package.json',import.meta.url)));
const dir=await mkdtemp(join(web,'.chat-activation-'));after(()=>rm(dir,{recursive:true,force:true}));
const output=join(dir,'hook.mjs');
await build({absWorkingDir:web,entryPoints:['components/chat/messages/use-chat-area-stick.ts'],outfile:output,bundle:true,packages:'external',platform:'node',format:'esm',jsx:'automatic',plugins:[{name:'services',setup(b){
 b.onResolve({filter:/^@\//},a=>a.path.endsWith('/chat-scroll')?null:{path:a.path,namespace:'service'});
 b.onLoad({filter:/.*/,namespace:'service'},a=>({contents:
 a.path.includes('session-store')?'export const useSessionStore=f=>f(globalThis.chatState);':
 a.path.includes('session-history-loader')?'export const loadSessionHistoryWindow=(...args)=>globalThis.loadLatest(...args);':
 a.path.includes('session-history')?'export const useSessionHistory=Object.assign(f=>f(globalThis.historyState),{getState:()=>globalThis.historyState});':
 a.path.includes('history-viewport')?'export const saveHistoryAnchor=()=>{},setFollowLock=()=>{};':
 'export const typesetMath=()=>{};'}));
}}]});
const parsed=parseHTML('<html><body><div id="root"></div><div id="area"><div id="messages"></div></div></body></html>');
globalThis.HTMLElement=parsed.window.HTMLElement;globalThis.window=parsed.window;globalThis.document=parsed.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const saved=new Map();window.sessionStorage={getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v)};
globalThis.getComputedStyle=()=>({paddingBottom:'0',getPropertyValue:()=>"0"});
let resize;globalThis.ResizeObserver=class{constructor(cb){resize=cb;}observe(){}disconnect(){}};
globalThis.chatState={currentSessionId:'a',welcomeVisible:false};globalThis.historyState={pages:{}};
const {act,createElement}=await import('react');const {createRoot}=await import('react-dom/client');
const {useChatAreaStick}=await import(pathToFileURL(output));
const area=document.querySelector('#area'),column=document.querySelector('#messages');let height=1500,top=0;
Object.defineProperties(area,{scrollHeight:{get:()=>height},clientHeight:{get:()=>500},scrollTop:{get:()=>top,set:v=>{top=Math.max(0,Math.min(v,height-500));}}});
const options={sessionId:'a',areaRef:{current:area},columnRef:{current:column}};
function View({id,visible=true}){options.sessionId=id;useChatAreaStick(id,'seed',visible,options);return null;}
test('activation reaches latest through delayed file growth and manual input cancels following',async()=>{
 const root=createRoot(document.querySelector('#root'));const render=async(id,visible=true)=>act(async()=>root.render(createElement(View,{id,visible})));
 await render('a');assert.equal(top,1000);await render('b');height=1600;await act(async()=>resize());assert.equal(top,1100);
 await render('a');assert.equal(top,1000,'return restores this opened conversation position');
 height=1900;await act(async()=>resize());assert.equal(top,1000,'growth does not move restored history position');
 await act(async()=>{area.dispatchEvent(new window.Event('wheel'));top=500;area.dispatchEvent(new window.Event('scroll'));});
 height=2100;await act(async()=>resize());assert.equal(top,500,'manual history reading remains fixed');
 await render('a',false);await render('a');assert.equal(top,500,'reactivated opened chat preserves reading position');
 await act(async()=>root.unmount());
});
test('older-window activation requests latest and ignores outgoing completion',async()=>{
 const root=createRoot(document.querySelector('#root'));let complete;
 globalThis.historyState={pages:{old:{after:'cursor',snapshot:'old',loading:false}}};
 globalThis.loadLatest=async(sid,direction,_anchor,{isCurrent})=>{assert.equal(sid,'old');assert.equal(direction,'latest');return new Promise(resolve=>{complete=()=>{if(isCurrent())globalThis.historyState.pages.old={snapshot:'latest'};resolve(true);};});};
 await act(async()=>root.render(createElement(View,{id:'old'})));assert.ok(complete,'activation requests latest');
 await act(async()=>root.render(createElement(View,{id:'other'})));const incoming=top;
 await act(async()=>complete());assert.equal(top,incoming,'stale completion cannot move incoming view');
 await act(async()=>root.unmount());
});
