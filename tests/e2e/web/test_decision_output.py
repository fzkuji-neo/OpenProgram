"""Real decision cards and Composer, with a controlled HTTP receipt boundary.

These focused browser tests do not start a worker or contact a real provider.
They exercise the production question component, answer hook and chat composer.
"""
from pathlib import Path
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[3]
pytestmark = pytest.mark.browser

ENTRY = r'''
import React from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {Composer} from './components/chat/composer';
import {DecisionOutputs} from './components/chat/messages/decision-output';
import {useSessionStore} from './lib/session-store';
import {SessionScopeProvider} from './lib/session-store/session-scope';
import {queueFor} from './lib/chat/send-queue';
import {setSocket, runtimeState} from './lib/runtime-bridge/state';
window.commands = [];
window.framesSent = [];
window.pendingHTTP = [];
class Socket extends EventTarget {
  static OPEN = 1;
  readyState = 1;
  send(wire) { window.framesSent.push(JSON.parse(wire)); }
}
window.WebSocket = Socket;
setSocket(new Socket());
window.fetch = async (url, init = {}) => {
  const path = String(url);
  if (path.startsWith('/api/execution/wait/')) {
    const command = JSON.parse(init.body);
    window.commands.push(command);
    return new Promise(resolve => window.pendingHTTP.push({command, resolve}));
  }
  if (path === '/api/models/enabled') return Response.json({models:[{id:'test',provider:'fake'}]});
  if (path === '/api/skills') return Response.json([]);
  if (path === '/api/tool-profiles') return Response.json({profiles:{}});
  return Response.json({});
};
window.releaseAnswer = (status = 200) => {
  const {command, resolve} = window.pendingHTTP.shift();
  resolve(status === 200 ? Response.json({command:{command_id:command.command_id,status:'applied'}})
    : Response.json({error:'test_gateway_unavailable'}, {status}));
};
useSessionStore.setState({currentSessionId:'main',activeChatKey:'main',welcomeVisible:false,
  composerDrafts:{},pendingDecisions:[],
  runningTasks:{main:{session_id:'main',msg_id:'running-main',execution_id:'exec-main',status_version:7}},
  agentSettings:{chat:{model:'test',provider:'fake'},exec:{model:'test',provider:'fake'}},
});
runtimeState.currentSessionId = 'main';
window.addDecision = (sid = 'main', kind = 'ask') => {
  const q = {id:`${sid}-${kind}`,sessionId:sid,executionId:`exec-${sid}`,expectedVersion:7,
    waitGeneration:1,kind,prompt:`Question for ${sid}`,options:[],multi:false,allow_custom:true};
  if (kind === 'form') q.schema = {member:{type:'string',title:'Member'}};
  if (kind === 'approval') {q.tool='shell';q.args={command:'echo synthetic'};}
  if (kind === 'ask_many') q.questions = [
    {prompt:'First item',options:['Alpha'],multi:false,allow_custom:false},
    {prompt:'Second item',options:['Beta'],multi:false,allow_custom:false},
  ];
  useSessionStore.getState().enqueueDecision(q);
};
window.readQueue = sid => queueFor(sid);
function Pane({sid}) {
 return <SessionScopeProvider sid={sid}><section data-pane={sid}>
   <div data-output={sid}><DecisionOutputs sessionId={sid}/></div>
   <div data-input={sid}><Composer sessionId={sid}/></div>
 </section></SessionScopeProvider>;
}
const client = new QueryClient({defaultOptions:{queries:{retry:false}}});
createRoot(document.getElementById('mount')).render(<QueryClientProvider client={client}>
  <Pane sid="main"/><Pane sid="peer"/>
</QueryClientProvider>);
'''


@pytest.fixture(scope="module")
def decision_bundle(tmp_path_factory):
    directory = tmp_path_factory.mktemp("decision-output")
    bundle = directory / "decision.js"
    subprocess.run([
        "node", "-e",
        "require('esbuild').buildSync({stdin:{contents:process.argv[3],resolveDir:process.argv[1],loader:'tsx'},bundle:true,format:'iife',platform:'browser',jsx:'automatic',loader:{'.css':'empty'},outfile:process.argv[2],tsconfig:process.argv[1]+'/tsconfig.json'});",
        str(ROOT / "apps/web"), str(bundle), ENTRY,
    ], cwd=ROOT, check=True, capture_output=True)
    shell = directory / "decision.html"
    shell.write_text("<!doctype html><style>section[data-pane]{width:700px;margin:20px}button,input,textarea{margin:5px}svg{max-width:24px;max-height:24px}</style><div id='mount'></div>")
    return shell, bundle


@pytest.fixture
def decision_page(decision_bundle):
    from playwright.sync_api import sync_playwright
    shell, bundle = decision_bundle
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1400, "height": 1000})
        page.set_default_timeout(5000)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(shell.as_uri())
        page.add_script_tag(path=str(bundle))
        yield page
        browser.close()
        assert errors == []


def test_question_arrival_preserves_draft_focus_and_chat_submit(decision_page):
    from playwright.sync_api import expect
    page = decision_page
    main = page.locator('[data-input="main"] textarea')
    main.fill("This is a queued chat message")
    page.evaluate("window.addDecision('main'); window.addDecision('peer')")
    expect(main).to_be_focused()
    expect(main).to_have_value("This is a queued chat message")
    expect(page.locator('[data-output="main"] [data-decision-output="main-ask"]')).to_be_visible()
    expect(page.locator('[data-input] [data-decision-output]')).to_have_count(0)
    expect(page.locator('[data-output="main"] [data-decision-output="peer-ask"]')).to_have_count(0)
    page.locator('[data-input="main"]').get_by_role("button", name="Send message", exact=True).click()
    expect(main).to_have_value("")
    assert page.evaluate("window.readQueue('main')[0].text") == "This is a queued chat message"
    assert page.evaluate("window.commands") == []
    # An idle peer still sends regular chat while its independent question waits.
    peer = page.locator('[data-input="peer"] textarea')
    peer.fill("Regular peer chat")
    page.locator('[data-input="peer"]').get_by_role("button", name="Send message", exact=True).click()
    page.wait_for_function("window.framesSent.some(x => x.content === 'Regular peer chat' || x.message === 'Regular peer chat' || x.text === 'Regular peer chat')")
    assert page.evaluate("window.commands") == []


def test_answer_feedback_retry_keeps_identity_and_receipt(decision_page):
    from playwright.sync_api import expect
    page = decision_page
    page.evaluate("window.addDecision('main'); window.addDecision('peer')")
    card = page.locator('[data-decision-output="main-ask"]')
    card.get_by_placeholder("Type your answer…").fill("TestAlice")
    card.get_by_role("button", name="Send", exact=True).click()
    expect(card).to_have_attribute("data-decision-status", "sending")
    expect(card.get_by_role("status")).to_contain_text("TestAlice")
    expect(card.get_by_role("button", name="Sending…", exact=True)).to_be_disabled()
    page.evaluate("window.releaseAnswer(503)")
    expect(card).to_have_attribute("data-decision-status", "unknown")
    expect(card.get_by_role("status")).to_contain_text("HTTP 503")
    expect(card.get_by_placeholder("Type your answer…")).to_be_disabled()
    card.get_by_role("button", name="Retry", exact=True).click()
    page.wait_for_function("window.commands.length === 2")
    assert page.evaluate("window.commands[0]") == page.evaluate("window.commands[1]")
    page.evaluate("window.releaseAnswer()")
    expect(card).to_have_attribute("data-decision-status", "answered")
    expect(card).to_contain_text("TestAlice")
    expect(card.get_by_role("status")).to_have_text("Answer confirmed")
    expect(page.locator('[data-decision-output="peer-ask"]')).to_have_attribute("data-decision-status", "open")


@pytest.mark.parametrize("kind,answer", [
    ("form", {"member": "TestAlice"}),
    ("approval", {"answer": "approve", "scope": "once"}),
    ("ask_many", ["Alpha", "Beta"]),
])
def test_decision_variants_submit_from_output(decision_page, kind, answer):
    from playwright.sync_api import expect
    page = decision_page
    page.evaluate("kind => window.addDecision('main', kind)", kind)
    card = page.locator(f'[data-decision-output="main-{kind}"]')
    if kind == "form":
        card.get_by_label("Member", exact=True).fill("TestAlice")
    elif kind == "ask_many":
        card.get_by_role("button", name="Alpha", exact=True).click()
        card.get_by_role("button", name="Next ›", exact=True).click()
        card.get_by_role("button", name="Beta", exact=True).click()
    card.get_by_role("button", name="Allow once" if kind == "approval" else "Send", exact=True).click()
    page.wait_for_function("window.commands.length === 1")
    assert page.evaluate("window.commands[0].payload.answer") == answer
    page.evaluate("window.releaseAnswer()")
    expect(card.get_by_role("status")).to_have_text("Answer confirmed")
    expect(page.locator('[data-input="main"] textarea')).to_be_visible()
