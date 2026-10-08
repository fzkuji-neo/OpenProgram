"""Steer/stop retain the current turn through the public chat/control entries."""
import asyncio
import threading

import pytest

from tests.component.agent.execution.test_agent_continuation_real import (
    real_agent_chat, _chat, _command, _wait, _WebSocket,
)
from tests.component.providers.scripted_provider import ScriptedProvider, ScriptedText, ScriptedThinking, ScriptedToolCall


def _steer(h, execution, command_id, message):
    from openprogram.webui.ws_actions import runtime
    ws = _WebSocket()
    asyncio.run(runtime.ACTIONS["execution.steer"](ws, {
        "type": "execution.command", "action": "execution.steer",
        "command_id": command_id, "execution_id": execution.execution_id,
        "expected_version": execution.status_version, "payload": {"message": message},
    }))
    assert h.store.get_command(command_id).status.value in {"accepted", "applying", "applied"}


@pytest.mark.parametrize("phase", ["text", "thinking", "start"])
def test_steer_interrupts_silent_text_stream_and_continues_once(real_agent_chat, monkeypatch, phase):
    h = real_agent_chat
    provider = ScriptedProvider()
    provider.add_response(ScriptedThinking("partial thought") if phase == "thinking" else ScriptedText("partial answer"))
    provider.add_response(ScriptedText("answer with correction"))
    entered, closed = threading.Event(), threading.Event()
    contexts = []

    async def streaming(model, context, options=None):
        index = len(contexts)
        contexts.append(context.model_copy(deep=True))
        try:
            async for event in provider.stream_simple(model, context, options):
                yield event
                if index == 0 and event.type == {"text": "text_delta", "thinking": "thinking_delta", "start": "start"}[phase]:
                    entered.set()
                    while not h.provider.release.is_set():
                        await asyncio.sleep(0)
        finally:
            if index == 0:
                closed.set()

    monkeypatch.setattr(h.provider, "stream_simple", streaming)
    execution = _chat(h)
    try:
        _wait(entered.is_set)
        _steer(h, h.store.get_execution(execution.execution_id), "steer-text", "use the correction")
        _wait(lambda: len(contexts) == 2, timeout=3)
        assert closed.is_set()
        assert not h.provider.release.is_set()
        _wait(lambda: h.store.get_execution(execution.execution_id).status.value == "completed")
        assert h.store.get_command("steer-text").status.value == "applied"
        serialized = str([message.model_dump() for message in contexts[1].messages])
        if phase != "start":
            assert ("partial thought" if phase == "thinking" else "partial answer") in serialized
        assert serialized.count("use the correction") == 1
        if phase == "thinking":
            from openprogram.providers._shared.transform_messages import transform_messages
            from openprogram.providers.types import ThinkingContent
            projected = transform_messages(contexts[1].messages, h.model)
            assert not any(isinstance(block, ThinkingContent)
                           for msg in projected if msg.role == "assistant" for block in msg.content)
            assert "partial thought" in serialized  # Original display/checkpoint remains intact.
        from openprogram.store.session.session_store import SessionStore
        cold = SessionStore(h.sessions.root_path)
        branch = cold.get_branch(h.session_id)
        assert sum("use the correction" in str(m.get("content")) for m in branch) == 1
        if phase == "text":
            assert "partial answer" in str(branch)
        assert "answer with correction" in str(branch)
    finally:
        h.provider.release.set()


def test_stop_with_pending_steer_keeps_reply_in_cold_history(real_agent_chat):
    h = real_agent_chat
    h.provider.add_response(ScriptedText("already generated"), ScriptedToolCall("first", {}, "first-call"))
    h.tools.blocked.add("first")
    execution = _chat(h)
    try:
        _wait(lambda: "first" in h.tools.calls)
        source = h.store.get_execution_input(execution.execution_id)
        _steer(h, h.store.get_execution(execution.execution_id), "pending-steer", "not yet applied")
        # Interrupted owners can leave HEAD on the admitted user node, as in
        # the reported session. Terminal projection must finish this exact turn.
        h.sessions.set_head(h.session_id, source.user_message_id)
        _command(h, "execution.cancel", h.store.get_execution(execution.execution_id), "stop-pending")
        _wait(lambda: h.store.get_execution(execution.execution_id).status.value == "cancelled")
        _wait(lambda: h.sessions.get_session(h.session_id)["status"] == "idle")
        from openprogram.store.session.session_store import SessionStore
        cold = SessionStore(h.sessions.root_path)
        branch = cold.get_branch(h.session_id)
        assert branch[-1]["id"] == source.assistant_message_id
        assert "already generated" in str(branch)
        assert h.store.get_command("pending-steer").rejection_code == "superseded_by_cancel"
        # A subsequent explicit send must link to the retained reply.
        conv = {"id": h.session_id, "head_id": source.user_message_id, "messages": []}
        h.server._append_msg(conv, {"id": "next-user", "role": "user", "content": "continue"})
        branch = SessionStore(h.sessions.root_path).get_branch(h.session_id)
        assert [m["id"] for m in branch][-2:] == [source.assistant_message_id, "next-user"]
        from openprogram.execution.projections import ExecutionProjectionReadModel
        ExecutionProjectionReadModel(h.store).project_cancelled_assistant(
            h.store.get_execution(execution.execution_id),
        )
        assert SessionStore(h.sessions.root_path).get_session(h.session_id)["head_id"] == "next-user"
    finally:
        h.provider.release.set()
        h.tools.release["first"].set()
