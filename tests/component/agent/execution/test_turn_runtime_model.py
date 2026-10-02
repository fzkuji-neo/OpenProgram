"""Nested tool runtimes honour the foreground turn's model selection."""
from types import SimpleNamespace

import pytest

from openprogram.agent.dispatcher.turn_context import TurnBindings
from openprogram.agent.dispatcher.types import TurnRequest
from openprogram.agent.session_db import SessionDB
from openprogram.agentic_programming.function import _current_runtime


@pytest.mark.parametrize("selection", ["override", "session", "snapshot", "profile"])
def test_tool_runtime_uses_chat_model(tmp_path, monkeypatch, selection):
    from openprogram.agent import dispatcher, session_model
    from openprogram.providers import registry

    db = SessionDB(tmp_path / "sessions")
    db.create_session("chat", "main", source="test")
    monkeypatch.setattr("openprogram.agent.session_db.default_db", lambda: db)
    monkeypatch.setattr("openprogram.store.default_store", lambda: db)
    profile = {"model": "chat-provider/profile-model"}
    monkeypatch.setattr(dispatcher, "_load_agent_profile", lambda _id: profile)
    reads = []

    def session_choice(*args):
        reads.append(args)
        return (None, None) if selection == "profile" else ("chat-provider", "session-model")

    monkeypatch.setattr(session_model, "ensure_session_chat_model", session_choice)
    monkeypatch.setattr(session_model, "read_session_chat_model", session_choice)
    resolutions = []

    def resolve(prof, override):
        resolutions.append((prof, override))
        provider, model_id = (override or prof["model"]).split("/", 1)
        return SimpleNamespace(provider=provider, id=model_id)

    monkeypatch.setattr(dispatcher, "_resolve_model", resolve)
    calls = []
    runtime = SimpleNamespace()

    def create(**kwargs):
        calls.append(kwargs)
        return runtime

    monkeypatch.setattr(registry, "create_runtime", create)
    req = TurnRequest(
        session_id="chat", user_text="hi", agent_id="main", source="test",
        model_override="chat-provider/override-model" if selection == "override" else None,
        profile_snapshot=profile if selection == "snapshot" else None,
    )
    outer = SimpleNamespace()
    token = _current_runtime.set(outer)
    try:
        binding = TurnBindings.bind(
            req=req, assistant_msg_id="reply", db=db,
            snapshot_project_baseline=False,
        )
        try:
            expected = {"override": "override-model", "session": "session-model",
                        "snapshot": "session-model", "profile": "profile-model"}[selection]
            assert calls == [{"provider": "chat-provider", "model": expected}]
            assert _current_runtime.get() is runtime
            assert resolutions == [(profile, None if selection == "profile" else f"chat-provider/{expected}")]
            assert reads == ([] if selection == "override" else [("chat",)] if selection == "snapshot" else [("chat", "main")])
        finally:
            binding.release()
        assert _current_runtime.get() is outer
    finally:
        _current_runtime.reset(token)
