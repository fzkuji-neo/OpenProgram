"""surface runtime tests."""
from __future__ import annotations
from ._support import (
    REPO_ROOT,
)


def test_built_in_pages_are_a_target_of_the_one_screen_tool():
    from openprogram.programs import (
        DEFERRED_DEFAULT_TOOLS,
        DEFAULT_TOOLS,
        agent_tools,
        apply_tool_policy,
    )

    # web_use stays registered for workflows and MCP, but the model sees one screen tool.
    assert "web_use" not in DEFAULT_TOOLS
    assert "computer_use_agent" in DEFAULT_TOOLS
    assert "computer_use_agent" not in DEFERRED_DEFAULT_TOOLS
    tool = next(item for item in agent_tools(names=["computer_use_agent"]) if item.name == "computer_use_agent")
    assert "browser" in tool.parameters["properties"]["target"]["enum"]
    assert apply_tool_policy([tool], source="plan") == []



def test_surface_tool_is_injected_after_tools_are_resolved():
    source = (REPO_ROOT / "openprogram/agent/turn_runtime/loop_runner.py").read_text(
        encoding="utf-8"
    )

    resolve_at = source.index(
        "tools = _resolve_tools(agent_profile, req.tools_override, source=req.source)"
    )
    inject_at = source.index(
        "tools, web_use_enabled = _configure_web_use_tools"
    )
    assert resolve_at < inject_at

