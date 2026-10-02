"""Nested Runtime authentication and terminal errors through public entries."""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from openprogram.agentic_programming.runtime import Runtime
from openprogram.auth.types import Credential, CredentialData
from openprogram.providers.types import Model
from openprogram.providers.utils.errors import ErrorReason, LLMError
from openprogram.providers.utils.stream_retry import ProviderStreamError


@pytest.mark.parametrize("profile", [None, "pinned-account"])
def test_codex_runtime_uses_provider_active_account_unless_explicit(monkeypatch, profile):
    from openprogram.auth.account import account_selection
    from openprogram.providers import enabled_models, models, registry
    from openprogram.providers.openai_codex import runtime as codex

    monkeypatch.setattr(account_selection, "_read", lambda: {"openai-codex": "active-account"})
    calls = []
    def acquire(provider, account):
        calls.append((provider, account))
        return Credential(provider_id=provider, account_id=account, kind="oauth",
                          payload=CredentialData(kind="oauth", auth_value="fake-token"),
                          metadata={"account_id": "fake-chatgpt-account"})
    monkeypatch.setattr(codex, "get_credential_provider", lambda: SimpleNamespace(acquire_sync=acquire))
    monkeypatch.setattr(codex, "codex_client_version", lambda: "0.153.4")
    model = Model(id="test-model", name="Test", provider="openai-codex", api="openai-codex",
                  base_url="https://example.invalid")
    monkeypatch.setattr(enabled_models, "ENABLED_MODELS", {"openai-codex/test-model": model})
    monkeypatch.setattr(models, "ENABLED_MODELS", {"openai-codex/test-model": model})
    with registry.create_runtime(provider="openai-codex", model="test-model", profile=profile) as runtime:
        assert calls == [("openai-codex", profile or "active-account")]
        assert runtime.api_model.headers["chatgpt-account-id"] == "fake-chatgpt-account"


@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.parametrize("reason,status", [(ErrorReason.AUTHENTICATION, 401),
                                         (ErrorReason.AUTHORIZATION, 403),
                                         (ErrorReason.UNKNOWN, None)])
def test_runtime_preserves_nonretryable_provider_verdict(monkeypatch, asynchronous, reason, status):
    from openprogram.providers.utils.event_stream import EventStream
    from openprogram.agentic_programming.runtime import execution

    monkeypatch.setattr(execution, "_retry_sleep_seconds", lambda *_: 0)
    calls = []
    failure = ProviderStreamError("token_revoked" if status else "opaque terminal failure",
                                  retryable=False, http_status=status, retry_after_s=30)
    def stream(*_args, **_kwargs):
        calls.append(True)
        events = EventStream()
        events.fail(failure)
        return events
    with Runtime(model="default", max_retries=3) as runtime:
        runtime.api_model = Model(id="test-model", name="Test", provider="openai",
                                  api="openai-completions", base_url="https://example.invalid")
        runtime.model = "openai:test-model"
        runtime.provider_id = "openai"
        runtime._stream_fn = stream
        with pytest.raises(LLMError) as caught:
            if asynchronous:
                asyncio.run(runtime.async_exec(content="test"))
            else:
                runtime.exec(content="test", tools=[], max_iterations=1)
        assert len(calls) == 1
        assert caught.value.reason is reason
        assert caught.value.retryable is False
        assert caught.value.attempts == 1
        assert caught.value.retry_after_s == 30


@pytest.mark.parametrize("asynchronous", [False, True])
def test_runtime_retains_transient_provider_recovery(monkeypatch, asynchronous):
    from openprogram.providers.types import AssistantMessage, EventStart, EventDone, TextContent
    from openprogram.agent import session

    monkeypatch.setattr(session, "compute_backoff_ms", lambda *_: 0)
    calls = []
    async def stream(model, *_args, **_kwargs):
        calls.append(True)
        if len(calls) == 1:
            raise ProviderStreamError("temporary upstream failure", http_status=503, retryable=True)
        response = AssistantMessage(content=[TextContent(text="recovered")], api=model.api,
                                    provider=model.provider, model=model.id, timestamp=1)
        yield EventStart(partial=response)
        yield EventDone(reason="stop", message=response)
    with Runtime(model="default", max_retries=3) as runtime:
        runtime.api_model = Model(id="test-model", name="Test", provider="openai",
                                  api="openai-completions", base_url="https://example.invalid")
        runtime.model = "openai:test-model"
        runtime.provider_id = "openai"
        runtime._stream_fn = stream
        result = (asyncio.run(runtime.async_exec(content="test")) if asynchronous
                  else runtime.exec(content="test", tools=[], max_iterations=1))
        assert result == "recovered"
        assert len(calls) == 2
