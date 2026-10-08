from pathlib import Path
import subprocess
import pytest

ROOT = Path(__file__).resolve().parents[3]
WEB = ROOT / 'apps/web'
pytestmark = pytest.mark.browser


def test_steering_boundary_and_history(tmp_path):
    from playwright.sync_api import sync_playwright, expect
    entry = r'''
import React from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MessageRow} from './components/chat/messages/message-list';
import {useSessionStore} from './lib/session-store';
import {applyChatWsMessage} from './lib/net/chat-stream';
import {convToChatMsgs} from './lib/chat/conv-mapper';
window.fetch=async()=>new Response('{}',{headers:{'content-type':'application/json'}});
const sid='steer-test',uid='turn',rid='turn_reply';
useSessionStore.setState({currentSessionId:sid,activeChatKey:sid});
window.frame=data=>applyChatWsMessage({type:'chat_response',data:{session_id:sid,...data}});
window.delta=text=>frame({type:'stream_event',msg_id:uid,event:{type:'text',text}});
applyChatWsMessage({type:'chat_ack',data:{session_id:sid,msg_id:uid}});
function App(){const ids=useSessionStore(s=>s.messageOrder[sid]);return <>{ids?.map(id=><MessageRow key={id} id={id} sessionIdOverride={sid}/>)}</>}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient()}><App/></QueryClientProvider>);
window.reloadHistory=()=>{
 const store=useSessionStore.getState(), reply=store.messagesById[rid];
 const rows=convToChatMsgs([{id:rid,role:'assistant',content:reply.content,blocks:reply.blocks,status:'completed',predecessor:'steer-2'},
 {id:'steer-1',role:'user',content:'FIRST INPUT',steering:true,predecessor:uid},
 {id:'steer-2',role:'user',content:'SECOND INPUT',steering:true,predecessor:'steer-1'}]);
 useSessionStore.setState({messagesById:Object.fromEntries(rows.map(m=>[m.id,m])),messageOrder:{[sid]:rows.map(m=>m.id)}});
};
window.legacy=()=>{
 const rows=convToChatMsgs([{id:'oldreply',role:'assistant',content:'OLD ANSWER',predecessor:'oldsteer'},
 {id:'oldsteer',role:'user',content:'OLD INPUT',steering:true,predecessor:'olduser'}]);
 useSessionStore.setState({messagesById:Object.fromEntries(rows.map(m=>[m.id,m])),messageOrder:{[sid]:rows.map(m=>m.id)}});
};
'''
    bundle=tmp_path/'steer.js'
    subprocess.run(['node','-e',"require('esbuild').buildSync({stdin:{contents:process.argv[3],resolveDir:process.argv[1],loader:'tsx'},bundle:true,format:'iife',platform:'browser',jsx:'automatic',loader:{'.css':'css'},outfile:process.argv[2],tsconfig:process.argv[1]+'/tsconfig.json'});",str(WEB),str(bundle),entry],cwd=ROOT,check=True,capture_output=True)
    with sync_playwright() as runtime:
        browser=runtime.chromium.launch()
        try:
            page=browser.new_page(viewport={'width':760,'height':700})
            errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            page.route('http://steer.test/**',lambda r:r.fulfill(body='<!doctype html><div id="root"></div>',content_type='text/html'))
            page.goto('http://steer.test/')
            if bundle.with_suffix('.css').exists():page.add_style_tag(path=str(bundle.with_suffix('.css')))
            for sheet in ['base.css','chat/bubbles.css','chat/stream-blocks.css','chat/message-actions.css']:
                page.add_style_tag(path=str(WEB/'app/styles'/sheet))
            page.add_script_tag(path=str(bundle))
            # A steer may arrive before the pending animation-frame delta flush.
            page.evaluate("delta('BEFORE INPUT'); frame({type:'user_message',msg_id:'steer-1',assistant_msg_id:'turn_reply',steering:true,content:'FIRST INPUT',timestamp:123})")
            page.evaluate("delta('AFTER FIRST')")
            expect(page.locator('#root')).to_contain_text('AFTER FIRST')
            page.evaluate("frame({type:'user_message',msg_id:'steer-2',assistant_msg_id:'turn_reply',steering:true,content:'SECOND INPUT',timestamp:124})")
            page.evaluate("delta('AFTER SECOND')")
            expect(page.locator('#root')).to_contain_text('AFTER SECOND')
            def order():
                texts=[s.strip() for s in page.locator('.chat-text, .message.user .message-content').all_text_contents()]
                assert texts==['BEFORE INPUT','FIRST INPUT','AFTER FIRST','SECOND INPUT','AFTER SECOND']
                expect(page.locator('[data-msg-id="steer-1"]')).to_have_count(1)
                expect(page.locator('[data-msg-id="steer-2"]')).to_have_count(1)
            order()
            # Replayed receipts must not duplicate or move an already consumed input.
            page.evaluate("frame({type:'user_message',msg_id:'steer-1',assistant_msg_id:'turn_reply',steering:true,content:'FIRST INPUT'})")
            order()
            page.evaluate("frame({type:'cancelled',msg_id:'turn'})")
            order()
            page.evaluate('reloadHistory()');order()
            page.set_viewport_size({'width':390,'height':700})
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            page.screenshot(path=str(tmp_path/'steer.png'))
            page.evaluate('legacy()')
            expect(page.locator('#root')).to_contain_text('OLD ANSWER')
            assert [s.strip() for s in page.locator('.chat-text, .message.user .message-content').all_text_contents()]==['OLD INPUT','OLD ANSWER']
            assert not errors,errors
        finally:browser.close()
