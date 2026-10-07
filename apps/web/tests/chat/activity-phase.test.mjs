import assert from 'node:assert/strict';
import test from 'node:test';
import { activityPhase } from '../../lib/chat/activity-phase.ts';

test('activity follows ordered content, with live tools taking priority over concurrent text', () => {
  const msg = {status:'running',content:'Earlier text'};
  assert.equal(activityPhase({...msg,blocks:[{type:'thinking',text:'Checking'}]}),'thinking');
  assert.equal(activityPhase({...msg,blocks:[{type:'thinking'},{type:'text',text:'Answer'}]}),'generating');
  assert.equal(activityPhase({...msg,blocks:[{type:'tool',tool_call_id:'t1'}],tools:[{id:'t1',status:'completed'}]}),'thinking');
  assert.equal(activityPhase({...msg,blocks:[{type:'tool',tool_call_id:'t1'},{type:'text',text:'Update'}],tools:[{id:'t1',status:'running'}]}),'tool');
  assert.equal(activityPhase({...msg,retryStatus:{attempt:2},tools:[{status:'running'}]}),'thinking');
});

test('empty pending replies think, legacy text generates and terminal records stay static', () => {
  assert.equal(activityPhase({status:'pending',content:''}),'thinking');
  assert.equal(activityPhase({status:'streaming',content:'Answer'}),'generating');
  assert.equal(activityPhase({status:'running',display:'runtime',content:'Run result'}),'tool');
  for (const status of ['done','completed','error','cancelled','interrupted',undefined]) {
    assert.equal(activityPhase({status,content:'Text',tools:[{status:'running'}]}),null);
  }
});

test('block-only calls stay in tool phase until a result or terminal outcome, with flat status taking precedence', () => {
  for (const tool of ['gui_agent','research_agent','wiki_agent']) {
    const block={type:'tool',tool,tool_call_id:'agentic'};
    const msg={status:'streaming',blocks:[block]};
    assert.equal(activityPhase(msg),'tool');
    for (const end of [{result:''},{result:'ok'},{is_error:true},{outcome:'cancelled'},{outcome:'completed'},{outcome:'unknown'}]) {
      assert.equal(activityPhase({...msg,blocks:[{...block,...end}]}),'thinking');
    }
    assert.equal(activityPhase({...msg,tools:[{id:'agentic',status:'done'}]}),'thinking');
    assert.equal(activityPhase({...msg,blocks:[block,{type:'text',text:'Progress'}]}),'tool');
    assert.equal(activityPhase({...msg,status:'done'}),null);
    assert.equal(activityPhase({...msg,retryStatus:{attempt:2}}),'thinking');
  }
});
