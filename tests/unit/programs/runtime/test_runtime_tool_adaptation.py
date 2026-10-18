from openprogram.agent.types import AgentTool, AgentToolResult
from openprogram.agentic_programming.runtime import _adapt_tools
from openprogram.providers.types import TextContent


async def _execute(tool_call_id, args, signal, update_cb):
    return AgentToolResult(content=[TextContent(text="ok")])


def test_runtime_accepts_native_agent_tool_without_readapting_it():
    tool = AgentTool(
        name="native_tool",
        description="native",
        parameters={"type": "object", "properties": {}},
        label="native_tool",
        execute=_execute,
    )

    assert _adapt_tools([tool]) == [tool]


def test_runtime_resolves_registered_tool_names():
    import pytest
    import openprogram.programs  # registers the built-in tools
    from openprogram.programs import _runtime as registry

    assert _adapt_tools(["read", "grep"]) == [registry.get("read"), registry.get("grep")]
    with pytest.raises(ValueError, match="Unknown tool 'no_such_tool'"):
        _adapt_tools(["no_such_tool"])
