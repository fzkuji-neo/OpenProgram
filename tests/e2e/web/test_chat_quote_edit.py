"""User-facing quote and rich edit interactions, including split ownership."""
from pathlib import Path
import subprocess
import pytest

ROOT = Path(__file__).resolve().parents[3]
pytestmark = pytest.mark.browser


@pytest.mark.parametrize("reduced_motion", ["no-preference", "reduce"])
def test_quote_and_edit_in_split_conversations(tmp_path, reduced_motion):
    from playwright.sync_api import sync_playwright, expect
    entry = r'''
import React from 'react';import {createRoot} from 'react-dom/client';
import {UserBubble} from './components/chat/messages/user-bubble';
import {SelectionQuote} from './components/chat/messages/quote-to-chat';
import {useSessionStore} from './lib/session-store';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
window.edits=[];window.failEdit=true;window.checkouts=[];window.failCheckout=true;window.loads=[];
import {setSocket} from './lib/runtime-bridge/state';
setSocket({readyState:1,send:value=>window.loads.push(JSON.parse(value))});
const canvas=document.createElement('canvas');canvas.width=2;canvas.height=2;const png=canvas.toDataURL('image/png').split(',')[1];window.png=png;window.rawUrls=[];
window.fetch=async(url,options)=>{
 if(String(url).includes('raw')){window.rawUrls.push(String(url));return new Response(Uint8Array.from(atob(png),c=>c.charCodeAt(0)),{headers:{'Content-Type':'image/png'}});}
 if(String(url)==='/api/chat/checkout'){window.checkouts.push(JSON.parse(options.body));return new Response(JSON.stringify(window.failCheckout?{error:'Checkout failed'}:{head_id:'right-msg'}),{status:window.failCheckout?503:200});}
 if(String(url)==='/api/chat/edit'){window.edits.push(JSON.parse(options.body));return new Response(JSON.stringify(window.failEdit?{error:'Temporary failure'}:{msg_id:'new'}),{status:window.failEdit?503:200});}
 return new Response('{}',{status:200});
};
useSessionStore.setState({currentSessionId:'left',activeChatKey:'left',composerDrafts:{left:'left draft',right:'right draft'}});
window.drafts=()=>useSessionStore.getState().composerDrafts;
function Pane({id}){const draft=useSessionStore(s=>s.composerDrafts[id]||'');return <section data-pane={id}>
 <div className="chat-messages"><SelectionQuote sessionId={id}/><UserBubble sessionIdOverride={id} msg={{id:id+'-msg',role:'user',content:'[attachment: original.png (png, 1 KB) @json "/original.png" @previewjson "/saved.png"]\n[attachment: original.pdf (pdf, 1 KB) @json "/original.pdf"]\n\nOriginal message https://example.com'}}/></div>
 <div data-composer-session={id}><textarea aria-label={id+' draft'} value={draft} onChange={e=>useSessionStore.getState().setComposerInputFor(id,e.target.value)}/></div>
 </section>;}
createRoot(document.getElementById('mount')).render(<QueryClientProvider client={new QueryClient()}><Pane id="left"/><Pane id="right"/></QueryClientProvider>);
'''
    bundle = tmp_path/'quote-edit.js'
    subprocess.run(['node','-e',"require('esbuild').buildSync({stdin:{contents:process.argv[3],resolveDir:process.argv[1],loader:'tsx'},bundle:true,format:'iife',platform:'browser',jsx:'automatic',loader:{'.css':'css'},outfile:process.argv[2],tsconfig:process.argv[1]+'/tsconfig.json'});",str(ROOT/'apps/web'),str(bundle),entry],cwd=ROOT,check=True,capture_output=True)
    shell=tmp_path/'quote-edit.html'
    shell.write_text('<!doctype html><style>section{padding:20px}.message-content{white-space:pre-wrap}textarea{display:block;width:500px}button{min-width:25px;min-height:25px}svg{width:16px;height:16px}</style><div id="mount"></div>')
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True)
        try:
            page=browser.new_page(viewport={'width':1280,'height':1600}, reduced_motion=reduced_motion); errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto(shell.as_uri());page.add_style_tag(path=str(bundle.with_suffix('.css')));page.add_script_tag(path=str(bundle))
            right=page.locator('[data-pane="right"]'); left=page.locator('[data-pane="left"]')
            def assert_icon_feedback(button):
                # Observe the real SVG across frames; hovering the button padding
                # must animate even though the pointer does not touch the glyph.
                snapshot = "el => JSON.stringify([...el.querySelectorAll('svg, svg *')].map(node => {const s=getComputedStyle(node);return [s.transform,s.opacity,s.strokeDasharray,s.strokeDashoffset];}))"
                frames = """async el => {const out=[];for(let i=0;i<24;i++){await new Promise(requestAnimationFrame);out.push(JSON.stringify([...el.querySelectorAll('svg, svg *')].map(node=>{const s=getComputedStyle(node);return [s.transform,s.opacity,s.strokeDasharray,s.strokeDashoffset];})));}return out;}"""
                for interaction in ('hover', 'focus'):
                    page.mouse.move(0, 0)
                    button.evaluate('el => el.blur()')
                    # Wait for the upstream spring/path reset to settle.
                    page.wait_for_timeout(1100)
                    before = button.evaluate(snapshot)
                    if interaction == 'hover':
                        button.hover(position={'x':2,'y':2})
                    else:
                        button.focus()
                    changed = any(frame != before for frame in button.evaluate(frames))
                    assert changed == (reduced_motion == 'no-preference'), (button.inner_text(), interaction, reduced_motion)
                page.mouse.move(0, 0)
                button.evaluate('el => el.blur()')

            quote = right.get_by_role('button',name='Quote message',exact=True)
            assert_icon_feedback(quote)
            quote.click()
            expect(right.get_by_role('textbox',name='right draft')).to_have_value('right draft\n\n> Original message https://example.com\n\n')
            expect(left.get_by_role('textbox',name='left draft')).to_have_value('left draft')
            expect(right.get_by_role('textbox',name='right draft')).to_be_focused()
            # A selection remains hidden while the pointer is held; release exposes actions.
            right.locator('.message-content').dispatch_event('pointerdown', {'pointerId':1,'buttons':1})
            page.evaluate('''() => {const el=document.querySelector('[data-pane="right"] .message-content');const node=el.lastChild;const r=document.createRange();r.setStart(node,0);r.setEnd(node,8);window.getSelection().removeAllRanges();window.getSelection().addRange(r);}''')
            expect(page.get_by_role('button',name='Add to chat',exact=True)).to_have_count(0)
            right.locator('.message-content').dispatch_event('pointerup', {'pointerId':1,'buttons':0})
            expect(page.get_by_role('button',name='Chat in new branch',exact=True)).to_be_visible()
            assert_icon_feedback(page.get_by_role('button',name='Add to chat',exact=True))
            assert_icon_feedback(page.get_by_role('button',name='Chat in new branch',exact=True))
            page.get_by_role('button',name='Add to chat',exact=True).click()
            assert page.evaluate("window.drafts().right").endswith('> Original\n\n')
            assert page.evaluate("window.drafts().left") == 'left draft'
            # Branching uses the selected pane/message, and failures preserve drafts.
            page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
            right.locator('.message-content').scroll_into_view_if_needed()
            before_branch = page.evaluate("window.drafts().right")
            page.evaluate('''() => {const el=document.querySelector('[data-pane="right"] .message-content');const r=document.createRange();r.setStart(el.lastChild,0);r.setEnd(el.lastChild,8);window.getSelection().removeAllRanges();window.getSelection().addRange(r);}''')
            right.locator('.message-content').dispatch_event('pointerup')
            branch=page.get_by_role('button',name='Chat in new branch',exact=True)
            branch.click()
            expect(branch).to_be_enabled()
            assert page.evaluate('window.checkouts[0]') == {'session_id':'right','msg_id':'right-msg'}
            assert page.evaluate('window.drafts().right') == before_branch
            assert page.evaluate('window.loads.length') == 0
            page.evaluate('window.failCheckout=false')
            branch.click()
            expect(branch).to_have_count(0)
            load_request = page.evaluate('window.loads[0]')
            assert isinstance(load_request['request_id'], str) and load_request['request_id']
            assert load_request == {'action':'load_session','session_id':'right',
                                    'request_id':load_request['request_id']}
            assert page.evaluate('window.drafts().right') == before_branch + '\n\n> Original\n\n'
            assert page.evaluate('window.drafts().left') == 'left draft'
            right.get_by_role('button',name='Edit message',exact=True).click()
            editor=right.get_by_role('textbox',name='Edit message',exact=True)
            expect(editor).to_have_value('Original message https://example.com')
            editor.fill('Updated https://example.org')
            right.get_by_role('button',name='Remove original.pdf',exact=True).click()
            right.locator('input[type=file]').set_input_files({'name':'notes.txt','mimeType':'text/plain','buffer':b'hello attachment'})
            editor.evaluate("""el=>{const transfer=new DataTransfer();transfer.items.add(new File([Uint8Array.from(atob(window.png),c=>c.charCodeAt(0))],'pasted.png',{type:'image/png'}));el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));}""")
            save=right.get_by_role('button',name='Save & resend',exact=True)
            expect(save).to_be_enabled(); save.click()
            expect(right.get_by_role('alert')).to_have_text('Temporary failure')
            expect(editor).to_have_value('Updated https://example.org')
            payload=page.evaluate('window.edits[0]')
            assert payload['session_id']=='right'
            assert 'original.pdf' not in payload['content']
            assert payload['content'].count('[attachment: original.png')==1
            assert 'Updated https://example.org' in payload['content']
            assert next(a for a in payload['attachments'] if a['type']=='document')['data']=='aGVsbG8gYXR0YWNobWVudA=='
            image=next(a for a in payload['attachments'] if a['type']=='image')
            assert image['source_path']=='/original.png'
            assert image['filename']=='original.png'
            assert image['data']
            assert any(a['filename']=='pasted.png' and a['type']=='image' for a in payload['attachments'])
            assert any('/saved.png' in url or '%2Fsaved.png' in url for url in page.evaluate('window.rawUrls'))
            assert page.evaluate("window.drafts().left")=='left draft'
            page.evaluate('window.failEdit=false');save.click()
            expect(editor).to_have_count(0)
            # Cancel leaves both the stored message and bottom draft alone.
            left.get_by_role('button',name='Edit message',exact=True).click()
            left.get_by_role('textbox',name='Edit message',exact=True).fill('discard this')
            left.get_by_role('button',name='Cancel',exact=True).click()
            expect(left.locator('.message-content')).to_contain_text('Original message')
            assert page.evaluate('window.edits.length')==2
            assert not errors, errors
        finally:
            browser.close()
