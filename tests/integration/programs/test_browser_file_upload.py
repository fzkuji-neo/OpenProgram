"""File selection and independent verification in owned headless Chromium."""

import pytest
from openprogram.programs.workflow.browser import BrowserPageController
from tests.integration.programs.test_browser_observation_privacy import _OwnedBrowserAPI

pytestmark = pytest.mark.browser

@pytest.fixture
def controller():
    controller = BrowserPageController(browser_api=_OwnedBrowserAPI(''))
    try:
        controller.execute(action='observe')
        controller.evaluate_bound_page('() => { document.body.innerHTML = `<input type="file" aria-label="Attachment"><p id="status">Not submitted</p>`; }')
        yield controller
    finally:
        controller.close()


def observe(controller):
    frame = controller.execute(action='observe')
    return frame, next(e for e in frame['elements'] if e['name'] == 'Attachment')


def test_upload_selects_exact_file_then_requires_separate_verification(controller, tmp_path):
    path = tmp_path/'sample.txt'; path.write_text('test only')
    frame, field = observe(controller)
    result = controller.execute(action='upload', expected_frame_id=frame['frame_id'], ref=field['ref'], path=str(path))
    assert result['ok'] is True
    assert result['server_acceptance_verified'] is False
    assert controller.final_result(summary='')['status'] == 'failed'
    fresh, field = observe(controller)
    assert field['input_type'] == 'file'
    assert field['files'] == ['sample.txt']
    assert str(path) not in str(fresh)
    result = controller.execute(action='verify', expected_frame_id=fresh['frame_id'], ref=field['ref'],
                                assertion='file_selected', value='sample.txt')
    assert result['passed'] is True
    assert controller.final_result(summary='File selected')['status'] == 'succeeded'
    controller.evaluate_bound_page("() => document.querySelector('input').value = ''")
    assert controller.final_result(summary='')['status'] == 'failed'


@pytest.mark.parametrize('blocked', ['sandbox', 'missing', 'nonfile', 'stale', 'disabled', 'cancel'])
def test_upload_rejects_without_selecting_any_file(controller, tmp_path, monkeypatch, blocked):
    from openprogram import sandbox
    path = tmp_path/'test.txt'; path.write_text('must not transmit')
    frame, field = observe(controller)
    if blocked == 'sandbox':
        original = sandbox.policy_snapshot()
        sandbox.install_policy_snapshot({'enabled': True, 'policy': sandbox.policy_to_dict(
            sandbox.SandboxPolicy(deny_read=(str(path),), writable_roots=(str(tmp_path),), deny_write=()))})
    if blocked == 'missing':
        path = tmp_path/'absent.txt'
    if blocked in {'nonfile', 'disabled'}:
        controller.evaluate_bound_page("kind => {const el=document.querySelector('input'); if(kind==='nonfile') el.type='text'; else el.disabled=true;}", blocked)
        frame, field = observe(controller)
    kwargs = dict(action='upload', expected_frame_id='old' if blocked == 'stale' else frame['frame_id'],
                  ref=field['ref'], path=str(path))
    try:
        if blocked == 'cancel':
            from openprogram.programs.workflow.browser._runtime import file_inputs
            original_read = file_inputs.file_payload
            read_done = []
            def read(path):
                result = original_read(path); read_done.append(True); return result
            monkeypatch.setattr(file_inputs, 'file_payload', read)
            def guard():
                if read_done:
                    raise PermissionError('cancelled after file read')
            with pytest.raises(PermissionError, match='cancelled'):
                controller.execute(**kwargs, before_dispatch=guard)
        else:
            result = controller.execute(**kwargs)
            assert result['ok'] is False
        assert controller._mutations == 0
        assert controller.evaluate_bound_page("() => document.querySelector('input').files?.length || 0") == 0
    finally:
        if blocked == 'sandbox':
            sandbox.install_policy_snapshot(original)


def test_uncertain_upload_is_not_replayed(controller, tmp_path, monkeypatch):
    path = tmp_path/'test.txt'; path.write_text('once')
    frame, field = observe(controller)
    handle = controller._refs[field['ref']]
    actual = handle.set_input_files
    calls = []
    def uncertain(*args):
        calls.append(1)
        actual(*args)
        raise RuntimeError('receipt unavailable after mutation')
    monkeypatch.setattr(handle, 'set_input_files', uncertain)
    result = controller.execute(action='upload', expected_frame_id=frame['frame_id'], ref=field['ref'], path=str(path))
    assert result['reason_code'] == 'file_selection_unconfirmed'
    frame, field = observe(controller)
    again = controller.execute(action='upload', expected_frame_id=frame['frame_id'], ref=field['ref'], path=str(path))
    assert again['reason_code'] == 'file_selection_unconfirmed'
    assert calls == [1]
    assert controller._mutations == 1


def test_public_browser_task_uploads_once_and_verifies_real_server_ack(monkeypatch, tmp_path):
    import threading
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    from openprogram.agentic_programming.runtime import Runtime
    from openprogram.programs.workflow import browser
    from openprogram.providers.types import AssistantMessage, EventStart, EventDone, ToolCall
    from openprogram.agent.authority import local_owner_authority
    from openprogram.agent.dispatcher import TurnRequest
    from openprogram.agent.turn_request_context import set_turn_request, reset_turn_request
    uploads = []
    html = b'''<input type="file" aria-label="Attachment"><p id="status">Not submitted</p>
    <script>document.querySelector('input').onchange=async e=>{
      const response=await fetch('/upload',{method:'POST',body:e.target.files[0]});
      document.querySelector('#status').textContent=await response.text();};</script>'''
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200); self.send_header('Content-Type','text/html'); self.end_headers()
            self.wfile.write(html)
        def do_POST(self):
            uploads.append(self.rfile.read(int(self.headers['Content-Length'])))
            self.send_response(200); self.end_headers(); self.wfile.write(b'Accepted fixture file')
        def log_message(self, *args):
            pass
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    class API(_OwnedBrowserAPI):
        def execute(self, *, action, **kwargs):
            result = super().execute(action=action, **kwargs)
            if action == 'open':
                self._sessions['br_private']['page'].goto(f'http://127.0.0.1:{server.server_port}/')
            return result
    controller = BrowserPageController(browser_api=API(''))
    monkeypatch.setattr(browser, '_new_controller', lambda: controller)
    path = tmp_path/'fixture.txt'; path.write_bytes(b'fixture bytes only')
    calls = []
    async def stream(_model, context, _options):
        calls.append(context)
        frame = controller._frame
        ref = next(e['ref'] for e in frame['elements'] if e['name'] == 'Attachment')
        if len(calls) == 1:
            args = dict(action='verify', assertion='text_contains', text='Accepted fixture file', value=None)
        elif len(calls) == 2:
            args = dict(action='upload', ref=ref, path=str(path))
        else:
            assert controller._mutations == 1
            controller._submit(lambda: controller._page().locator('#status', has_text='Accepted fixture file').wait_for(timeout=3000))
            args = dict(action='verify', assertion='text_contains', value='Accepted fixture file')
        reply = AssistantMessage(content=[ToolCall(id=f'f-{len(calls)}', name='browser_page',
            arguments={**args, 'expected_frame_id':frame['frame_id']})],
            api='completion',provider='test',model='test',stop_reason='toolUse',timestamp=1)
        yield EventStart(partial=reply)
        yield EventDone(reason='toolUse',message=reply)
    runtime = Runtime(call=lambda *_a, **_k: 'unused', max_retries=1); runtime._stream_fn = stream
    token = set_turn_request(TurnRequest(session_id='upload-fixture',agent_id='main',user_text='Upload the fixture',
        permission_mode='bypass',source='web',**local_owner_authority()))
    try:
        result = browser.browser_agent(task='Upload fixture.txt and verify server acceptance',runtime=runtime,max_steps=1)
        assert result['status'] == 'succeeded', result
        assert result['steps_taken'] == 1
        assert len(calls) == 3
        assert uploads == [b'fixture bytes only']
        assert result['completion_evidence'][0]['value'] == 'Accepted fixture file'
    finally:
        reset_turn_request(token); runtime.close()
        if controller.session_id:
            controller.close()
        server.shutdown(); server.server_close(); thread.join()
