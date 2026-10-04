import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
const root=new URL('../../',import.meta.url);
registerHooks({resolve(specifier,context,next){
  const base=specifier.startsWith('@/')?new URL(specifier.slice(2),root):specifier.startsWith('.')?new URL(specifier,context.parentURL):null;
  if(base)for(const suffix of ['.ts','/index.ts'])if(existsSync(fileURLToPath(base.href+suffix)))return {url:base.href+suffix,shortCircuit:true};
  return next(specifier,context);
}});
const { collectFileOutputs, previewTarget }=await import('../../lib/chat/file-outputs.ts');
const { filePreviewLayout }=await import('../../lib/tabs/file-preview-layout.ts');
const { normalizeCenterTabLayout }=await import('../../lib/tabs/center-tab-groups.ts');
const chat={id:'s:a',kind:'session',sessionId:'a',title:'Chat'};
const initial=()=>({tabs:[chat,{id:'s:b',kind:'session',sessionId:'b',title:'Other'}],groups:[],activeId:chat.id});
const target={projectId:'p',path:'report.pdf'};
test('only explicit local Markdown outputs and attachments become deduplicated file rows',()=>{
  const text='[Report](</project/report%20one.pdf>) [source](/project/main.py:12) [remote](https://a.test/file.pdf) `[/tmp/code.pdf](/tmp/code.pdf)` <a href="/tmp/raw.pdf">x</a>';
  assert.deepEqual(collectFileOutputs(text,[{path:'/project/report one.pdf',filename:'report one.pdf'}]).map(x=>x.path),['/project/report one.pdf','/project/main.py']);
  assert.deepEqual(collectFileOutputs('[bad](//evil/file.pdf) [bad](javascript:alert) [bad](relative.pdf)'),[]);
  assert.equal(collectFileOutputs('',[{path:'/tmp/data.zip',filename:'data.zip'}]).length,1);
});
test('project preview mapping respects root boundaries and traversal',()=>{
  const p={id:'p',path:'/project'};
  assert.deepEqual(previewTarget('/project/report.pdf',p),{...target,readOnly:false});
  for(const path of ['/project2/report.pdf','/project/../secret.pdf','/else/report.pdf']) assert.equal(previewTarget(path,p).readOnly,true);
});
test('new output opens to the right of its own chat and reuses the same tab',()=>{
  const next=filePreviewLayout(initial(),'a',target,true);
  assert.equal(next.groups.length,1);
  assert.deepEqual(next.groups[0].visibleIds,['s:a','f:preview:a:p:report.pdf']);
  assert.equal(filePreviewLayout(next,'a',target,true).tabs.length,next.tabs.length);
  const replacement=filePreviewLayout(next,'a',{...target,path:'new.pdf'},true);
  assert.deepEqual(replacement.groups[0].visibleIds,['s:a','f:preview:a:p:new.pdf']);
  assert.ok(replacement.tabs.some(tab=>tab.path==='report.pdf'));
});
test('background, dirty preview and user split do not accept automatic replacement',()=>{
  assert.equal(filePreviewLayout({...initial(),activeId:'s:b'},'a',target,true),null);
  const next=filePreviewLayout(initial(),'a',target,true);
  next.tabs=next.tabs.map(tab=>tab.kind==='file'?{...tab,dirty:true}:tab);
  assert.equal(filePreviewLayout(next,'a',{...target,path:'new.pdf'},true),null);
  const state=initial();state.groups=normalizeCenterTabLayout({tabIds:state.tabs.map(t=>t.id),groups:[{id:'manual',memberIds:['s:a','s:b'],visibleIds:['s:a','s:b'],focusedId:'s:a'}]}).groups;
  assert.equal(filePreviewLayout(state,'a',target,true),null);
  assert.deepEqual(filePreviewLayout(state,'a',target,false).groups,state.groups);
});
