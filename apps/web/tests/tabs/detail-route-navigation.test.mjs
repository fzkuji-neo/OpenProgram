import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
registerHooks({resolve(specifier, context, next) {
 if (specifier.startsWith(".") && !/\.[a-z]+$/.test(specifier)) return {url:new URL(specifier+".ts",context.parentURL).href,shortCircuit:true};
 return next(specifier,context);
}});
const {setNavigate}=await import("../../lib/navigate.ts");
const route=await import("../../lib/tabs/navigation/route.ts");
const requested=[];
globalThis.window={location:{pathname:"/s/chat"},history:{state:null,pushState(_s,_t,path){window.location.pathname=path;},replaceState(_s,_t,path){window.location.pathname=path;}}};
setNavigate(path=>requested.push(path));
test("saved provider detail loads exported host once before restoring detail",()=>{
 route.navigateTabRoute("/settings/providers/ollama");
 route.navigateTabRoute("/settings/providers/ollama");
 assert.deepEqual(requested,["/settings/providers"]);
 window.location.pathname="/settings/providers";
 assert.equal(route.completeTabRouteNavigation("/settings/providers"),true);
 assert.equal(window.location.pathname,"/settings/providers/ollama");
 assert.equal(route.completeTabRouteNavigation("/settings/providers/ollama"),false);
});

test("same-host details stay shallow and encoded identifiers remain intact",()=>{
 requested.length=0;
 route.navigateTabRoute("/settings/providers/custom%20local");
 assert.deepEqual(requested,[]);
 assert.equal(window.location.pathname,"/settings/providers/custom%20local");
});
test("an unrelated committed route cancels pending restoration",()=>{
 window.location.pathname="/chat";
 route.navigateTabRoute("/skills/example");
 window.location.pathname="/settings/general";
 assert.equal(route.completeTabRouteNavigation("/settings/general"),false);
 assert.equal(route.completeTabRouteNavigation("/skills"),false);
 assert.equal(window.location.pathname,"/settings/general");
});
