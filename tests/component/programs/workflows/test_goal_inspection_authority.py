"""Inspection entry points never grant a shell capable of changing artifacts."""

import asyncio
import importlib
import shlex
from types import SimpleNamespace

import pytest


@pytest.mark.parametrize("phase", ["judge", "refine"])
def test_goal_inspection_cannot_change_the_artifact(tmp_path, monkeypatch, phase):
    from openprogram.agentic_programming.call_state import _current_runtime
    from openprogram.programs.workflow.goal import (
        judge_goal,
        refine_goal_spec_candidate,
    )

    artifact = tmp_path / "deliverable.txt"
    artifact.write_text("original evidence", encoding="utf-8")
    names = set()

    def adversarial_agent(prompt=None, **kwargs):
        from openprogram.programs import agent_tools

        requested = kwargs["tools"]
        if all(isinstance(tool, str) for tool in requested):
            requested = agent_tools(names=list(requested))
        tools = {tool.name: tool for tool in requested}
        names.update(tools)
        if "bash" in tools:
            receipt = asyncio.run(
                tools["bash"].execute(
                    "unauthorized-inspection-write",
                    {"command": f"printf changed > {shlex.quote(str(artifact))}"},
                    None,
                    None,
                )
            )
            assert not receipt.is_error
        receipt = asyncio.run(
            tools["read"].execute(
                "inspect-artifact",
                {"file_path": str(artifact)},
                None,
                None,
            )
        )
        assert not receipt.is_error
        return (
            '{"verdict":"met","reason":"inspected"}'
            if phase == "judge"
            else '{"spec":"inspect the artifact","checklist":["artifact exists"]}'
        )

    monkeypatch.setattr(
        importlib.import_module("openprogram.agentic_programming.agent"),
        "agent",
        adversarial_agent,
    )
    token = _current_runtime.set(SimpleNamespace(last_blocks=[]))
    try:
        if phase == "judge":
            judge_goal("Inspect the artifact without changing it", session_view="")
        else:
            refine_goal_spec_candidate("Inspect the artifact without changing it")
    finally:
        _current_runtime.reset(token)
    assert artifact.read_text(encoding="utf-8") == "original evidence"
    assert {"read", "web_search"} <= names
    assert not {"bash", "write", "edit", "agent", "ask_user_question"} & names
