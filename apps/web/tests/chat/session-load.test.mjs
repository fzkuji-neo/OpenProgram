import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionLoads, retainChangedRows } from '../../lib/net/session-load.ts';
function fixture(t) {
  t.mock.timers.enable({apis:['setTimeout']});
  const sent=[], states=[]; let sequence=0;
  const owner=createSessionLoads({send:r=>sent.push(r),capture:id=>({id}),status:(...s)=>states.push(s),requestId:()=>String(++sequence)});
  t.after(()=>{owner.dispose();t.mock.timers.reset();});
  const request=(id,invalidate=false,extra={})=>owner.request({action:'load_session',session_id:id,...extra},invalidate);
  const reply=(i)=>owner.accept({id:sent[i].session_id,request_id:sent[i].request_id});
  return {owner,sent,states,request,reply};
}
test('A/B/A and split-pane reads coalesce per session and retain response ownership',t=>{
 const f=fixture(t);f.request('a');f.request('b');f.request('a');
 assert.equal(f.sent.length,2);assert.equal(f.reply(1).context.id,'b');assert.equal(f.reply(0).context.id,'a');assert.equal(f.reply(0),false);
});
test('mutation invalidations coalesce into one replacement with latest options',t=>{
 const f=fixture(t);f.request('a');f.request('a',true,{graph:true});f.request('a',true,{graph:false});
 assert.equal(f.reply(0),false);assert.equal(f.sent.length,2);assert.equal(f.sent[1].graph,false);
 assert.equal(f.reply(0),false);assert.equal(f.reply(1).context.id,'a');
});
test('timeout releases UI and late replies cannot settle a retry',t=>{
 const f=fixture(t);f.request('a');t.mock.timers.tick(15000);assert.deepEqual(f.states.at(-1),['a','error']);
 assert.equal(f.reply(0),false);f.request('a');assert.equal(f.reply(0),false);assert.equal(f.reply(1).context.id,'a');
});
test('closed owner rejects replies and cleans up every pending timer',t=>{
 const f=fixture(t);f.request('a');f.request('b');f.owner.dispose();
 assert.deepEqual(f.states.slice(-2),[['a','disconnected'],['b','disconnected']]);assert.equal(f.reply(0),false);
 t.mock.timers.tick(60000);assert.equal(f.states.length,4);
});
test('correlated errors release only their request',t=>{
 const f=fixture(t);f.request('a');f.request('b');assert.equal(f.owner.error({request_id:'1'}),true);
 assert.deepEqual(f.states.at(-1),['a','error']);assert.equal(f.reply(1).context.id,'b');
});
test('delayed snapshot preserves new rows and progress, but removes unchanged branch rows',()=>{
 const old={id:'old',text:'prior branch'},before={id:'stream',text:'a'},live={id:'stream',text:'abc'},newRow={id:'user',text:'new input'};
 assert.deepEqual(retainChangedRows([old,before],[old,live,newRow],[{id:'stream',text:'ab'}]),[live,newRow]);
});

test('unchanged active rows accept terminal snapshots while missing optimistic rows survive',()=>{
 const old={id:'reply',status:'streaming',text:'Partial'},optimistic={id:'pending',status:'pending'};
 const done={id:'reply',status:'done',text:'Complete answer'};
 assert.deepEqual(retainChangedRows([old,optimistic],[old,optimistic],[done]),[done,optimistic]);
});
