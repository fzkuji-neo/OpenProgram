"""computer_use_agent routing and the browser and vm targets, without a host screen."""
import json

import pytest

from openprogram.programs._execution_common import ToolReturn
from openprogram.programs.tools.system.computer_use_agent import fresh, grounding
from openprogram.programs.tools.system.computer_use_agent import tool as entry
from openprogram.programs.tools.system.computer_use_agent.targets import browser, vm

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 16


@pytest.fixture(autouse=True)
def no_guides_seen():
    entry._shown.clear()
    yield
    entry._shown.clear()


# ----------------------------------------------------------------- routing

def test_steps_take_nested_or_flat_arguments():
    assert entry._steps("click", {"ref": "e1"}, None) == [("click", {"ref": "e1"})]
    steps = entry._steps("", {}, [{"action": "type", "args": {"ref": "e3", "text": "hi"}},
                                  {"action": "press", "key": "Enter"}])
    assert steps == [("type", {"ref": "e3", "text": "hi"}), ("press", {"key": "Enter"})]
    assert entry._steps("", {}, None) == []


def test_code_and_actions_are_one_or_the_other(monkeypatch):
    monkeypatch.setattr(browser, "run", lambda *a: ToolReturn(text="ran"))
    result = entry.computer_use_agent(target="browser", action="observe", code="pass")
    assert result.is_error and "not both" in result.text


def test_a_target_that_is_not_set_up_says_how(monkeypatch):
    monkeypatch.setattr(vm, "url", lambda: "")
    result = entry.computer_use_agent(target="vm")
    assert result.is_error and "computer_use.vm_url" in result.text


def test_json_results_keep_their_data_under_the_guide(monkeypatch):
    monkeypatch.setattr(browser, "open_target", lambda args, session: ToolReturn(json_data={"pages": []}))
    result = entry.computer_use_agent(target="browser")
    assert result.text.startswith('Guide: target "browser"') and result.text.endswith('{"pages": []}')
    assert result.json_data == {"pages": []}


def test_a_spawned_agent_sees_the_guide_in_its_brief_not_again_on_first_call(monkeypatch):
    seen = {}

    def spawn(target, args, brief, guide, session, **kwargs):
        seen.update(target=target, guide=guide, kwargs=kwargs)
        return ToolReturn(text="done")
    monkeypatch.setattr(fresh, "run", spawn)
    entry._shown.add(("default", 1, "browser"))  # an earlier spawned agent's record
    assert entry.computer_use_agent(target="app", context="fresh", brief="b", args={"app": "Notes"}).text == "done"
    assert seen["guide"] == entry.guide("app") and seen["kwargs"]["needs_grant"] is True
    assert entry._shown == {("default", 1, "app")}


def test_fresh_needs_a_brief_and_cannot_nest(monkeypatch):
    monkeypatch.setattr(fresh, "nested", lambda: False)
    result = fresh.run("app", {"app": "Notes"}, "  ", "guide", "s", needs_grant=True, describe=False)
    assert result.is_error and "needs brief" in result.text
    monkeypatch.setattr(fresh, "nested", lambda: True)
    result = fresh.run("app", {"app": "Notes"}, "do it", "guide", "s", needs_grant=True, describe=False)
    assert result.is_error and "inherit" in result.text


def test_fresh_prompt_names_the_target_and_carries_the_guide():
    text = fresh.prompt("app", {"app": "Numbers"}, "Sum column B.", "GUIDE", describe=True)
    assert text.startswith("Sum column B.") and 'target="app", args={"app": "Numbers"}' in text
    assert "GUIDE" in text and "describe=" in text


# ----------------------------------------------------------------- browser

def test_browser_actions_map_to_web_use_commands(monkeypatch):
    import openprogram.programs.workflow.browser as web

    calls = []
    monkeypatch.setattr(web, "run_web_use", lambda *a: calls.append(a) or {"ok": True})
    browser.run([("observe", {"page": "p1"})], {}, "s")
    browser.run([("click", {"ref": "e2"})], {"web_session_id": "w1"}, "s")
    browser.run([("verify", {"text": "Saved"})], {}, "s")
    assert calls[0] == ("observe", "", "p1", "", "", None)
    assert calls[1] == ("act", "", "", "", "w1", {"action": "click", "ref": "e2"})
    assert calls[2][0] == "verify" and calls[2][5] == {"action": "verify", "text": "Saved"}


def test_browser_steps_stop_at_the_first_failure(monkeypatch):
    import openprogram.programs.workflow.browser as web

    replies = iter([{"ok": True}, {"ok": False, "error": "gone"}, {"ok": True}])
    monkeypatch.setattr(web, "run_web_use", lambda *a: next(replies))
    result = browser.run([("click", {}), ("type", {}), ("press", {})], {}, "s")
    assert result.is_error and [item.get("step") for item in result.json_data] == [1, 2, None]


def test_browser_approval_asks_for_uploads_and_external_origins_only():
    assert browser.approval([("click", {"ref": "e1"})], {}) is False
    assert browser.approval([("navigate", {"url": "http://localhost:3000/"})], {}) is False
    assert "https://example.com" in browser.approval([("navigate", {"url": "https://example.com/a"})], {})
    assert "Upload" in browser.approval([("upload", {"path": "/tmp/x"})], {})


# ----------------------------------------------------------------- vm

def test_vm_steps_become_pyautogui_with_literal_values():
    assert "pyautogui.click(10, 20, button=\"right\", clicks=2" in vm._script(
        "click", {"x": 10.4, "y": 20, "mouse_button": "right", "click_count": 2})
    assert vm._script("type_text", {"text": "a\"); import os; ("}) == \
        'import pyautogui; pyautogui.write("a\\"); import os; (", interval=0.02)'
    assert vm._script("press_key", {"key": "Ctrl+Shift+T"}).endswith('hotkey(*["ctrl", "shift", "t"])')
    assert "pyautogui.scroll(-3)" in vm._script("scroll", {"direction": "down", "clicks": 3})
    with pytest.raises(vm.VMError):
        vm._script("click", {"x": "left"})


def test_vm_run_executes_then_returns_a_new_screenshot(monkeypatch):
    executed = []
    monkeypatch.setattr(vm, "url", lambda: "http://vm:5000")
    monkeypatch.setattr(vm, "screenshot", lambda base: PNG)
    monkeypatch.setattr(vm, "_execute", lambda base, script: executed.append(script))
    monkeypatch.setattr(vm.time, "sleep", lambda s: None)
    result = vm.run([("click", {"x": 1, "y": 2}), ("type_text", {"text": "x"})], {}, "s")
    assert not result.is_error and result.images == [PNG] and len(executed) == 2
    assert result.text.startswith("Done:\n1. click\n2. type_text")


def test_vm_describe_is_located_on_a_fresh_screenshot(monkeypatch):
    executed = []
    monkeypatch.setattr(vm, "url", lambda: "http://vm:5000")
    monkeypatch.setattr(vm, "screenshot", lambda base: PNG)
    monkeypatch.setattr(vm, "_execute", lambda base, script: executed.append(script))
    monkeypatch.setattr(vm.time, "sleep", lambda s: None)
    monkeypatch.setattr(grounding, "locate", lambda image, text, app_name: (300.0, 40.0))
    vm.run([("click", {"describe": "the OK button"})], {}, "s")
    assert "pyautogui.click(300, 40," in executed[0]

    def missing(image, text, app_name):
        raise grounding.GroundingError("'the OK button' was not found")
    monkeypatch.setattr(grounding, "locate", missing)
    result = vm.run([("click", {"describe": "the OK button"})], {}, "s")
    assert result.is_error and "not found" in result.text and len(executed) == 1


def test_vm_rule_names_the_endpoint(monkeypatch):
    from openprogram.programs.permission_rule import parse_command
    monkeypatch.setattr(vm, "url", lambda: "http://vm:5000")
    assert parse_command("computer_use_agent", {"target": "vm", "action": "click"}) == "vm:http://vm:5000"
    assert entry.requires_approval(target="vm", action="screenshot") == "computer_use_agent controls vm:http://vm:5000"


# ----------------------------------------------------------------- grounding

def test_describe_without_the_detector_explains_the_alternatives(monkeypatch):
    monkeypatch.setattr(grounding, "describe_available", lambda: False)
    with pytest.raises(grounding.GroundingError, match="element_index, ref or x,y"):
        grounding.locate(PNG, "the OK button", app_name="vm")


def test_resolve_replaces_both_ends_of_a_drag(monkeypatch):
    spots = {"the file": (1.0, 2.0), "the folder": (3.0, 4.0)}
    monkeypatch.setattr(grounding, "locate", lambda image, text, app_name: spots[text])
    step = grounding.resolve_screenshot(lambda: PNG, {"describe": "the file", "to_describe": "the folder"},
                                        app_name="vm")
    assert step == {"x": 1.0, "y": 2.0, "to_x": 3.0, "to_y": 4.0}
    assert grounding.resolve_screenshot(lambda: pytest.fail("no capture"), {"x": 5}, app_name="vm") == {"x": 5}


def test_settings_validate_the_vm_url():
    from openprogram.config_schema import SETTINGS
    spec = next(item for item in SETTINGS if item.key == "computer_use.vm_url")
    assert spec.validate("") is None and spec.validate("http://10.0.0.2:5000") is None
    assert spec.validate("10.0.0.2:5000") and json.dumps(spec.default) == '""'


def test_the_guides_ship_in_the_wheel():
    import fnmatch
    import tomllib
    from pathlib import Path

    root = Path(__file__).resolve().parents[4]
    patterns = tomllib.loads((root / "pyproject.toml").read_text())["tool"]["setuptools"]["package-data"]["openprogram"]
    guides = sorted((root / "openprogram/programs/tools/system/computer_use_agent/guides").glob("*.md"))
    assert guides
    for path in guides:
        rel = path.relative_to(root / "openprogram").as_posix()
        assert any(fnmatch.fnmatch(rel, pattern) for pattern in patterns), rel
