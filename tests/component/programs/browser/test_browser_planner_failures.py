"""Browser planner failures through the real Runtime and public task."""
import pytest

from tests.component.programs.browser.test_browser_agent import _controller


@pytest.mark.usefixtures("owned_page_scope")
@pytest.mark.parametrize('route', ['legacy', 'commands'])
@pytest.mark.parametrize('mode', ['invalid', 'unmet', 'repair', 'stop', 'deny'])
def test_invalid_verify_is_repaired_or_stops_with_actual_error(monkeypatch, mode, route):
    from openprogram.agentic_programming.runtime import Runtime
    from openprogram.programs.workflow import browser
    from openprogram.providers.types import AssistantMessage, EventStart, EventDone, ToolCall
    from openprogram.agent.authority import local_owner_authority
    from openprogram.agent.dispatcher import TurnRequest
    from openprogram.agent.turn_request_context import set_turn_request, reset_turn_request
    controller, api = _controller()
    monkeypatch.setattr(browser, '_new_controller', lambda: controller)
    if route == 'commands':
        from openprogram.agent import surface_context
        from openprogram.programs.workflow.browser import web_use_runtime
        context = {'context_id': 'fixture'}
        class Registry:
            def list_pages(self, **kwargs):
                return {'ok': True, 'pages': [{'page_context_token': 'fixture-page'}]}
            def execute(self, *, command, arguments=None, **kwargs):
                if command == 'close':
                    controller.close()
                    return {'ok': True}
                result = controller.execute(**(arguments or {'action': 'observe'}))
                return {**result, 'web_session_id': 'fixture-session'}
        monkeypatch.setattr(web_use_runtime, 'get_registry', Registry)
        monkeypatch.setattr(surface_context, 'current', lambda: context)
        monkeypatch.setattr(surface_context, 'capture_pages', lambda *_: context)
    calls = []
    async def stream(_model, context, _options):
        calls.append(context)
        args = dict(action='verify', expected_frame_id=controller._frame['frame_id'],
                    assertion='title_contains', text='Fixture', value=None)
        if mode == 'unmet':
            args['value'] = 'Absent title'
        if mode == 'repair' and len(calls) > 1:
            args['value'] = 'Fixture'
        if mode == 'stop':
            args = dict(action='stop', text='File not available')
        if mode == 'deny':
            args = dict(action='upload', ref='e1', path='/tmp/fixture.txt', expected_frame_id=controller._frame['frame_id'])
        reply = AssistantMessage(content=[ToolCall(id=f'v-{len(calls)}', name='browser_page', arguments=args)],
            api='completion', provider='test', model='test', stop_reason='toolUse', timestamp=1)
        yield EventStart(partial=reply)
        yield EventDone(reason='toolUse', message=reply)
    runtime = Runtime(call=lambda *_a, **_k: 'unused', max_retries=1)
    runtime._stream_fn = stream
    from openprogram.agent.session_config import PermissionRules
    token = set_turn_request(TurnRequest(session_id='planner-test', agent_id='main', user_text='Check title',
        permission_mode='bypass', source='web', permission_rules=PermissionRules(deny=['browser_page']) if mode == 'deny' else None, **local_owner_authority()))
    try:
        if route == 'legacy':
            result = browser.browser_agent(task='Check title', runtime=runtime, max_steps=2)
        else:
            result = browser._run_browser_task_commands(task='Check title', runtime=runtime, max_steps=2, max_seconds=30, backend='playwright_mcp')
        assert len(calls) == {'repair': 2, 'invalid': 3, 'unmet': 3, 'stop': 1, 'deny': 1}[mode]
        assert result['reason_code'] == {'repair': 'verified', 'invalid': 'invalid_assertion', 'unmet': 'assertion_not_met', 'stop': 'task_blocked', 'deny': 'tool_execution_failed'}[mode]
        assert controller._mutations == 0
        if mode == 'unmet':
            assert 'Absent title' in result['summary']
        if mode == 'invalid':
            assert 'value' in result['summary']
            assert not result.get('completion_evidence')
        assert api.closed == ['br_test']
    finally:
        reset_turn_request(token)
        runtime.close()
