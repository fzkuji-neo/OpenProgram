"""web_use parity actions: argument parsing, MCP mapping, and the page scripts in a real Chromium."""
from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from openprogram.programs.workflow.browser._runtime import page_actions as pa
from openprogram.programs.workflow.browser.mcp_backends import OfficialMCPPageBackend
from openprogram.web_use_contract import normalize_web_use_arguments, web_use_parameters


# ----------------------------------------------------------------- arguments

def test_modifiers_accept_mac_and_pc_names_once_each():
    assert pa.modifiers("cmd+shift") == ["Meta", "Shift"]
    assert pa.modifiers("Ctrl, alt, ctrl") == ["Control", "Alt"]
    with pytest.raises(pa.ActionError) as error:
        pa.modifiers("hyper")
    assert error.value.reason_code == "invalid_modifiers"


def test_scroll_amount_keeps_its_old_meaning_without_a_direction():
    assert pa.scroll_delta({}) == (0, 500)
    assert pa.scroll_delta({"amount": -300}) == (0, -300)
    assert pa.scroll_delta({"amount": -300, "direction": "left"}) == (-300, 0)
    assert pa.scroll_delta({"amount": 200, "direction": "up"}) == (0, -200)


@pytest.mark.parametrize("arguments, code", [
    ({"mouse_button": "back"}, "invalid_mouse_button"),
    ({"click_count": 4}, "invalid_click_count"),
    ({"click_count": "two"}, "invalid_click_count"),
])
def test_click_options_are_checked(arguments, code):
    with pytest.raises(pa.ActionError) as error:
        pa.click_options(arguments)
    assert error.value.reason_code == code


def test_paste_offers_markdown_as_html_and_html_with_a_plain_fallback():
    assert pa.paste_payload({"text": "**hi**", "format": "md"})["html"].strip() == "<p><strong>hi</strong></p>"
    assert pa.paste_payload({"text": "<b>a</b> &amp; b", "format": "html"})["text"] == "a & b"
    assert pa.paste_payload({"text": "plain"}) == {"text": "plain", "html": ""}


def test_new_actions_and_fields_are_in_the_schema_and_lifted_from_the_top_level():
    act = web_use_parameters()["allOf"][0]["then"]["properties"]["arguments"]["properties"]
    for action in pa.PARITY_ACTIONS:
        assert action in act["action"]["enum"]
    assert {"mouse_button", "click_count", "modifiers", "to_ref", "direction", "format", "selection_type",
            "duration"} <= set(act)
    lifted = normalize_web_use_arguments({"command": "act", "action": "drag", "ref": "e1", "to_ref": "e2"})
    assert lifted["arguments"] == {"action": "drag", "ref": "e1", "to_ref": "e2"}


# ----------------------------------------------------------------- MCP mapping

def _adapter(name):
    adapter = OfficialMCPPageBackend.__new__(OfficialMCPPageBackend)
    adapter.name = name
    return adapter, SimpleNamespace(state={"upstream_page": 3})


def test_playwright_maps_clicks_drags_and_history_to_native_tools():
    adapter, session = _adapter("playwright_mcp")
    assert adapter._action_call(session, {"action": "click", "ref": "e4", "mouse_button": "right",
                                          "modifiers": "shift"}) == (
        "browser_click", {"target": "e4", "button": "right", "modifiers": ["Shift"]})
    assert adapter._action_call(session, {"action": "click", "ref": "e4"}) == ("browser_click", {"target": "e4"})
    assert adapter._action_call(session, {"action": "drag", "ref": "e1", "to_ref": "e2"}) == (
        "browser_drag", {"startTarget": "e1", "endTarget": "e2"})
    assert adapter._action_call(session, {"action": "back"}) == ("browser_navigate_back", {})
    assert adapter._action_call(session, {"action": "scroll", "amount": 120, "direction": "right"}) == (
        "browser_mouse_wheel", {"deltaX": 120, "deltaY": 0})


def test_devtools_dispatches_a_right_click_in_the_page_and_navigates_history_natively():
    adapter, session = _adapter("chrome_devtools_mcp")
    name, params = adapter._action_call(session, {"action": "click", "ref": "e4", "mouse_button": "right"})
    assert name == "evaluate_script" and params["args"] == ["e4"] and '"button": "right"' in params["function"]
    assert adapter._action_call(session, {"action": "reload"}) == ("navigate_page", {"type": "reload", "pageId": 3})


@pytest.mark.parametrize("name, arguments", [
    ("playwright_mcp", {"action": "click", "ref": "e1", "click_count": 3}),
    ("playwright_mcp", {"action": "click", "x": 1, "y": 2, "modifiers": "cmd"}),
    ("chrome_devtools_mcp", {"action": "drag", "x": 1, "y": 2, "to_x": 3, "to_y": 4}),
    ("chrome_devtools_mcp", {"action": "press", "key": "a", "duration": 1}),
])
def test_options_a_backend_cannot_honour_fail_before_anything_is_sent(name, arguments):
    adapter, session = _adapter(name)
    with pytest.raises(pa.ActionError) as error:
        adapter._action_call(session, arguments)
    assert error.value.reason_code == "unsupported_option"


def test_inlined_scripts_throw_when_the_page_reports_failure():
    source = pa.bound_call(pa.SELECT_TEXT_SCRIPT, {"text": "x", "prefix": "", "suffix": "", "kind": "text"},
                           require="ok")
    assert source.startswith("(element) => { const r = ") and "throw new Error" in source
    assert json.dumps({"text": "x", "prefix": "", "suffix": "", "kind": "text"}, ensure_ascii=False) in source


# ----------------------------------------------------------------- scripts in Chromium

_PAGE = """
<input id=field value="hello world">
<div id=box style="height:60px;overflow:auto"><div id=inner style="height:600px">inside</div></div>
<p id=para>alpha <b>beta</b> gamma</p>
<div id=rich contenteditable>start</div>
<button id=btn>go</button>
<script>
  window.events = [];
  for (const type of ["click", "dblclick", "contextmenu", "auxclick", "mousedown"])
    btn.addEventListener(type, e => events.push([type, e.detail, e.button, e.shiftKey]));
</script>
"""


@pytest.fixture(scope="module")
def page():
    sync = pytest.importorskip("playwright.sync_api")
    with sync.sync_playwright() as runner:
        try:
            browser = runner.chromium.launch()
        except Exception as exc:  # no browser downloaded on this machine
            pytest.skip(f"Chromium is not available: {exc}")
        tab = browser.new_page()
        yield tab
        browser.close()


@pytest.fixture
def fresh(page):
    page.set_content(_PAGE)
    return page


def test_pointer_script_dispatches_double_right_and_modifier_clicks(fresh):
    button = fresh.locator("#btn")
    button.evaluate(pa.POINTER_SCRIPT, {"button": "left", "count": 2, "flags": {"shiftKey": True}})
    button.evaluate(pa.POINTER_SCRIPT, {"button": "right", "count": 1, "flags": {}})
    events = fresh.evaluate("events")
    assert ["click", 1, 0, True] in events and ["click", 2, 0, True] in events
    assert ["dblclick", 2, 0, True] in events and ["contextmenu", 1, 2, False] in events


def test_scroll_script_scrolls_the_nearest_scrollable_container(fresh):
    result = fresh.locator("#inner").evaluate(pa.SCROLL_SCRIPT, {"dx": 0, "dy": 100})
    assert result == {"moved": True, "container": "div"}
    assert fresh.evaluate("box.scrollTop") == 100


def test_insert_text_appends_at_the_caret_and_needs_a_focus(fresh):
    field = fresh.locator("#field")
    field.evaluate("el => { el.focus(); el.setSelectionRange(5, 5); }")
    assert field.evaluate(pa.INSERT_TEXT_SCRIPT, {"text": ","}) == {"ok": True}
    assert fresh.evaluate("field.value") == "hello, world"
    fresh.evaluate("document.activeElement.blur()")
    assert fresh.evaluate(f"(o) => ({pa.INSERT_TEXT_SCRIPT.strip()})(null, o)", {"text": "x"}) == {
        "ok": False, "reason_code": "focus_required"}


def test_paste_inserts_rich_text_or_lets_the_page_handle_it(fresh):
    rich = fresh.locator("#rich")
    rich.evaluate("el => { el.focus(); getSelection().selectAllChildren(el); getSelection().collapseToEnd(); }")
    result = rich.evaluate(pa.PASTE_SCRIPT, pa.paste_payload({"text": "**bold**", "format": "md"}))
    assert result == {"ok": True, "handled_by_page": False, "rich": True}
    assert "<strong>bold</strong>" in fresh.evaluate("rich.innerHTML")
    fresh.evaluate("rich.addEventListener('paste', e => { window.pasted = e.clipboardData.getData('text/plain'); e.preventDefault(); })")
    assert rich.evaluate(pa.PASTE_SCRIPT, {"text": "via page", "html": ""}) == {"ok": True, "handled_by_page": True}
    assert fresh.evaluate("window.pasted") == "via page"


def test_select_text_spans_inline_elements_and_honours_prefix(fresh):
    assert fresh.locator("#para").evaluate(pa.SELECT_TEXT_SCRIPT, {
        "text": "beta gam", "prefix": "", "suffix": "", "kind": "text"}) == {"ok": True}
    assert fresh.evaluate("getSelection().toString()") == "beta gam"
    field = fresh.locator("#field")
    assert field.evaluate(pa.SELECT_TEXT_SCRIPT, {"text": "o", "prefix": "w", "suffix": "", "kind": "cursor_after"}) == {"ok": True}
    assert fresh.evaluate("[field.selectionStart, field.selectionEnd]") == [8, 8]
    assert field.evaluate(pa.SELECT_TEXT_SCRIPT, {"text": "zzz", "prefix": "", "suffix": "", "kind": "text"}) == {
        "ok": False, "reason_code": "text_not_found"}
