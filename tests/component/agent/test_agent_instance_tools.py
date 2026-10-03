"""Agent tool adaptation keeps instance configuration and executors separate."""
import asyncio
import inspect
import importlib
import itertools

import pytest

from openprogram import Agent
from openprogram.agentic_programming.runtime.shared import _adapt_tools


@pytest.mark.parametrize("asynchronous", [False, True])
def test_adapted_method_keeps_its_instance_after_second_registration(asynchronous):
    class ToolAgent(Agent):
        method_options = {"identify": {"tool": True, "register_globally": False}}

        if asynchronous:
            async def identify(self, suffix: str):
                await asyncio.sleep(0)
                return self.identity + suffix
        else:
            def identify(self, suffix: str):
                return self.identity + suffix

    first = ToolAgent()
    first.identity = "first:"
    adapted_before = _adapt_tools([first.identify])[0]
    second = ToolAgent()
    second.identity = "second:"
    adapted_second = _adapt_tools([second.identify])[0]
    adapted_after = _adapt_tools([first.identify])[0]

    async def dispatch():
        results = []
        for tool in (adapted_before, adapted_second, adapted_after):
            result = await tool.execute("call", {"suffix": "value"}, None, None)
            results.append(result.content[0].text)
        return results

    assert asyncio.run(dispatch()) == ["first:value", "second:value", "first:value"]
    assert first.identify._agent_tool is not second.identify._agent_tool
    assert list(inspect.signature(first.identify).parameters) == ["suffix"]
    assert list(first.identify.spec["parameters"]["properties"]) == ["suffix"]


def test_unconfigured_child_keeps_parent_model_instructions_and_denial():
    from openprogram import Runtime
    from openprogram.agentic_programming import agent
    from openprogram.agentic_programming.runtime.shared import (
        _current_instructions, _current_tool_policy,
    )

    requests = []

    def provider(content, model=None, **kwargs):
        requests.append((model, _current_instructions.get(),
                         (_current_tool_policy.get() or {}).get("deny")))
        return "completed"

    class Child(Agent):
        def run(self):
            return agent("request", tools_deny=[])

    class Parent(Agent):
        def run(self):
            return Child().run()

    runtime = Runtime(call=provider)
    try:
        parent = Parent(runtime=runtime, model="parent-model", tools=[],
                        instructions="parent instructions", tools_deny=["bash"])
        assert parent.run() == "completed"
        assert requests == [("parent-model", "parent instructions", ["bash"])]
        assert _current_instructions.get() is None
        assert _current_tool_policy.get() is None
    finally:
        runtime.close()



@pytest.mark.parametrize("names", list(itertools.permutations(("Agent", "Runtime", "agent"))))
def test_public_agent_entry_and_internal_package_support_import_order(names, monkeypatch):
    import openprogram

    # Exercise lazy public entry lookup after any prior internal package import.
    monkeypatch.delattr(openprogram, "agent", raising=False)
    namespace = {}
    for name in names:
        exec(f"from openprogram import {name}", namespace)
    package = importlib.import_module("openprogram.agent")
    assert namespace["agent"] is package
    assert hasattr(package, "__path__")
    assert package.AgentTool is importlib.import_module("openprogram.agent.types").AgentTool
    runtime = namespace["Runtime"](call=lambda content, **kwargs: "completed")
    try:
        assert namespace["agent"]("request", runtime=runtime, tools=[]) == "completed"
    finally:
        runtime.close()



def test_unavailable_tool_method_still_records_direct_python_call():
    from openprogram.agentic_programming.function import current_call_id

    class ToolAgent(Agent):
        method_options = {"run": {"tool": True, "available_if": lambda: False}}

        def run(self):
            return current_call_id()

    instance = ToolAgent()
    assert instance.run()
    assert "run" not in instance._method_tools
    assert current_call_id() == ""
