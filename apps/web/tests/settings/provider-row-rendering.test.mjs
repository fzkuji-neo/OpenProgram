import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import {parseHTML} from 'linkedom';
registerHooks({resolve(s,c,next){
 const source=s==='../provider-icon'?"export const ProviderIcon=()=>{globalThis.iconRenders++;return null;}":s==='@/lib/i18n'?"export const useTranslation=()=>({text:x=>x});":s.endsWith('.css')?'export default {}':null;
 return source?{url:'data:text/javascript,'+encodeURIComponent(source),shortCircuit:true}:next(s,c);
},load(url,c,next){return url.endsWith('.tsx')?{format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText}:next(url,c);}});
const {window}=parseHTML('<html><body><div id="root"></div></body></html>');
Object.assign(globalThis,{window,document:window.document,IS_REACT_ACT_ENVIRONMENT:true,iconRenders:0});
const {act,createElement}=await import('react');
const {createRoot}=await import('react-dom/client');
const {ProviderItem}=await import('../../components/settings/providers/provider-item.tsx');
test('changing selected provider redraws only the two changed rows',async()=>{
 const providers=Array.from({length:239},(_,i)=>({id:String(i),label:String(i),enabled:true}));
 let selected;const onSelect=id=>selected=id;
 const render=active=>providers.map(p=>createElement(ProviderItem,{key:p.id,p,active:p.id===active,onSelect}));
 const root=createRoot(document.getElementById('root'));
 await act(async()=>root.render(render('0')));
 assert.equal(globalThis.iconRenders,239);
 globalThis.iconRenders=0;
 await act(async()=>root.render(render('1')));
 assert.equal(globalThis.iconRenders,2);
 document.querySelectorAll('button')[1].click();
 assert.equal(selected,'1');
 await act(async()=>root.unmount());
});
