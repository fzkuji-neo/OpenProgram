"""Public Runtime/AgentSession recovery must share failure accounting."""
import asyncio

import pytest

from openprogram.agent.session import AgentSession
from openprogram.agentic_programming.runtime import Runtime
from openprogram.providers.structured_output import StructuredOutputValidationError
from openprogram.providers.types import AssistantMessage, EventDone, EventStart, TextContent, ToolCall
from openprogram.providers.utils.recovery import current_recovery

SCHEMA = {"type": "object", "properties": {"answer": {"type": "integer"}},
          "required": ["answer"], "additionalProperties": False}
ERROR = "Error Code None: Internal error during token generation"


@pytest.fixture(autouse=True)
def no_backoff(monkeypatch):
    monkeypatch.setattr("openprogram.agent.session.compute_backoff_ms", lambda *a: 0)
    monkeypatch.setattr("openprogram.agentic_programming.runtime._retry_sleep_seconds", lambda *a: 0)


def _response(model, content, n):
    return AssistantMessage(content=content, api=model.api, provider=model.provider,
                            model=model.id, timestamp=n,
                            stop_reason="toolUse" if isinstance(content[0], ToolCall) else "stop")


def test_runtime_session_transport_retries_consume_shared_allowance():
    calls, states = [], []

    async def stream(model, context, options=None):
        calls.append(1)
        states.append(current_recovery.get())
        if len(calls) <= 2:
            raise RuntimeError(ERROR)
        msg = _response(model, [TextContent(text="invalid JSON")], len(calls))
        yield EventStart(partial=msg)
        yield EventDone(reason="stop", message=msg)

    runtime = Runtime(call=lambda *a, **k: "unused", model="dummy", max_retries=3)
    with pytest.raises(StructuredOutputValidationError, match="not valid JSON"):
        runtime.exec("Return an answer", stream_fn=stream,
                     tools=[{"spec": {"name": "lookup", "description": "Read",
                                      "parameters": {"type": "object", "properties": {}}},
                             "execute": lambda: "evidence"}],
                     response_format={"type": "json_schema", "schema": SCHEMA, "fallback": "prompt"})
    assert len(calls) == 3
    assert states[-1].used == 2
    assert [a["reason"] for a in states[-1].attempts if a["kind"] == "reserve"] == ["transport", "transport"]


@pytest.mark.parametrize("exhausted", [False, True])
@pytest.mark.parametrize("structured", [False, True])
def test_runtime_session_preserves_completed_tools_and_original_failure(exhausted, structured):
    calls, effects, states = [], [], []

    async def stream(model, context, options=None):
        receipts = [m.tool_call_id for m in context.messages if m.role == "toolResult"]
        calls.append(receipts)
        states.append(current_recovery.get())
        n = len(calls)
        if n == 2 or (exhausted and n == 3):
            raise RuntimeError(ERROR)
        content = ([TextContent(text='{"answer":7}')] if receipts else
                   [ToolCall(id=f"lookup-{n}", name="lookup", arguments={})])
        msg = _response(model, content, n)
        yield EventStart(partial=msg)
        yield EventDone(reason=msg.stop_reason, message=msg)

    runtime = Runtime(call=lambda *a, **k: "unused", model="dummy", max_retries=2)
    kwargs = dict(stream_fn=stream,
                  tools=[{"spec": {"name": "lookup", "description": "Read",
                                   "parameters": {"type": "object", "properties": {}}},
                          "execute": lambda: effects.append(1) or "evidence"}],
                  response_format={"type": "json_schema", "schema": SCHEMA, "fallback": "prompt"})
    if not structured:
        kwargs.pop("response_format")
    if exhausted:
        with pytest.raises(Exception, match=ERROR):
            runtime.exec("Read once then answer", **kwargs)
        assert states[-1].phase == "paused"
    else:
        expected = {"answer": 7} if structured else '{"answer":7}'
        assert runtime.exec("Read once then answer", **kwargs) == expected
    assert calls == [[], ["lookup-1"], ["lookup-1"]]
    assert effects == [1]
    assert states[-1].used == 1


def test_standalone_agent_session_retains_retry_behavior_without_enclosing_state():
    calls = []
    model = Runtime(call=lambda *a, **k: "unused", model="dummy").api_model

    async def stream(model, context, options=None):
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError(ERROR)
        msg = _response(model, [TextContent(text="done")], len(calls))
        yield EventStart(partial=msg)
        yield EventDone(reason="stop", message=msg)

    session = AgentSession(model=model, stream_fn=stream)
    try:
        assert current_recovery.get() is None
        asyncio.run(session.run("Answer"))
        assert session.last_assistant.content[0].text == "done"
        assert len(calls) == 2
        assert current_recovery.get() is None
    finally:
        session.close()
