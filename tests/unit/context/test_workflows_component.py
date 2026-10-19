"""The system prompt tells a tool-using agent how to write a workflow."""
from types import SimpleNamespace

from openprogram.context import components


def _with_tools(names):
    token = components._tools_var.set([SimpleNamespace(name=name) for name in names])
    try:
        return components._build_workflows(None)
    finally:
        components._tools_var.reset(token)


def test_absent_without_tools():
    assert components._build_workflows(None) == ""
    assert _with_tools([]) == ""


def test_names_the_package_root_the_guide_and_the_order_of_work():
    block = _with_tools(["read", "write", "bash", "list_agents", "read_conversation"])
    assert block.startswith("<workflows>") and block.endswith("</workflows>")
    assert "workflows/<name>/" in block
    assert "authoring" in block
    assert "`list_agents`, `read_conversation`" in block
    assert "recorded demonstration" in block
    assert "openprogram workflows check" in block
    assert "`list_agents`" not in _with_tools(["read", "write"])
