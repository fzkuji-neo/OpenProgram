"""A retryable mid-stream APIError with only thinking content must retry.

xAI reasoning models routinely die mid-thinking with
``APIError: Internal error during token generation``. Thinking-only
output is not user-committed content, so the provider should discard it
and re-send the request instead of killing the turn.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import httpx
import pytest

from openprogram.providers.openai_completions import openai_completions
from openprogram.providers.types import Context, Model, SimpleStreamOptions


def _model():
    return Model(
        id="grok-test",
        name="Grok test",
        api="openai-completions",
        provider="openai",
        base_url="https://api.openai.com/v1",
    )


def _chunk(text=None, thinking=None, finish=None):
    return SimpleNamespace(
        usage=None,
        choices=[SimpleNamespace(
            delta=SimpleNamespace(
                reasoning_content=thinking,
                reasoning=None,
                content=text,
                tool_calls=None,
            ),
            finish_reason=finish,
        )],
    )


def _api_error():
    return openai_completions._openai.APIError(
        "Internal error during token generation",
        request=httpx.Request("POST", "https://api.x.ai/v1/chat/completions"),
        body=None,
    )


class _Stream:
    """Yield chunks; raise ``error`` after they run out (if set)."""

    def __init__(self, chunks, error=None):
        self._chunks = list(chunks)
        self._error = error

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return None

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self._chunks:
            return self._chunks.pop(0)
        if self._error is not None:
            raise self._error
        raise StopAsyncIteration


def _install(monkeypatch, streams):
    class Completions:
        async def create(self, **params):
            return streams.pop(0)

    class Client:
        def __init__(self, **kwargs):
            self.chat = SimpleNamespace(completions=Completions())

    monkeypatch.setattr(openai_completions._openai, "AsyncOpenAI", Client)
    monkeypatch.setattr(
        openai_completions, "stream_backoff_seconds", lambda *a, **kw: 0.0,
    )


def _consume():
    async def run():
        return [
            event async for event in openai_completions.stream_simple(
                _model(), Context(), SimpleStreamOptions(api_key="test-key"),
            )
        ]

    return asyncio.run(run())


def test_thinking_only_mid_stream_error_retries(monkeypatch):
    _install(monkeypatch, [
        _Stream([_chunk(thinking="half a thought")], error=_api_error()),
        _Stream([
            _chunk(thinking="fresh thought"),
            _chunk(text="answer", finish="stop"),
        ]),
    ])
    events = _consume()
    done = next(e for e in events if getattr(e, "type", None) == "done")
    blocks = done.message.content or []
    thinking = "".join(
        getattr(b, "thinking", "")
        for b in blocks if getattr(b, "type", None) == "thinking"
    )
    text = "".join(
        getattr(b, "text", "")
        for b in blocks if getattr(b, "type", None) == "text"
    )
    assert thinking == "fresh thought"  # discarded prefix is gone
    assert text == "answer"
    assert any(event.type == "retry" and event.reason == "transport" for event in events)


def test_goal_request_does_not_hide_an_extra_paid_attempt(monkeypatch):
    from openprogram.usage.context import UsageContext, _current
    streams = [
        _Stream([_chunk(thinking="partial")], error=_api_error()),
        _Stream([_chunk(text="second attempt", finish="stop")]),
    ]
    _install(monkeypatch, streams)
    token = _current.set(UsageContext(goal_id="goal", goal_revision=1, goal_session_id="session"))
    try:
        with pytest.raises(openai_completions._openai.APIError):
            _consume()
        assert len(streams) == 1
    finally:
        _current.reset(token)


def test_visible_text_mid_stream_error_does_not_retry(monkeypatch):
    _install(monkeypatch, [
        _Stream([_chunk(text="committed")], error=_api_error()),
        _Stream([_chunk(text="should never be requested", finish="stop")]),
    ])
    try:
        _consume()
    except openai_completions._openai.APIError:
        pass
    else:
        raise AssertionError("committed text must not be silently retried")


@pytest.mark.parametrize("finish", [None, "stop"])
def test_thinking_only_completion_requests_continuation(monkeypatch, finish):
    streams = [_Stream([_chunk(thinking="unfinished", finish=finish)])]
    _install(monkeypatch, streams)

    done = next(event for event in _consume() if event.type == "done")
    assert done.message.stop_reason == "length"
    assert [block.thinking for block in done.message.content if block.type == "thinking"] == ["unfinished"]
    assert streams == []


def test_eof_without_finish_reason_is_not_success(monkeypatch):
    streams = [_Stream([_chunk(text="partial")])]
    _install(monkeypatch, streams)

    done = next(event for event in _consume() if event.type == "done")
    assert done.message.stop_reason == "length"
    assert [block.text for block in done.message.content if block.type == "text"] == ["partial"]


def test_trailing_none_does_not_erase_explicit_length(monkeypatch):
    streams = [_Stream([_chunk(text="partial", finish="length"), _chunk()])]
    _install(monkeypatch, streams)

    done = next(event for event in _consume() if event.type == "done")
    assert done.message.stop_reason == "length"


@pytest.mark.parametrize("finish", [None, "length"])
def test_incomplete_tool_call_is_not_executable(monkeypatch, finish):
    tool_delta = SimpleNamespace(
        index=0, id="call_1",
        function=SimpleNamespace(name="Bash", arguments='{"cmd":"incomplete'),
    )
    chunk = _chunk(finish=finish)
    chunk.choices[0].delta.tool_calls = [tool_delta]
    _install(monkeypatch, [_Stream([chunk])])

    done = next(event for event in _consume() if event.type == "done")
    assert done.message.stop_reason == "length"
    assert all(block.type != "toolCall" for block in done.message.content)
