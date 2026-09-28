from __future__ import annotations

from types import SimpleNamespace

from openprogram.webui.ws_actions.chat import _record_canonical_context_stats


def test_canonical_ws_turn_publishes_measured_context_and_saves(monkeypatch):
    from openprogram.webui import server as srv
    import openprogram.agent.session_db as session_db

    sid = "canonical-context-test"
    conv = {"provider_name": "anthropic", "model_override": "example-model",
            "head_id": "old-head"}
    sent = []
    saved = []
    srv._sessions[sid] = conv
    monkeypatch.setattr(session_db, "default_db", lambda: SimpleNamespace(
        get_session=lambda _sid: {"head_id": "reply-head"},
    ))
    monkeypatch.setattr(srv, "_hydrate_messages_from_db", lambda _sid: [])
    monkeypatch.setattr(srv, "_broadcast_context_stats",
                        lambda _sid, _mid, chat_runtime=None:
                        sent.append((_sid, _mid, chat_runtime)))
    monkeypatch.setattr(srv, "_save_session", saved.append)
    try:
        _record_canonical_context_stats(sid, "user-id", conv, SimpleNamespace(
            usage={"input_tokens": 250, "cache_read_tokens": 750,
                   "output_tokens": 50, "context_tokens": 1000},
        ))
        assert conv["head_id"] == "reply-head"
        assert sent[0][:2] == (sid, "user-id")
        assert sent[0][2].last_usage["context_tokens"] == 1000
        assert saved == [sid]
    finally:
        srv._sessions.pop(sid, None)
