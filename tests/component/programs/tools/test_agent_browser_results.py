"""Registered CLI browser outcomes; no real subprocess or user browser."""

import asyncio
import inspect
import subprocess

import pytest

from openprogram.programs._runtime import current_tool_call_id, get
from openprogram.programs.tools.web import agent_browser


@pytest.fixture
def owned_cli(monkeypatch):
    monkeypatch.setattr(agent_browser, "_sessions", {})
    monkeypatch.setattr(agent_browser, "check_agent_browser", lambda: True)
    monkeypatch.setattr(agent_browser, "_detect_sidecar_cdp", lambda: None)
    monkeypatch.setattr(agent_browser, "_resolve_binary", lambda: "/owned/agent-browser")
    monkeypatch.delenv("OPENPROGRAM_BROWSER_CDP_URL", raising=False)
    calls = []

    def run(command, **kwargs):
        calls.append((command, kwargs))
        return subprocess.CompletedProcess(command, 0, stdout=b"Error: ordinary page content", stderr=b"")

    monkeypatch.setattr(agent_browser.subprocess, "run", run)
    yield calls
    agent_browser._sessions.clear()


async def _registered(arguments, call_id="cli-result"):
    tool = get("agent_browser")
    assert tool is not None
    try:
        return await tool.execute(call_id, arguments, asyncio.Event(), None)
    finally:
        assert current_tool_call_id() is None


def test_registered_cli_missing_dependency_is_error(owned_cli, monkeypatch):
    monkeypatch.setattr(agent_browser, "check_agent_browser", lambda: False)
    result = asyncio.run(_registered({"action": "open"}))
    assert "not installed" in result.content[0].text
    assert result.is_error is True
    assert not agent_browser._sessions and not owned_cli
    assert agent_browser.execute(action="open") == result.content[0].text


@pytest.mark.parametrize("failure", ["timeout", "missing", "nonzero"])
def test_registered_cli_process_failure_is_error(owned_cli, monkeypatch, failure):
    def failed(command, **kwargs):
        owned_cli.append((command, kwargs))
        if failure == "timeout":
            raise subprocess.TimeoutExpired(command, kwargs["timeout"])
        if failure == "missing":
            raise FileNotFoundError("owned missing binary")
        return subprocess.CompletedProcess(command, 9, stdout=b"", stderr=b"owned subprocess failure")

    monkeypatch.setattr(agent_browser.subprocess, "run", failed)
    agent_browser._sessions["owned"] = {"backend": ["--session", "owned"], "session_name": None}
    result = asyncio.run(_registered({"action": "snapshot", "session_id": "owned"}))
    assert result.is_error is True
    expected = {"timeout": "timed out", "missing": "not installed", "nonzero": "exited 9"}[failure]
    assert expected in result.content[0].text
    assert len(owned_cli) == 1
    assert owned_cli[0][0][-2:] == ["--json", "snapshot"]
    assert isinstance(agent_browser.execute(action="snapshot", session_id="owned"), str)
    closed = asyncio.run(_registered({"action": "close", "session_id": "owned"}, "cli-close"))
    assert not closed.is_error and not agent_browser._sessions


@pytest.mark.parametrize(
    "arguments, expected",
    [
        ({"action": "snapshot"}, "`session_id` is required"),
        ({"action": "snapshot", "session_id": "missing"}, "no agent_browser session"),
        ({"action": "click", "session_id": "owned"}, "`ref` is required"),
        ({"action": "press", "session_id": "owned"}, "`key` is required"),
    ],
)
def test_registered_cli_validation_is_error(owned_cli, arguments, expected):
    agent_browser._sessions["owned"] = {"backend": ["--session", "owned"], "session_name": None}
    result = asyncio.run(_registered(arguments))
    assert expected in result.content[0].text and result.is_error is True
    assert not owned_cli


def test_registered_successful_cli_error_prefix_is_data(owned_cli):
    agent_browser._sessions["owned"] = {"backend": ["--session", "owned"], "session_name": None}
    result = asyncio.run(_registered({"action": "snapshot", "session_id": "owned"}))
    assert result.is_error is False and result.content[0].text == "Error: ordinary page content"
    assert agent_browser.execute(action="snapshot", session_id="owned") == result.content[0].text
    assert len(owned_cli) == 2


def test_registered_cli_cancellation_propagates(owned_cli, monkeypatch):
    def cancelled(*args, **kwargs):
        raise asyncio.CancelledError()

    monkeypatch.setattr(agent_browser.subprocess, "run", cancelled)
    agent_browser._sessions["owned"] = {"backend": ["--session", "owned"], "session_name": None}
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(_registered({"action": "snapshot", "session_id": "owned"}))
    assert not owned_cli


def test_bare_execute_signature_preserved():
    signature = inspect.signature(agent_browser.execute)
    assert list(signature.parameters) == [
        "action", "session_id", "url", "ref", "text", "submit", "key", "amount", "cdp_url", "kw"
    ]
    assert signature.parameters["submit"].default is False
    assert signature.parameters["kw"].kind is inspect.Parameter.VAR_KEYWORD
    assert isinstance(agent_browser.execute(action="list"), str)
