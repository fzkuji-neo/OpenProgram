import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import ts from "typescript";
import { parseHTML } from "linkedom";
const stubs={
 "next/navigation":"export const useRouter=()=>({push(){}});",
 "@tanstack/react-query":"export const useQueryClient=()=>({invalidateQueries(){}});",
 "@/lib/i18n":"export const useTranslation=()=>({t:x=>x,text:x=>x});",
 "@/lib/prefs/settings-cache":"export const readCachedSettings=()=>globalThis.cachedProviders;export const cachedFetch=()=>globalThis.loadProviders();export const invalidate=()=>{};",
 "@/lib/shallow-nav":"export const pushPath=()=>{};",
 "@/components/ui/search-input":"export const SearchInput=()=>null;",
 "./detail":"export const Detail=({provider})=>globalThis.providerElement('output',{},provider.id);",
 "./provider-item":"export const ProviderItem=()=>null;",
 "./add-custom-provider":"export const AddCustomProvider=()=>null;",
 "./types":"export const refreshAgentChip=()=>{};",
 "./api-key":"export const ApiKey=()=>null;"
};
registerHooks({resolve(s,c,next){
 if(s in stubs)return {url:'data:text/javascript,'+encodeURIComponent(stubs[s]),shortCircuit:true};
 if(s.endsWith('.css'))return {url:'data:text/javascript,export default {}',shortCircuit:true};
 return next(s,c);
},load(url,c,next){if(url.endsWith('.tsx'))return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText};return next(url,c);}});
const {window}=parseHTML('<html><body><div id="root"></div></body></html>');
Object.assign(globalThis,{window,document:window.document,IS_REACT_ACT_ENVIRONMENT:true});
const {act,createElement}=await import('react');
globalThis.providerElement=createElement;
const {createRoot}=await import('react-dom/client');
const {ProvidersSection}=await import('../../components/settings/providers/index.tsx');
test('URL provider wins over an earlier pending default selection without reloading list',async()=>{
 let resolveList,calls=0;
 const promise=new Promise(resolve=>resolveList=resolve);
 globalThis.loadProviders=()=>{calls++;return promise;};
 const root=createRoot(document.getElementById('root'));
 await act(async()=>root.render(createElement(ProvidersSection)));
 await act(async()=>root.render(createElement(ProvidersSection,{initialProviderId:'ollama'})));
 await act(async()=>resolveList({providers:[{id:'default',label:'Default',enabled:true},{id:'ollama',label:'Ollama',enabled:false}]}));
 assert.equal(document.querySelector('output').textContent,'ollama');
 assert.equal(calls,1);
 await act(async()=>root.unmount());
});

test('a fresh cached catalog is visible on the first render before effects',async()=>{
 const {renderToStaticMarkup}=await import('react-dom/server');
 globalThis.cachedProviders={providers:[{id:'ollama',label:'Ollama',enabled:true}]};
 assert.match(renderToStaticMarkup(createElement(ProvidersSection)),/<output>ollama<\/output>/);
 globalThis.cachedProviders=undefined;
});
