"""Public session execution and Context must be sufficient for chat."""
import asyncio
import threading

import pytest

from openprogram import Agent, Context
from openprogram.agent import dispatcher as D
from openprogram.store import SessionStore


def test_context_session_and_agent_turn(tmp_path, monkeypatch):
    store = SessionStore(tmp_path)
    context = Context.for_session(store, 'one', blocks={'facts': 'value'})
    seen = []
    def execute(req, **kwargs):
        seen.append((Context.current().session_id, Context.current().resolve_blocks()))
        kwargs['on_event']({'type': 'sample'})
        return D.TurnResult('done', 'u', 'a')
    monkeypatch.setattr(D, '_process_turn_once', execute)
    events = []
    try:
        result = Agent(context=context).run_turn(D.TurnRequest('one', 'hello', 'main', 'python'), on_event=events.append)
        assert result.final_text == 'done'
        assert seen == [('one', {'facts': 'value'})]
        assert events == [{'type': 'sample'}]
        assert Context.current() is None
    finally:
        store.close()


def test_chat_entry_uses_agent_subclass(monkeypatch):
    from openprogram import ChatAgent
    seen = []
    def run(self, request, **kwargs):
        seen.append(type(self))
        return D.TurnResult('done', 'u', 'a')
    monkeypatch.setattr(Agent, 'run_turn', run)
    assert D.process_user_turn(D.TurnRequest('one', 'hello', 'main', 'web')).final_text == 'done'
    assert seen == [ChatAgent]


def test_async_turn_cancellation_signals_worker(monkeypatch):
    entered, cancelled = threading.Event(), threading.Event()
    def execute(req, **kwargs):
        entered.set()
        assert kwargs['cancel_event'].wait(3)
        cancelled.set()
        return D.TurnResult('', 'u', 'a')
    monkeypatch.setattr(D, '_process_turn_once', execute)
    async def run():
        task = asyncio.create_task(Agent().arun_turn(D.TurnRequest('one', 'hello', 'main', 'python')))
        assert await asyncio.to_thread(entered.wait, 2)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert cancelled.is_set()
    asyncio.run(run())


def test_public_agent_runs_real_loop_with_context_and_history(tmp_path, monkeypatch):
    from tests.unit.agent.dispatcher.test_dispatcher_integration import _stub_model, make_text_stream_fn
    store = SessionStore(tmp_path)
    monkeypatch.setattr(D, '_resolve_model', lambda *a, **kw: _stub_model())
    monkeypatch.setattr(D, '_load_agent_profile', lambda _: {'id': 'main', 'tools': {'mode':'none'}, 'system_prompt':'system'})
    monkeypatch.setattr(D, '_resolve_tools', lambda *a, **kw: [])
    monkeypatch.setattr('openprogram.agent.session_db.default_db', lambda: store)
    seen = []
    async def stream(model, context, options):
        seen.append(context)
        async for event in make_text_stream_fn(['done'])(model, context, options):
            yield event
    agent = Agent(context=Context.for_session(store, 'one', blocks={'facts':'explicit-value'}), stream_fn=stream)
    try:
        one = agent.run_turn(D.TurnRequest('one', 'first-message', 'main', 'python'))
        two = agent.run_turn(D.TurnRequest('one', 'second-message', 'main', 'python'))
        assert not one.failed and not two.failed
        assert one.final_text == two.final_text == 'done'
        assert 'explicit-value' in str(seen[0].messages)
        assert 'first-message' in str(seen[1].messages)
        assert 'explicit-value' not in seen[0].system_prompt
        agent.run_turn(D.TurnRequest('one','without-history','main','python'), context=Context(history_filter=False))
        assert 'first-message' not in str(seen[-1].messages)
        assert Context.current() is None
    finally:
        store.close()


def test_context_session_mismatch_rejected_before_execution(tmp_path):
    store = SessionStore(tmp_path)
    try:
        agent = Agent(context=Context.for_session(store, 'one'))
        with pytest.raises(ValueError, match='same session'):
            agent.run_turn(D.TurnRequest('two', 'hello', 'main', 'python'))
        assert store.get_session('two') is None
    finally:
        store.close()


def test_tool_timeout_does_not_cancel_parent():
    parent = threading.Event()
    class Tools(Agent):
        method_options = {'slow': {'tool':True, 'timeout':0.01, 'register_globally':False}}
        async def slow(self):
            await asyncio.sleep(1)
    result = asyncio.run(Tools().slow._agent_tool.execute('timeout', {}, parent, None))
    assert result.is_error
    assert not parent.is_set()


def test_subclass_turn_override_is_not_wrapped_as_nested_function(monkeypatch):
    seen = []
    class Custom(Agent):
        instructions = None
        def run_turn(self, request, **options):
            seen.append('override')
            return super().run_turn(request, **options)
    def execute(req, **kwargs):
        from openprogram.agentic_programming.runtime_scope import _agent_graph_owner
        assert isinstance(_agent_graph_owner.get(), Custom)
        return D.TurnResult('done', 'u', 'a')
    monkeypatch.setattr(D, '_process_turn_once', execute)
    assert Custom().run_turn(D.TurnRequest('one', 'hello', 'main', 'python')).final_text == 'done'
    assert seen == ['override']


def test_agent_resume_preserves_frozen_request_and_subtype(monkeypatch):
    from types import SimpleNamespace
    from openprogram import ChatAgent
    request = D.TurnRequest('one', 'hello', 'main', 'python', profile_snapshot={'system_prompt':'frozen'})
    continuation = SimpleNamespace(request=request)
    seen = []
    def execute(value, **options):
        from openprogram.agentic_programming.turn_api import _current_turn_agent
        seen.append(type(_current_turn_agent.get()))
        assert value.request.profile_snapshot == {'system_prompt':'frozen'}
        return D.TurnResult('resumed', 'u', 'a')
    monkeypatch.setattr(D, 'execute_continuation', execute)
    result = ChatAgent(instructions='changed').resume_turn(continuation)
    assert result.final_text == 'resumed' and seen == [ChatAgent]
