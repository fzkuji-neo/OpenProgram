"""A plugin's setup(ctx) registers through the host registries and undoes
everything when it is disabled or reloaded."""
from __future__ import annotations

import json
import textwrap
from pathlib import Path

import pytest

from openprogram.events import get_event_bus, make_event
from openprogram.plugins import installer, loader, services, trust


@pytest.fixture
def plugin_home(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    (tmp_path / "home").mkdir()
    from openprogram.programs import _runtime
    saved = _runtime.snapshot_registry()
    with loader._lock:
        loader._plugins.clear()
        loader._errors.clear()
    yield tmp_path
    for p in list(loader._plugins.values()):
        if p.loaded:
            loader._deactivate(p)
    loader._plugins.clear()
    _runtime.restore_registry(saved)


def write_plugin(root: Path, name: str, setup_body: str, **manifest) -> Path:
    root.mkdir(parents=True, exist_ok=True)
    (root / "plugin.json").write_text(json.dumps(
        {"name": name, "python": "./plugin.py", **manifest}), encoding="utf-8")
    (root / "plugin.py").write_text(textwrap.dedent(setup_body), encoding="utf-8")
    return root


def install(root: Path, name: str):
    result = installer.install("path", str(root))
    assert result["success"], result
    trust.set_trust(name, "community")
    loader.rescan()
    return loader.load_plugin(name)


SETUP = '''
    def setup(ctx):
        @ctx.tool
        def shout(text: str) -> str:
            """Return the text in capitals."""
            return text.upper() + "{suffix}"

        ctx.context("rules", lambda agent: "Plugin rule {suffix}")
        ctx.transform("tool.result", lambda event, text: text + " [seen]")
        ctx.provide("shouter", object())
        ctx.command("greet", "Say hello", "Greets")
'''


def test_setup_registers_and_disable_undoes_everything(plugin_home):
    from openprogram.context import components
    from openprogram.programs._runtime import get
    root = write_plugin(plugin_home / "src" / "demo", "demo", SETUP.format(suffix="!"))
    p = install(root, "demo")

    assert p.loaded and get("shout") is not None
    assert any(c.name == "plugin:demo:rules" for c in components._REGISTRY["L1"])
    assert "shouter" in services.names()
    assert p.contrib["_commands"][0]["name"] == "greet"
    event = make_event("tool.result", "tool", {"tool": "x"})
    assert get_event_bus().emit_transform(event, "ok") == "ok [seen]"
    assert sorted(p.ctx.contributions) == ["commands", "context", "services", "tools", "transforms"]

    loader.unload_plugin("demo")
    assert get("shout") is None
    assert not any(c.name == "plugin:demo:rules" for c in components._REGISTRY["L1"])
    assert "shouter" not in services.names()
    assert get_event_bus().emit_transform(event, "ok") == "ok"
    assert not any(name.startswith("openprogram_plugin_demo.") for name in __import__("sys").modules)


def test_reload_runs_the_code_now_on_disk(plugin_home):
    from openprogram.programs._runtime import get
    root = write_plugin(plugin_home / "src" / "demo", "demo", SETUP.format(suffix="!"))
    install(root, "demo")
    first = get("shout")
    (root / "plugin.py").write_text(textwrap.dedent(SETUP.format(suffix="?")), encoding="utf-8")
    loader.reload_plugin("demo")
    assert get("shout") is not first
    assert get("shout")._python_callable(text="a") == "A?"


def test_a_failing_setup_leaves_nothing_behind(plugin_home):
    from openprogram.programs._runtime import get
    root = write_plugin(plugin_home / "src" / "broken", "broken", '''
        def setup(ctx):
            @ctx.tool
            def half_done(text: str) -> str:
                """Registered before the failure."""
                return text
            raise RuntimeError("boom")
    ''')
    with pytest.raises(RuntimeError, match="boom"):
        install(root, "broken")
    assert get("half_done") is None
    assert "boom" in loader.get_plugin("broken").error


def test_rescan_keeps_a_running_plugin_running(plugin_home):
    root = write_plugin(plugin_home / "src" / "demo", "demo", SETUP.format(suffix="!"))
    install(root, "demo")
    loader.rescan()
    p = loader.get_plugin("demo")
    assert p.loaded and p.ctx is not None
    loader.unload_plugin("demo")
    from openprogram.programs._runtime import get
    assert get("shout") is None


def test_enabled_plugins_load_at_startup_dependencies_first(plugin_home):
    order_file = plugin_home / "order.txt"
    for name, requires in (("base", []), ("addon", ["base"])):
        write_plugin(plugin_home / "src" / name, name, f'''
            def setup(ctx):
                with open({str(order_file)!r}, "a") as f:
                    f.write("{name}\\n")
        ''', requires=requires)
        installer.install("path", str(plugin_home / "src" / name))
        trust.set_trust(name, "community")
    (Path(plugin_home / "home" / ".openprogram" / "plugins-enabled.json")
     .write_text(json.dumps(["addon", "base"]), encoding="utf-8"))
    assert loader.load_enabled() == {}
    assert order_file.read_text().split() == ["base", "addon"]


def test_path_install_links_and_uninstall_removes_only_the_link(plugin_home):
    root = write_plugin(plugin_home / "src" / "demo", "demo", "def setup(ctx):\n    pass\n")
    install(root, "demo")
    link = plugin_home / "home" / ".openprogram" / "plugins" / "demo"
    assert link.is_symlink() and loader.get_plugin("demo").manifest.source_kind == "link"
    loader.unload_plugin("demo")
    assert installer.uninstall("demo")["success"]
    assert not link.exists() and (root / "plugin.py").is_file()


def test_provider_directories_come_and_go_with_the_plugin(plugin_home):
    from openprogram.providers import metadata
    root = write_plugin(plugin_home / "src" / "prov", "prov", "def setup(ctx):\n    pass\n",
                        providers="./providers")
    (root / "providers" / "acme").mkdir(parents=True)
    (root / "providers" / "acme" / "provider.json").write_text(json.dumps({
        "id": "acme", "endpoints": {"default": {"api": "openai-completions",
                                                "base_url": "https://acme.test/v1"}}}))
    install(root, "prov")
    assert "acme" in metadata.shipped_provider_ids()
    assert metadata.provider_base_url("acme") == "https://acme.test/v1"
    loader.unload_plugin("prov")
    assert "acme" not in metadata.shipped_provider_ids()


def test_claude_style_mcp_entries_become_our_config():
    from openprogram.plugins.context import normalize_mcp_entry
    assert normalize_mcp_entry({"command": "npx", "args": ["-y", "srv"]}) == {
        "command": ["npx", "-y", "srv"], "type": "local"}
    assert normalize_mcp_entry({"url": "https://x.test/mcp"})["type"] == "http"


def test_events_are_checked_against_their_kind(plugin_home):
    from openprogram.plugins.context import PluginContext
    ctx = PluginContext("p", plugin_home)
    with pytest.raises(ValueError, match="use ctx.gate"):
        ctx.on("tool.before", lambda e: None)
    with pytest.raises(ValueError, match="unknown event"):
        ctx.on("no.such.event", lambda e: None)
    ctx.dispose()


def test_tool_result_rewriters_change_only_the_text():
    from types import SimpleNamespace
    from openprogram.agent.agent_loop import _rewrite_tool_result
    from openprogram.agent.types import AgentToolResult
    from openprogram.providers.types import TextContent
    call = SimpleNamespace(name="read", id="c1", arguments={})
    result = AgentToolResult(content=[TextContent(text="secret: 42")])
    assert _rewrite_tool_result(call, result) is result
    dispose = get_event_bus().subscribe_transform(
        "tool.result", lambda event, text: text.replace("42", "**"))
    try:
        assert _rewrite_tool_result(call, result).content[0].text == "secret: **"
    finally:
        dispose()


def test_web_slots_match_the_page():
    import re
    from openprogram.plugins.inspect import CLIENT_SLOTS
    source = (Path(__file__).resolve().parents[3] / "apps" / "web" / "lib" / "plugins"
              / "slots.ts").read_text(encoding="utf-8")
    block = re.search(r"PLUGIN_SLOTS = \[(.*?)\] as const", source, re.S).group(1)
    assert re.findall(r'"([^"]+)"', block) == list(CLIENT_SLOTS)
