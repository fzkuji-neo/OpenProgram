"""Target chrome forwards to Playwright MCP's extension mode, tool for tool."""
from types import SimpleNamespace

from openprogram.programs.permission_rule import parse_command
from openprogram.programs.tools.system.computer_use_agent import tool
from openprogram.programs.tools.system.computer_use_agent.targets import chrome


def _tool(name, props=(), required=()):
    return SimpleNamespace(name=name, description=f"{name} does it.",
                           inputSchema={"properties": {p: {} for p in props}, "required": list(required)})


class FakeClient:
    def __init__(self):
        self.calls = []
        self._client = SimpleNamespace(tools=[
            _tool("browser_tabs", ["action", "index"], ["action"]),
            _tool("browser_navigate", ["url"], ["url"]),
            _tool("browser_click", ["element", "target"], ["target"]),
            _tool("browser_run_code_unsafe", ["code"], ["code"]),
        ])

    def is_alive(self):
        return True

    def call(self, name, arguments):
        self.calls.append((name, arguments))
        if arguments.get("target") == "bad":
            return SimpleNamespace(content=[SimpleNamespace(type="text", text="no such ref")], isError=True)
        return SimpleNamespace(content=[SimpleNamespace(type="text", text=f"ran {name}"),
                                        SimpleNamespace(type="image", data="aGk=")], isError=False)


def _install(monkeypatch):
    fake = FakeClient()
    monkeypatch.setattr(chrome, "_clients", {"s": fake})
    monkeypatch.setattr(chrome, "_tools", list(fake._client.tools))
    return fake


def test_actions_are_the_servers_tools_without_prefix_and_unsafe_code(monkeypatch):
    _install(monkeypatch)
    assert list(chrome.actions()) == ["tabs", "navigate", "click"]
    assert "- click(element?, target): browser_click does it." in chrome.guide()


def test_steps_pass_arguments_unchanged_and_stop_at_a_failure(monkeypatch):
    fake = _install(monkeypatch)
    result = chrome.run([("navigate", {"url": "https://example.com"}), ("click", {"target": "bad"}),
                         ("click", {"target": "e2"})], {}, "s")
    assert fake.calls == [("browser_navigate", {"url": "https://example.com"}),
                          ("browser_click", {"target": "bad"})]
    assert result.is_error and "Stopped: step 2 failed" in result.text
    assert result.images == [b"hi"]


def test_unknown_and_withheld_actions_are_refused(monkeypatch):
    fake = _install(monkeypatch)
    result = chrome.run([("run_code_unsafe", {"code": "1"})], {}, "s")
    assert result.is_error and fake.calls == []


def test_one_grant_covers_chrome_and_evaluate_is_approved_alone():
    assert parse_command("computer_use_agent", {"target": "chrome", "action": "click"}) == "chrome"
    assert tool.requires_approval(target="chrome") == "computer_use_agent controls your Chrome"
    assert tool.evaluates({"target": "chrome", "action": "evaluate", "args": {"function": "() => 1"}})
