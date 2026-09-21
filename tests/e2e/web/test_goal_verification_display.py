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
localStorage.setItem('agentic_locale','zh');
const root=createRoot(document.getElementById('mount'));
const query=new QueryClient({defaultOptions:{queries:{retry:false}}});
useSessionStore.setState({currentSessionId:'s',pendingDecisions:[],executionUpdateOrders:{}});
window.show=(mode)=>{
 const raw='{"requirements":[{"id":"objective","verdict":"met","reason":"RAW_PRIVATE_REPORT"}]}';
 const marker={id:'candidate',status:mode==='pending'?'pending':mode==='unmet'?'unmet':mode==='unknown'?'unavailable':'met',requirements:[{id:'objective',text:'核对计算结果',verdict:'met',reason:'计算一致 <img src=x onerror=alert(1)>',evidence:['message:work']},{id:'todo:0',text:'计算乘法',verdict:'met',reason:'结果为 1073',evidence:['message:work']}]};
 const rows=convToChatMsgs([{id:'verify',role:'assistant',content:raw,status:mode==='pending'?'running':'completed',goal_verification:mode==='ordinary'?undefined:marker,extra:JSON.stringify({blocks:[{type:'text',text:raw}]})}]);
 root.render(<QueryClientProvider client={query}><AssistantMessage msg={rows[0]} sessionIdOverride="s"/></QueryClientProvider>);
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
            expect(page.get_by_text("正在核对验收结果…", exact=True)).to_be_visible()
            assert "RAW_PRIVATE_REPORT" not in page.locator("body").text_content()
            page.evaluate("window.show('accepted')")
            expect(page.get_by_text("Goal 已完成，1/1 项待办通过验收", exact=True)).to_be_visible()
            expect(page.get_by_text("RAW_PRIVATE_REPORT", exact=False)).not_to_be_visible()
            page.get_by_text("验收详情", exact=True).click()
            expect(page.get_by_text("核对计算结果 — 通过", exact=True)).to_be_visible()
            expect(page.get_by_text("证据: message:work", exact=True).first).to_be_visible()
            assert page.locator("img[src=x]").count() == 0
            page.get_by_text("原始报告", exact=True).click()
            expect(page.locator("pre")).to_contain_text("RAW_PRIVATE_REPORT")
            for mode, label in [("unmet", "验收未通过，仍有未满足或无法确认的要求"), ("unknown", "验收结果未确认")]:
                page.evaluate(f"window.show('{mode}')")
                expect(page.get_by_text(label, exact=True)).to_be_visible()
                expect(page.get_by_text("Goal 已完成", exact=False)).not_to_be_visible()
            page.evaluate("window.show('ordinary')")
            expect(page.get_by_text("RAW_PRIVATE_REPORT", exact=False)).to_be_visible()
            assert page.locator("[data-goal-verification]").count() == 0
        finally:
            browser.close()
