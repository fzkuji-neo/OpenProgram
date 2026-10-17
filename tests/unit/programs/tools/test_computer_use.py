"""computer_use: pure logic (key chords, tree rendering, diffs, rules, approval)."""
from __future__ import annotations

import pytest

from openprogram.computer_use import keys
from openprogram.computer_use import macos
from openprogram.computer_use.tree import Node, diff, number, render, role_name, snapshot
from openprogram.programs.permission_rule import exact_rule_for_call, parse_command, rule_to_string
from openprogram.programs.tools.system import computer_use as tool


# ----------------------------------------------------------------- key chords

def test_plain_named_keys_map_to_macos_keycodes():
    assert keys.parse_chord("Return") == keys.Chord(36, 0)
    assert keys.parse_chord("escape") == keys.Chord(53, 0)
    assert keys.parse_chord("KP_0") == keys.Chord(82, 0)
    assert keys.parse_chord("F5") == keys.Chord(96, 0)


def test_modifiers_combine_into_flags_and_super_is_command():
    chord = keys.parse_chord("super+shift+z")
    assert chord.keycode == 6
    assert chord.flags == keys.COMMAND | keys.SHIFT
    assert keys.parse_chord("ctrl+c").flags == keys.CONTROL
    assert keys.parse_chord("cmd+alt+Tab").flags == keys.COMMAND | keys.OPTION
    assert sorted(keys.parse_chord("ctrl+shift+Tab").modifier_keycodes) == [56, 59]


def test_shifted_characters_add_shift_and_plus_key_is_spelled_out():
    assert keys.parse_chord("A") == keys.Chord(0, keys.SHIFT, "A")
    assert keys.parse_chord("!") == keys.Chord(18, keys.SHIFT, "!")
    assert keys.parse_chord("plus") == keys.Chord(24, keys.SHIFT)
    assert keys.parse_chord("ctrl++") == keys.Chord(24, keys.CONTROL | keys.SHIFT, "+")
    assert keys.parse_chord("a") == keys.Chord(0, 0, "a")


def test_lone_modifier_is_a_key_and_unknown_names_fail():
    assert keys.parse_chord("shift") == keys.Chord(56, keys.SHIFT)
    for bad in ("", "   ", "Hyper+x", "nosuchkey", "ctrl+"):
        with pytest.raises(keys.KeyNameError):
            keys.parse_chord(bad)


def test_click_modifier_lists_accept_plus_or_comma():
    assert keys.modifier_flags("cmd+shift") == keys.COMMAND | keys.SHIFT
    assert keys.modifier_flags("alt, ctrl") == keys.OPTION | keys.CONTROL
    assert keys.modifier_flags(None) == 0
    with pytest.raises(keys.KeyNameError):
        keys.modifier_flags("meta+bogus")


# ----------------------------------------------------------------- tree text

def test_role_names_read_as_words_with_subrole():
    assert role_name("AXTextField") == "text field"
    assert role_name("AXButton", "AXCloseButton") == "button (close button)"
    assert role_name("AXWindow", "AXStandardWindow") == "window (standard window)"
    assert role_name("AXUnknown") == "unknown"


def test_render_shows_index_depth_label_value_flags_and_secondary_actions():
    nodes = [
        Node(role="AXWindow", depth=0, label="Calculator", actions=["AXRaise"], index=0),
        Node(role="AXButton", depth=1, label="7", actions=["AXPress"], index=1),
        Node(role="AXTextField", depth=1, label="Name", value="Ann", flags=["focused", "settable"],
             actions=["AXShowMenu", "AXConfirm"], index=2),
        Node(role="AXTextField", depth=1, placeholder="Search", index=3),
    ]
    assert render(nodes).splitlines() == [
        '0 window "Calculator" actions: AXRaise',
        '  1 button "7"',
        '  2 text field "Name" value="Ann" [focused, settable] actions: AXShowMenu',
        '  3 text field placeholder="Search"',
    ]


def test_bidirectional_marks_are_dropped_from_values():
    assert Node(role="AXStaticText", depth=0, value="\u200e42\u200f", index=0).line() == '0 static text value="42"'


def test_long_values_are_clipped_and_whitespace_collapsed():
    node = Node(role="AXStaticText", depth=0, value="a  b\n" * 100, index=0)
    line = node.line()
    assert "\n" not in line and line.endswith('…"') and len(line) < 200


class _Nodes(list):
    next_index = 0


def _snap(nodes):
    return snapshot(nodes, nodes.next_index)


def _numbered(nodes, previous=None):
    nodes = _Nodes(nodes)
    nodes.next_index = number(nodes, previous)
    return nodes


def test_diff_marks_changed_lines_and_keeps_the_index_of_an_element_changed_in_place():
    before = _numbered([Node(role="AXStaticText", depth=1, value="0"),
                        Node(role="AXButton", depth=1, label="Delete")])
    after = _numbered([Node(role="AXStaticText", depth=1, value="7"),
                       Node(role="AXButton", depth=1, label="All Clear")], _snap(before))
    assert [node.index for node in after] == [0, 1]
    text, is_diff = diff(_snap(before), after)
    assert is_diff
    assert text.splitlines() == [
        '- static text value="0"', '- button "Delete"',
        '+ 0 static text value="7"', '+ 1 button "All Clear"',
    ]


def test_an_insertion_above_does_not_shift_the_indices_the_model_already_has():
    before = _numbered([Node(role="AXButton", depth=0, label=name) for name in ("A", "B", "C")])
    after = _numbered([Node(role="AXStaticText", depth=0, value="banner")]
                      + [Node(role="AXButton", depth=0, label=name) for name in ("A", "B", "C")], _snap(before))
    assert [(node.label or node.value, node.index) for node in after] == [("banner", 3), ("A", 0), ("B", 1), ("C", 2)]
    assert diff(_snap(before), after) == ('+ 3 static text value="banner"', True)


def test_a_replaced_element_of_another_role_gets_a_new_index_and_freed_ones_are_not_reused():
    before = _numbered([Node(role="AXButton", depth=0, label="OK"), Node(role="AXButton", depth=0, label="Go")])
    after = _numbered([Node(role="AXTextField", depth=0, value="hi"), Node(role="AXButton", depth=0, label="Go")],
                      _snap(before))
    assert [node.index for node in after] == [2, 1]
    again = _numbered([Node(role="AXButton", depth=0, label="Go")], _snap(after))
    assert [node.index for node in again] == [1] and _snap(again).next_index == 3


def test_diff_without_previous_or_with_no_change():
    nodes = _numbered([Node(role="AXButton", depth=0, label="OK")])
    assert diff(None, nodes) == ('0 button "OK"', False)
    assert diff(_snap(nodes), nodes) == ("(no changes in the Accessibility tree)", True)


def test_diff_falls_back_to_the_full_tree_when_most_lines_changed():
    before = _numbered([Node(role="AXButton", depth=0, label=str(i)) for i in range(30)])
    after = _numbered([Node(role="AXButton", depth=0, label=f"x{i}") for i in range(30)], _snap(before))
    text, is_diff = diff(_snap(before), after)
    assert not is_diff and text == render(after)


def test_menu_titles_match_case_insensitively_without_the_ellipsis():
    assert macos._menu_key("Export…") == macos._menu_key("export") == macos._menu_key(" EXPORT... ")
    assert macos._menu_key("Export as PDF…") != macos._menu_key("Export")


def test_hold_durations_are_bounded():
    assert macos._seconds(None, "duration") == 0 and macos._seconds("1.5", "duration") == 1.5
    for bad in (-1, 11, "soon"):
        with pytest.raises(macos.ComputerUseError):
            macos._seconds(bad, "duration")


# ----------------------------------------------------------------- rules and approval

def test_rule_for_a_call_names_the_app_only():
    args = {"action": "click", "app": "  Calculator ", "element_index": 12, "x": 1}
    assert parse_command("computer_use", args) == "calculator"
    assert rule_to_string(exact_rule_for_call("computer_use", args)) == "computer_use(calculator)"
    assert parse_command("computer_use", {"action": "list_apps"}) is None


def test_every_action_but_list_apps_requires_approval_per_app():
    assert tool.requires_approval(action="list_apps") is False
    assert tool.requires_approval(action="click", app="Calculator") == "computer_use controls calculator"
    assert tool.requires_approval(action="get_app_state", app="") == "computer_use controls an application"


def test_tool_is_a_deferred_default_hidden_from_chat_channels():
    from openprogram.programs import DEFAULT_TOOLS, DEFERRED_DEFAULT_TOOLS, RESIDENT_TOOLS, _unsafe_in_for
    from openprogram.programs._runtime import get
    registered = get("computer_use")
    assert registered is not None and registered._defer is True
    assert "computer_use" in DEFAULT_TOOLS and "computer_use" in DEFERRED_DEFAULT_TOOLS
    assert "computer_use" not in RESIDENT_TOOLS
    assert {"wechat", "telegram", "plan"} <= set(_unsafe_in_for("computer_use"))
    assert set(tool.ACTIONS) == set(registered.parameters["properties"]["action"]["enum"])


def test_unknown_action_is_an_error_without_touching_the_host():
    result = tool.computer_use("fly")
    assert result.is_error and "unknown action" in result.text


def test_desktop_access_is_required_for_everything_but_list_apps():
    from openprogram.system_access import _desktop_operation
    assert _desktop_operation("computer_use", {"action": "list_apps"}) is None
    assert _desktop_operation("computer_use", {"action": "click", "app": "Notes"}) == "computer_use:desktop"
    assert _desktop_operation("gui_agent", {"surface": "desktop"}) == "gui_agent:desktop"
    assert _desktop_operation("gui_agent", {"surface": "browser"}) is None


@pytest.fixture
def decide(monkeypatch):
    """permission_decision for computer_use with authority and recovery stubbed out."""
    from types import SimpleNamespace
    from openprogram.agent import authority
    from openprogram.agent.permissions import policy, recovery
    from openprogram.programs._runtime import get

    monkeypatch.setattr(policy, "_hard_constraint_violation", lambda *a, **k: None)
    monkeypatch.setattr(authority, "decide_tool_authority",
                        lambda *a, **k: SimpleNamespace(allowed=True, reason_code="", capability=""))
    monkeypatch.setattr(recovery, "approval_context", lambda *a, **k: None)
    agent_tool = get("computer_use")

    def run(args, *, mode="auto", allow=(), source="web"):
        rules = SimpleNamespace(allow=list(allow), ask=[], deny=[])
        req = SimpleNamespace(permission_mode=mode, permission_rules=rules, session_id="s-test",
                              source=source, surface_context=None)
        return policy.permission_decision(agent_tool, req, args)[:2]
    return run


@pytest.mark.parametrize("mode", ["auto", "bypass", "default", "acceptEdits"])
def test_first_touch_of_an_app_asks_in_every_mode(decide, mode):
    assert decide({"action": "click", "app": "Calculator"}, mode=mode) == ("ask", "APP_GRANT_REQUIRED")


def test_an_allow_rule_for_the_app_lets_it_run_and_names_only_that_app(decide):
    rule = ["computer_use(calculator)"]
    assert decide({"action": "click", "app": "Calculator"}, allow=rule) == ("allow", "PERMISSION_RULE_ALLOW")
    assert decide({"action": "click", "app": "Notes"}, allow=rule) == ("ask", "APP_GRANT_REQUIRED")


def test_list_apps_needs_no_grant_and_unattended_sources_cannot_grant(decide):
    assert decide({"action": "list_apps"}, mode="bypass") == ("allow", "BYPASS")
    assert decide({"action": "click", "app": "Calculator"}, source="cron")[0] == "deny"


def test_approval_card_offers_the_conversation_scope_for_computer_use():
    from openprogram.agent.permissions import approval
    from openprogram.execution.waits import _APPROVAL_SCOPES
    assert "computer_use" in approval._SESSION_SCOPE_TOOLS
    assert "session" in _APPROVAL_SCOPES


@pytest.mark.parametrize("launch", [True, False])
def test_refused_apps_are_refused_before_launch_whether_or_not_running(monkeypatch, launch):
    from openprogram.computer_use import macos
    computer = macos.MacComputer()
    launched = []
    monkeypatch.setattr(computer, "_running_match", lambda _q: None)
    monkeypatch.setattr(computer, "_installed_match", lambda _q: {
        "bundle_id": "com.apple.Passwords", "display_name": "Passwords", "name": "Passwords", "path": ""})
    monkeypatch.setattr(macos.subprocess, "run", lambda *a, **k: launched.append(a))
    with pytest.raises(macos.ComputerUseError, match="cannot be controlled"):
        computer.resolve_app("Passwords", launch=launch)
    assert launched == []


# ----------------------------------------------------------------- text helpers

def test_find_text_honours_prefix_and_suffix_and_utf16_offsets():
    from openprogram.computer_use.macos import find_text, utf16_len
    value = "the cat sat on the mat"
    assert find_text(value, "the") == 0
    assert find_text(value, "the", suffix=" mat") == 15
    assert find_text(value, "the", prefix="on ") == 15
    assert find_text(value, "dog") is None
    assert utf16_len("a😀b") == 4


# ----------------------------------------------------------------- tool layer

class _FakeComputer:
    def __init__(self, results):
        self.results, self.calls, self.settled = list(results), [], 0

    def act(self, session, action, step):
        self.calls.append((action, step))
        result = self.results.pop(0)
        if isinstance(result, Exception):
            raise result
        return result

    def settle(self, session, app):
        self.settled += 1
        return 0.0

    def get_state(self, session, app, **kwargs):
        assert kwargs == {"as_diff": True}
        return macos.Observation(text="+ 4 button \"=\"", image=None, app=app)


@pytest.fixture
def fake(monkeypatch):
    def install(*results):
        computer = _FakeComputer(results)
        monkeypatch.setattr(macos, "backend", lambda: computer)
        return computer
    return install


def test_an_action_settles_once_and_returns_the_changed_tree(fake):
    computer = fake("pressed button \"7\"")
    result = tool.computer_use(action="click", app="Calculator", element_index=3)
    assert not result.is_error and computer.settled == 1
    assert result.text == 'Done: pressed button "7".\n\n+ 4 button "="'
    assert computer.calls[0][1]["element_index"] == 3


def test_a_read_only_result_comes_back_without_a_new_state(fake):
    computer = fake(macos.Report("menu bar: File | Edit"))
    result = tool.computer_use(action="menu", app="Calculator")
    assert result.text == "menu bar: File | Edit" and computer.settled == 0


def test_a_batch_runs_in_order_stops_at_the_first_error_and_reports_the_state_once(fake):
    computer = fake("typed 3 character(s)", macos.ComputerUseError("element 9 no longer exists"), "unused")
    result = tool.computer_use(action="batch", app="Notes", actions=[
        {"action": "type_text", "text": "abc"}, {"action": "click", "element_index": 9}, {"action": "press_key", "key": "Return"}])
    assert result.is_error and computer.settled == 1 and len(computer.calls) == 2
    assert result.text.startswith("Done:\n1. typed 3 character(s)\nError: step 2 (click) failed: element 9 no longer exists")
    assert all(step["app"] == "Notes" for _, step in computer.calls)


@pytest.mark.parametrize("steps, message", [
    ([], "batch needs actions"),
    ([{"action": "get_app_state"}], "cannot run in a batch"),
    ([{"action": "click", "app": "Finder", "element_index": 1}], "names another app"),
    ([{"action": "click"}] * 21, "at most 20"),
])
def test_a_batch_is_checked_before_any_step_runs(fake, steps, message):
    computer = fake()
    result = tool.computer_use(action="batch", app="Notes", actions=steps)
    assert result.is_error and message in result.text and computer.calls == []


def test_every_action_but_list_apps_needs_an_app(fake):
    fake()
    result = tool.computer_use(action="list_windows")
    assert result.is_error and "list_windows needs app" in result.text


# ----------------------------------------------------------------- app lookup for the interface

def _ws_reply(cmd):
    import asyncio
    import json as _json
    from openprogram.webui.ws_actions import session

    sent = []

    class _WS:
        async def send_text(self, text):
            sent.append(_json.loads(text))

    asyncio.run(session.handle_computer_use_apps(_WS(), cmd))
    return sent[0]


def test_app_lookup_dedupes_names_and_launches_nothing(monkeypatch):
    seen = []

    class _Lookup:
        def app_info(self, query):
            seen.append(query)
            return {"query": query, "name": query.title(), "bundle_id": f"com.example.{query}", "icon": ""}

    monkeypatch.setattr(macos, "backend", lambda: _Lookup())
    reply = _ws_reply({"apps": ["notes", " notes ", "mail"], "request_id": "r1"})
    assert reply["type"] == "computer_use_apps" and reply["data"]["request_id"] == "r1"
    assert [app["name"] for app in reply["data"]["apps"]] == ["Notes", "Mail"] and seen == ["notes", "mail"]


def test_app_lookup_rejects_anything_but_a_short_list_of_names():
    assert _ws_reply({"apps": "notes"})["data"]["status"] == "error"
    assert _ws_reply({"apps": ["x"] * 51})["data"]["status"] == "error"
