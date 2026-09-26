import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { parseHTML } from "linkedom";
const web = dirname(fileURLToPath(new URL('../../package.json', import.meta.url)));
const temp = await mkdtemp(join(web, '.programs-load-test-'));
after(() => rm(temp, { recursive: true, force: true }));
await build({
  absWorkingDir: web, entryPoints: ['components/programs/programs-page.tsx'], outfile: join(temp,'page.mjs'),
  bundle: true, packages: 'external', format: 'esm', platform: 'node', jsx: 'automatic',
  loader: { '.css': 'empty' }, plugins: [{ name: 'services', setup(b) {
    b.onResolve({ filter: /(?:net\/fetch-client|lib\/i18n|runtime-bridge\/state|abilities\/functions-store|^next\/navigation$)/ }, a => ({ path: a.path, namespace: 'mock' }));
    b.onLoad({ filter: /.*/, namespace: 'mock' }, a => ({ contents:
      a.path.includes('fetch-client') ? 'export const jsonFetch = (...args) => globalThis.programFetch(...args);'
      : a.path.includes('i18n') ? 'const text=(en)=>en; const t=(key)=>key; export const useTranslation=()=>({text,t});'
      : a.path.includes('functions-store') ? 'const state={meta:{favorites:[],folders:{},icons:{}},setMeta(m){this.meta=m}};export const useFunctions={getState:()=>state};'
      : a.path.includes('runtime-bridge') ? 'export const runtimeState={};'
      : 'export const useRouter=()=>({push(){}}); export const usePathname=()=>"/programs";'
    }));
  } }],
});
const { window, document } = parseHTML('<html><body></body></html>');
Object.assign(globalThis,{window,document,HTMLElement:window.HTMLElement,Node:window.Node,IS_REACT_ACT_ENVIRONMENT:true});
globalThis.getComputedStyle=()=>({getPropertyValue:()=>'',display:'block'});
globalThis.requestAnimationFrame=fn=>setTimeout(fn,0);
globalThis.cancelAnimationFrame=clearTimeout;
const intervals = new Set();
window.setInterval = fn => { intervals.add(fn); return fn; };
window.clearInterval = fn => intervals.delete(fn);
const { createElement, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { ProgramsPage } = await import(pathToFileURL(join(temp,'page.mjs')));
const row = name => ({name,path:`workflow/${name}`,kind:'file',program_kind:'workflow',has_children:false,logic_path:`workflow/${name}`});
const requests=[];
let block=false;
const waiting=[];
globalThis.programFetch = async url => {
  requests.push(url);
  if (block && !url.includes('/meta')) await new Promise(resolve=>waiting.push(resolve));
  if (url.includes('/meta')) return {favorites:[],folders:{},icons:{}};
  const u=new URL(url,'http://local');
  if (u.searchParams.has('revision')) return {unchanged:true,revision:'1'};
  if (u.pathname.endsWith('/explorer')) return {revision:'1',entries: u.searchParams.get('path') ? [row('alpha'),row('beta')] : [{name:'workflow',path:'workflow',kind:'folder',program_kind:null,has_children:true}],default_selection:'workflow/alpha'};
  const path=u.searchParams.get('path');
  return {revision:'1',root:path,nodes:[{id:path,name:path.split('/').at(-1),path,program_kind:'workflow',depth:0}],edges:[]};
};
async function settle(){ for(let i=0;i<8;i++) await act(async()=>{await Promise.resolve();}); }

test('warm Programs remount renders selection immediately while background checks are pending', async()=>{
  const host=document.createElement('div'); document.body.append(host);
  let root=createRoot(host);
  try {
    await act(async()=>root.render(createElement(ProgramsPage)));
    await settle();
    const beta=host.querySelector('[data-program-path="workflow/beta"]');
    assert.ok(beta);
    await act(async()=>beta.dispatchEvent(new window.Event('click',{bubbles:true})));
    await settle();
    assert.match(host.querySelector('h2').textContent,/beta/);
    await act(async()=>root.unmount());
    assert.equal(intervals.size,0);
    block=true;
    root=createRoot(host);
    await act(async()=>root.render(createElement(ProgramsPage)));
    assert.match(host.querySelector('h2').textContent,/beta/);
    assert.ok(host.querySelector('[data-program-path="workflow/beta"]'));
    assert.doesNotMatch(host.textContent,/Loading call logic|Loading Programs/);
    block=false;
    await act(async()=>{for(const resolve of waiting.splice(0))resolve();});
    await settle();
    assert.match(requests.at(-1),/revision=1/);
    assert.equal(requests.some(url=>url==='/api/programs'),false);
  } finally { block=false;for(const resolve of waiting.splice(0))resolve();await act(async()=>root.unmount());host.remove(); }
});
