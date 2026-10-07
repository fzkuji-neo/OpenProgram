from __future__ import annotations

from pathlib import Path
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[3]
WEB = ROOT / "apps/web"
pytestmark = pytest.mark.browser


def test_activity_motion_geometry_and_accessibility(tmp_path: Path) -> None:
    from playwright.sync_api import expect, sync_playwright

    bundle = tmp_path / "activity.js"
    subprocess.run([
        "node", "-e", """
const esbuild = require('esbuild');
esbuild.buildSync({absWorkingDir:process.argv[1], stdin:{contents:
  'export {createElement} from "react"; export {createRoot} from "react-dom/client"; export {ActivityIndicator} from "./components/chat/messages/activity-indicator.tsx";',
  resolveDir:process.argv[1],loader:'tsx'},bundle:true,format:'iife',globalName:'ActivityBundle',jsx:'automatic',outfile:process.argv[2]});
""", str(WEB), str(bundle),
    ], cwd=ROOT, check=True, capture_output=True, text=True)
    with sync_playwright() as runtime:
        browser = runtime.chromium.launch()
        try:
            page = browser.new_page()
            page.route("http://activity.test/", lambda route: route.fulfill(
                body='<div id="root"></div>', content_type="text/html"))
            page.goto("http://activity.test/")
            page.add_style_tag(path=str(WEB / "app/styles/base.css"))
            page.add_style_tag(path=str(WEB / "app/styles/chat/thinking-spinner.css"))
            page.add_style_tag(content=":root{--accent-blue:#4989ef;--accent-purple:#a36cef} #root{display:flex;gap:24px}")
            page.add_script_tag(path=str(bundle))
            page.evaluate("""() => {
              const {createRoot,createElement:h,ActivityIndicator} = ActivityBundle;
              window.root = createRoot(document.getElementById('root'));
              window.show = visible => root.render(visible ? h(ActivityIndicator) : null);
              window.seek = time => document.getAnimations().forEach(a => {a.pause();a.currentTime=time;});
              show(true);
            }""")
            expect(page.locator('.activity-indicator')).to_have_count(1)
            page.evaluate("seek(0)")
            boxes = page.locator('.activity-indicator').evaluate_all("els => els.map(e=>({w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height,hidden:e.getAttribute('aria-hidden')}))")
            assert boxes == [{"w": 18, "h": 18, "hidden": "true"}]
            assert page.locator('linearGradient').evaluate_all("els=>new Set(els.map(e=>e.id)).size") == 1
            outer = page.locator('.activity-thinking .activity-outer').first
            inner = page.locator('.activity-thinking .activity-inner').first
            geometry = "e=>{const s=getComputedStyle(e);return [parseFloat(s.r),parseFloat(s.strokeWidth)]}"
            page.evaluate("seek(900)")
            assert outer.evaluate(geometry) == pytest.approx([7.95, 1.75])
            assert inner.evaluate(geometry) == pytest.approx([1.9, .65])
            page.evaluate("seek(2700)")
            assert outer.evaluate(geometry) == pytest.approx([5.85, .75])
            assert inner.evaluate(geometry) == pytest.approx([3.8, 1.65])
            assert page.locator('.activity-indicator').evaluate_all("els=>els.every(e=>e.getBoundingClientRect().width===18&&e.getBoundingClientRect().height===18)")
            for color in ['rgb(20, 60, 180)', 'rgb(210, 110, 60)']:
                page.evaluate("color=>document.documentElement.style.setProperty('--accent-blue',color)", color)
                assert page.locator('.activity-color-start').first.evaluate("e=>getComputedStyle(e).stopColor") == color
            # Remove the manually paused test animations before testing native media behavior.
            page.evaluate("show(false)")
            expect(page.locator('.activity-indicator')).to_have_count(0)
            page.emulate_media(reduced_motion="reduce")
            page.evaluate("show(true)")
            expect(page.locator('.activity-indicator')).to_have_count(1)
            assert page.locator('.activity-indicator').evaluate_all("els=>els.every(e=>e.getAnimations({subtree:true}).length===0)")
            assert outer.evaluate("e=>getComputedStyle(e).animationName") == 'none'
            assert outer.evaluate(geometry) == pytest.approx([6.9, 1.25])
            page.emulate_media(forced_colors="active")
            page.wait_for_function("!getComputedStyle(document.querySelector('.activity-thinking .activity-outer')).stroke.startsWith('url(')")
            assert outer.evaluate("e=>getComputedStyle(e).stroke") != 'none'
            assert not outer.evaluate("e=>getComputedStyle(e).stroke").startswith('url(')
            page.emulate_media(reduced_motion="no-preference", forced_colors="none")
            page.evaluate("show(false)")
            expect(page.locator('.activity-indicator')).to_have_count(0)
            page.evaluate("root.unmount()")
            expect(page.locator('.activity-indicator')).to_have_count(0)
            assert page.evaluate("document.getAnimations().length") == 0
        finally:
            browser.close()


def test_existing_function_structure_without_added_logos(tmp_path: Path) -> None:
    """Exercise actual stream events, store, bubble, disclosure and CSS together."""
    from playwright.sync_api import expect, sync_playwright

    entry = r'''
import React from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {AssistantBubble} from './components/chat/messages/assistant-bubble';
import {useSessionStore} from './lib/session-store';
import {applyChatWsMessage} from './lib/net/chat-stream';
window.fetch=async()=>new Response('{}',{headers:{'content-type':'application/json'}});
useSessionStore.setState({currentSessionId:'activity-layout',activeChatKey:'activity-layout'});
const sid='activity-layout', uid='turn', rid=uid+'_reply';
window.event=(event)=>applyChatWsMessage({type:'chat_response',data:{type:'stream_event',session_id:sid,msg_id:uid,event}});
applyChatWsMessage({type:'chat_ack',data:{session_id:sid,msg_id:uid}});
window.event({type:'tool_use',tool:'bash',tool_call_id:'old',input:'{}'});
window.event({type:'tool_result',tool:'bash',tool_call_id:'old',result:''});
window.event({type:'text',text:'The page is ready. Checking the current function.'});
window.event({type:'tool_use',tool:'gui_agent',tool_call_id:'gui',input:'{"task":"Check the currently open page"}'});
window.snapshot=()=>useSessionStore.getState().messagesById[rid];
window.replaceReply=(patch)=>useSessionStore.getState().updateMessage(sid,rid,patch);
function App(){const msg=useSessionStore(s=>s.messagesById[rid]);return <AssistantBubble msg={msg} sessionIdOverride={sid}/>;}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient()}><App/></QueryClientProvider>);
'''
    bundle = tmp_path / 'layout.js'
    subprocess.run(['node', '-e', "require('esbuild').buildSync({stdin:{contents:process.argv[3],resolveDir:process.argv[1],loader:'tsx'},bundle:true,format:'iife',platform:'browser',jsx:'automatic',loader:{'.css':'css'},outfile:process.argv[2],tsconfig:process.argv[1]+'/tsconfig.json'});", str(WEB), str(bundle), entry], cwd=ROOT, check=True, capture_output=True)
    with sync_playwright() as runtime:
        browser = runtime.chromium.launch()
        try:
            page = browser.new_page(viewport={'width':760,'height':520})
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.route('http://activity.test/**', lambda route: route.fulfill(body='<!doctype html><div id="root"></div>', content_type='text/html'))
            page.goto('http://activity.test/')
            if bundle.with_suffix('.css').exists():
                page.add_style_tag(path=str(bundle.with_suffix('.css')))
            for sheet in ['base.css','chat/bubbles.css','chat/stream-blocks.css','chat/execution-strip.css','chat/message-actions.css','chat/thinking-spinner.css','chat/typing-indicator.css']:
                page.add_style_tag(path=str(WEB / 'app/styles' / sheet))
            page.add_style_tag(content=':root{color-scheme:light;--bg-primary:#faf9f6;--bg-secondary:#f1f0ed;--text-primary:#343432;--text-secondary:#626260;--text-muted:#92928e;--accent-blue:#cf7d8b;--accent-purple:#a268d4} body{background:var(--bg-primary);font-family:Arial,sans-serif;margin:0} #root{padding:24px;max-width:720px}')
            page.add_script_tag(path=str(bundle))
            summaries = page.locator('.tl-toggle')
            expect(summaries).to_have_count(2)
            active = summaries.last
            # Agentic calls intentionally have no flat ChatToolCall record.
            assert page.evaluate("snapshot().tools.some(t=>t.tool==='gui_agent')") is False
            expect(active.locator('.activity-indicator')).to_have_count(0)
            page.screenshot(path=str(tmp_path/'before-layout.png'))
            labels = page.locator('.tl-toggle > span:first-child')
            left = labels.last.bounding_box()['x']
            assert left == pytest.approx(labels.first.bounding_box()['x'], abs=.5)
            assert left == pytest.approx(page.locator('.chat-text').bounding_box()['x'], abs=.5)
            active.click()
            expect(active).to_have_attribute('aria-expanded','true')
            row = page.locator('.tl-body .tl-step-head').last
            expect(row.locator('.activity-indicator')).to_have_count(0)
            expect(row.locator('.lucide-wrench')).to_have_count(1)
            # Wait for the production disclosure transition to settle.
            page.wait_for_function("document.querySelector('.tl[data-open=\"1\"] .tl-collapse').getAnimations().length===0")
            page.wait_for_function("[...document.querySelectorAll('.tl[data-open=\"1\"] .tl-step')].every(e=>e.getAnimations().every(a=>a.playState==='finished'))")
            title = row.locator('.tl-step-title').bounding_box()
            assert title['x'] - left == pytest.approx(48, abs=.5)
            icon = row.locator('.tl-step-icon').bounding_box()
            assert icon['x'] == pytest.approx(left + 4, abs=.5)
            assert icon['width'] == 20
            assert icon['y']+icon['height']/2 == pytest.approx(title['y']+title['height']/2,abs=.5)
            assert row.bounding_box()['y'] - active.bounding_box()['y'] - active.bounding_box()['height'] <= 16
            page.screenshot(path=str(tmp_path/'active-layout.png'))
            page.set_viewport_size({'width':390,'height':620})
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            page.screenshot(path=str(tmp_path/'narrow-layout.png'))
            page.evaluate("event({type:'tool_result',tool:'gui_agent',tool_call_id:'gui',result:''})")
            expect(page.locator('.activity-indicator')).to_have_count(0)
            expect(row.locator('.activity-indicator')).to_have_count(0)
            assert labels.last.bounding_box()['x'] == pytest.approx(labels.first.bounding_box()['x'],abs=.5)
            # Content and execution rows keep their original renderer, without added logos.
            page.evaluate("event({type:'thinking',text:'Checking the result.'})")
            expect(page.locator('.activity-indicator')).to_have_count(0)
            page.evaluate("event({type:'tool_use',tool:'bash',tool_call_id:'next',input:'{}'})")
            expect(page.locator('.activity-indicator')).to_have_count(0)
            page.evaluate("event({type:'thinking',text:'Concurrent thinking.'})")
            expect(page.locator('.tl-step-note').last).to_contain_text('Concurrent thinking.')
            expect(page.locator('.activity-indicator')).to_have_count(0)
            page.evaluate("event({type:'retry',attempt:2,reason:'transport'})")
            expect(page.locator('.pending-label')).to_contain_text('Retrying 2')
            expect(page.locator('.activity-indicator')).to_have_count(0)
            page.evaluate("event({type:'tool_result',tool:'bash',tool_call_id:'next',result:'ok'})")
            page.evaluate("event({type:'text',text:'Finished.'})")
            expect(active.locator('.activity-indicator')).to_have_count(0)
            expect(page.locator('.activity-indicator')).to_have_count(0)
            expect(active).to_have_attribute('aria-expanded','true')
            # The only logo slot is the original empty model reply placeholder.
            page.evaluate("replaceReply({blocks:[],tools:[],content:'',thinking:'',retryStatus:undefined,status:'running'})")
            expect(page.locator('.activity-indicator')).to_have_count(1)
            page.evaluate("replaceReply({runtimeChildren:[{id:'legacy-call',role:'assistant',display:'runtime',function:'custom_agent',status:'running',content:''}]})")
            expect(page.locator('.activity-indicator')).to_have_count(0)
            page.evaluate("replaceReply({runtimeChildren:[],function:'custom_agent',display:'runtime'})")
            expect(page.locator('.activity-indicator')).to_have_count(0)
            page.evaluate("replaceReply({function:undefined,display:undefined,status:'done'})")
            expect(page.locator('.activity-indicator')).to_have_count(0)
            assert not errors, errors
        finally:
            browser.close()
