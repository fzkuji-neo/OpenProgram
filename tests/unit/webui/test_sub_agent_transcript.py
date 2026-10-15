"""A sub-agent's turns stay out of the conversation's transcript.

Job turns run in their parent session, so the production driver stamps
each of their chat frames with ``job_id`` and the web client keeps them
with the turn's Sub-agents card. The card reads the agent's whole branch
(its first task and every later message to it) through
``load_sub_agent_transcript`` without moving the session head.
"""
from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

import pytest

from openprogram.agent.production_driver.execution import ExecutionOperations


def _sink(event_sink, *, job: bool):
    owner = SimpleNamespace(event_sink=event_sink)
    attempt = SimpleNamespace(execution_id="j_abc")
    request = SimpleNamespace(_job_context=object() if job else None)
    return ExecutionOperations._turn_event_sink(owner, attempt, request)


def test_job_turn_frames_carry_the_job_id():
    frames = []
    emit = _sink(frames.append, job=True)
    emit({"type": "chat_response", "data": {"type": "stream_event", "session_id": "s1"}})
    emit({"type": "job_status", "data": {"job_id": "j_abc"}})
    emit({"type": "chat_response", "data": None})
    assert frames[0]["data"] == {"type": "stream_event", "session_id": "s1", "job_id": "j_abc"}
    assert frames[1] == {"type": "job_status", "data": {"job_id": "j_abc"}}
    assert frames[2] == {"type": "chat_response", "data": None}


def test_conversation_turn_frames_are_left_alone():
    def sink(frame):
        pass

    assert _sink(sink, job=False) is sink
    assert _sink(None, job=True) is None


@pytest.fixture
def store(tmp_path, monkeypatch):
    """A conversation whose turn spawned one agent, then sent it a follow-up."""
    from openprogram.agent import session_db as sdb_mod
    from openprogram.store.session.session_store import SessionStore

    s = SessionStore(tmp_path / "sessions-git")
    monkeypatch.setattr(sdb_mod, "default_store", lambda: s)
    monkeypatch.setattr("openprogram.store.session.session_store.default_store", lambda: s)
    monkeypatch.setattr("openprogram.store.default_store", lambda: s)
    s.create_session("p1", "main", title="parent")

    def add(mid, role, content, parent, ts):
        s.append_message("p1", {
            "id": mid, "role": role, "content": content,
            "timestamp": ts, "predecessor": parent,
        })

    add("u1", "user", "spawn one", None, 1)
    add("a1", "assistant", "spawned", "u1", 2)
    s.spawn_branch(
        "p1", "a1", source="agent", node_id="j_a_user", created_at=3,
        prompt="[task from p1:a1] This is a tracked job.\n\nfind it",
        register_head=False,
    )
    add("j_a_user_reply", "assistant", "found it", "j_a_user", 4)
    add("j_b_user", "user", "[message from p1:a1] To reply...\n\nand more?", "j_a_user_reply", 5)
    add("j_b_user_reply", "assistant", "here is more", "j_b_user", 6)
    s.commit_turn("p1", "init")
    return s


def test_branch_tip_follows_later_messages_to_the_agent(store):
    from openprogram_server._webui.ws_actions.sub_agent import _branch_tip

    messages = store.get_messages("p1")
    assert _branch_tip(messages, "j_a_user_reply") == "j_b_user_reply"
    assert _branch_tip(messages, "a1") == "a1"


def test_transcript_reads_the_agent_branch_in_turn_order(store):
    from openprogram_server._webui.ws_actions.sub_agent import _transcript

    tip, messages = _transcript("p1", "", "j_a_user_reply")
    assert tip == "j_b_user_reply"
    assert [m["id"] for m in messages] == [
        "j_a_user", "j_a_user_reply", "j_b_user", "j_b_user_reply",
    ]
    assert _transcript("p1", "", "missing") == ("missing", [])


def test_transcript_action_replies_without_moving_the_head(store):
    from openprogram_server._webui.ws_actions.sub_agent import ACTIONS

    sent = []

    class _Ws:
        async def send_text(self, text):
            sent.append(json.loads(text))

    head_before = store.get_session("p1").get("head_id")
    asyncio.run(ACTIONS["load_sub_agent_transcript"](_Ws(), {
        "session_id": "p1", "head_id": "j_a_user_reply", "request_id": "r1",
    }))
    asyncio.run(ACTIONS["load_sub_agent_transcript"](_Ws(), {"session_id": "p1"}))
    assert sent[0]["type"] == "sub_agent_transcript"
    assert sent[0]["data"]["request_id"] == "r1"
    assert sent[0]["data"]["head_id"] == "j_b_user_reply"
    assert len(sent[0]["data"]["messages"]) == 4
    assert "error" in sent[1]["data"]
    assert store.get_session("p1").get("head_id") == head_before
