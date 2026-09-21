"""Actual verifier message rendering, expansion and replay in a browser."""
from pathlib import Path
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[3]
pytestmark = pytest.mark.browser


def test_verifier_summary_streaming_and_history(tmp_path):
    from playwright.sync_api import sync_playwright, expect

    entry = r'''
import React from 'react';import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {AssistantMessage} from './components/chat/messages/message-list';
import {useSessionStore} from './lib/session-store';
import {convToChatMsgs} from './lib/chat/conv-mapper';
import {DetailPanel} from './components/right-sidebar/detail-panel';
localStorage.setItem('agentic_locale','zh');
const root=createRoot(document.getElementById('mount'));
const query=new QueryClient({defaultOptions:{queries:{retry:false}}});
useSessionStore.setState({currentSessionId:'s',pendingDecisions:[],executionUpdateOrders:{}});
window.show=(mode)=>{
 const raw='{"requirements":[{"id":"objective","verdict":"met","reason":"RAW_PRIVATE_REPORT <img src=x onerror=alert(1)>"}]}';
 const marker={id:'candidate',status:mode==='pending'?'pending':mode==='unmet'?'unmet':mode==='unknown'?'unavailable':'met',requirements:[{id:'objective',text:'核对计算结果',verdict:'met',reason:'计算一致 <img src=x onerror=alert(1)>',evidence:['message:work']},{id:'todo:0',text:'计算乘法',verdict:'met',reason:'结果为 1073',evidence:['message:work']}]};
 const rows=convToChatMsgs([{id:'verify',role:'assistant',content:raw,status:mode==='pending'?'running':'completed',goal_verification:mode==='ordinary'?undefined:marker,extra:JSON.stringify({blocks:[{type:'text',text:raw}]})}]);
 if(mode==='cancelled'||mode==='error') {rows[0].status=mode;rows[0].goalVerification.status='pending';}
 if(mode==='legacy') {rows[0].goalVerification=undefined;rows[0].calledBy='legacy-parent';rows[0].content='{"met":true,"reason":"LEGACY_REPORT"}';rows[0].blocks=[{type:'text',text:rows[0].content}];useSessionStore.setState({messagesById:{'legacy-parent':{spawnedFrom:{label:'goal 判定'}}}});}
 root.render(<QueryClientProvider client={query}><div id="transcript"><AssistantMessage key={mode==='history'?'history':'live'} msg={rows[0]} sessionIdOverride="s"/></div><DetailPanel/></QueryClientProvider>);
};window.show('pending');
'''
    bundle = tmp_path / "verification.js"
    subprocess.run(["node", "-e", "require('esbuild').buildSync({stdin:{contents:process.argv[3],resolveDir:process.argv[1],loader:'tsx'},bundle:true,format:'iife',platform:'browser',jsx:'automatic',loader:{'.css':'empty'},outfile:process.argv[2],tsconfig:process.argv[1]+'/tsconfig.json'});", str(ROOT / "apps/web"), str(bundle), entry], cwd=ROOT, check=True, capture_output=True)
    shell = tmp_path / "verification.html"
    shell.write_text('<!doctype html><meta charset="utf-8"><div id="mount"></div>')
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        try:
            page = browser.new_page()
            page.goto(shell.as_uri())
            page.evaluate("localStorage.setItem('agentic_locale','zh')")
            page.add_script_tag(path=str(bundle))
            transcript = page.locator("#transcript")
            toggle = transcript.locator(".tl-toggle")
            expect(toggle).to_have_text("正在验收目标…›")
            expect(toggle).to_have_attribute("aria-expanded", "false")
            assert "RAW_PRIVATE_REPORT" not in transcript.text_content()
            toggle.focus()
            page.keyboard.press("Enter")
            expect(toggle).to_have_attribute("aria-expanded", "true")
            expect(transcript.get_by_text("验收报告", exact=True)).to_be_visible()
            page.evaluate("window.show('accepted')")
            expect(toggle).to_have_text("目标已完成›")
            expect(toggle).to_have_attribute("aria-expanded", "true")
            for hidden in ["RAW_PRIVATE_REPORT", "核对计算结果", "message:work", "Met", "Passed"]:
                assert hidden not in transcript.text_content()
            assert transcript.locator("details").count() == 0
            transcript.get_by_text("验收报告", exact=True).click()
            expect(page.locator("#detailBody")).to_contain_text("RAW_PRIVATE_REPORT")
            assert page.locator("img[src=x]").count() == 0
            toggle.click()
            expect(transcript.locator(".tl-body")).to_have_count(0)
            page.evaluate("window.show('history')")
            expect(toggle).to_have_attribute("aria-expanded", "false")
            for mode, label in [("unmet", "目标验收未通过"), ("unknown", "验收结果未确认"), ("cancelled", "验收已取消"), ("error", "验收已中断")]:
                page.evaluate(f"window.show('{mode}')")
                expect(toggle).to_have_text(label + "›")
                assert transcript.locator(".chat-text,.error-content,.pending-body").count() == 0
            page.evaluate("window.show('ordinary')")
            expect(transcript.get_by_text("RAW_PRIVATE_REPORT", exact=False)).to_be_visible()
            assert transcript.locator(".tl-toggle").count() == 0
            page.evaluate("window.show('legacy')")
            expect(toggle).to_have_text("验收通过›")
            toggle.click()
            expect(transcript.get_by_text("验收报告", exact=True)).to_be_visible()
            assert "LEGACY_REPORT" not in transcript.text_content()
        finally:
            browser.close()
