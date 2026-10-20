import assert from 'node:assert/strict';
import test, {after} from 'node:test';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {parseHTML} from 'linkedom';
const web=dirname(fileURLToPath(new URL('../../package.json',import.meta.url)));
const dir=await mkdtemp(join(web,'.plugin-slots-'));
after(()=>rm(dir,{recursive:true,force:true}));
const file=join(dir,'entry.mjs');
const mocks={
  '@/lib/net/fetch-client': 'export const jsonFetch=(url)=>globalThis.pluginFetch(url);',
  '@/lib/net/owner-auth-bootstrap': 'export const waitForOwnerAuthBootstrap=async()=>{};',
  '@/lib/navigate': 'export const navigate=()=>{};',
  '@/lib/i18n': 'export const translateText=(en)=>en,useTranslation=()=>({text:(en)=>en});',
};
await writeFile(join(dir,'index.ts'),
  "export * from '../lib/plugins/slots.ts';\nexport {PluginSlot} from '../components/plugins/plugin-slot.tsx';\n".replaceAll('../',`${web}/`));
await build({absWorkingDir:web,entryPoints:[join(dir,'index.ts')],outfile:file,
  bundle:true,packages:'external',platform:'node',format:'esm',jsx:'automatic',plugins:[{name:'services',setup(b){
    b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:null);
    b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],resolveDir:web}));
  }}]});
const {loadPluginClients,usePluginSlots,PluginSlot}=await import(pathToFileURL(file));

async function writeModule(name,body){
  const path=join(dir,name);
  await writeFile(path,body);
  return pathToFileURL(path).href;
}

test('a client module fills its slots and leaves nothing when the plugin goes',async()=>{
  const first=await writeModule('one.mjs',`export default (api)=>{
    api.slot('sidebar.nav',()=>api.React.createElement('b',null,'first'));
    return ()=>{globalThis.cleaned=(globalThis.cleaned||0)+1;};
  };`);
  const broken=await writeModule('broken.mjs','export default ()=>{throw new Error("nope");};');
  let modules=[{plugin:'demo',url:first},{plugin:'bad',url:broken}];
  globalThis.pluginFetch=async(url)=>url.endsWith('/client')?{modules}:{items:[{id:'demo-0',plugin:'demo',label:'Demo',href:'/plugin/demo/'}]};
  const originalError=console.error;
  console.error=()=>{};
  try{await loadPluginClients();}finally{console.error=originalError;}
  assert.equal(usePluginSlots.getState().slots['sidebar.nav'].length,1);
  assert.equal(usePluginSlots.getState().sidebarItems[0].href,'/plugin/demo/');

  const {window}=parseHTML('<html><body><main id="root"></main></body></html>');
  Object.assign(globalThis,{window,document:window.document,IS_REACT_ACT_ENVIRONMENT:true});
  const root=createRoot(window.document.getElementById('root'));
  await act(async()=>root.render(createElement(PluginSlot,{name:'sidebar.nav'})));
  assert.equal(window.document.getElementById('root').textContent,'first');

  // A reload serves the file under a new URL: the old module is undone first.
  const second=await writeModule('two.mjs',`export default (api)=>{api.slot('sidebar.nav',()=>api.React.createElement('b',null,'second'));};`);
  modules=[{plugin:'demo',url:second}];
  await act(async()=>{await loadPluginClients();});
  assert.equal(globalThis.cleaned,1);
  assert.equal(window.document.getElementById('root').textContent,'second');

  modules=[];
  await act(async()=>{await loadPluginClients();});
  assert.equal(usePluginSlots.getState().slots['sidebar.nav'].length,0);
  assert.equal(window.document.getElementById('root').textContent,'');
  await act(async()=>root.unmount());
});
