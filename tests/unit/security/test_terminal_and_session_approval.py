"""Typing into the user's own terminal asks every time; polling a command session never asks."""
from __future__ import annotations

from types import SimpleNamespace

import pytest


@pytest.fixture
def decide(monkeypatch):
    from openprogram.agent import authority
    from openprogram.agent.permissions import policy, recovery
    from openprogram.programs._runtime import get

    monkeypatch.setattr(policy, "_hard_constraint_violation", lambda *a, **k: None)
    monkeypatch.setattr(authority, "decide_tool_authority",
                        lambda *a, **k: SimpleNamespace(allowed=True, reason_code="", capability=""))
    monkeypatch.setattr(recovery, "approval_context", lambda *a, **k: None)

    def run(tool, args, *, mode="bypass", allow=()):
        rules = SimpleNamespace(allow=list(allow), ask=[], deny=[])
        req = SimpleNamespace(permission_mode=mode, permission_rules=rules, session_id="s-test",
                              source="web", surface_context=None)
        return policy.permission_decision(get(tool), req, args)[:2]
    return run


@pytest.mark.parametrize("mode", ["bypass", "auto", "default"])
@pytest.mark.parametrize("action", ["input", "interrupt", "close"])
def test_writing_to_a_users_terminal_asks_in_every_mode(decide, mode, action):
    args = {"action": action, "terminal_id": "terminal:desktop:shell", "data": "ls\r"}
    assert decide("terminal_use", args, mode=mode, allow=["terminal_use"]) == ("ask", "MANDATORY_APPROVAL")


def test_the_agents_own_terminal_and_reading_follow_the_mode(decide):
    own = {"action": "input", "terminal_id": "terminal-resource:" + "0" * 32, "data": "ls\r"}
    assert decide("terminal_use", own) == ("allow", "BYPASS")
    assert decide("terminal_use", {"action": "observe", "terminal_id": "terminal:desktop:shell"}) == ("allow", "BYPASS")


def test_a_users_terminal_approval_is_never_remembered():
    from openprogram.agent.permissions.policy import one_shot_approval

    assert one_shot_approval("terminal_use", {"action": "input", "terminal_id": "terminal:desktop:shell"})
    assert not one_shot_approval("terminal_use", {"action": "input", "terminal_id": "terminal-resource:" + "0" * 32})


@pytest.mark.parametrize("chars", ["", "\x03"])
def test_polling_or_interrupting_a_command_session_does_not_ask(decide, chars):
    assert decide("write_stdin", {"session_id": "abc", "chars": chars}, mode="default") == ("allow", "SESSION_POLL")


def test_typing_into_a_command_session_follows_the_mode(decide):
    assert decide("write_stdin", {"session_id": "abc", "chars": "y\n"}, mode="default") == ("ask", "MODE_APPROVAL")
    assert decide("write_stdin", {"session_id": "abc", "chars": "y\n"}, mode="auto") == ("auto", "AUTO_CLASSIFY")
