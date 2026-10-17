"""computer_use: pure logic (key chords, tree rendering, diffs, rules, approval)."""
from __future__ import annotations

import pytest

from openprogram.computer_use import keys
from openprogram.computer_use.tree import Node, diff, render, role_name, signature
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


def test_long_values_are_clipped_and_whitespace_collapsed():
    node = Node(role="AXStaticText", depth=0, value="a  b\n" * 100, index=0)
    line = node.line()
    assert "\n" not in line and line.endswith('…"') and len(line) < 200


def test_diff_marks_changed_lines_with_new_indices_and_drops_removed_ones():
    before = [Node(role="AXStaticText", depth=1, value="0", index=0),
              Node(role="AXButton", depth=1, label="Delete", index=1)]
    after = [Node(role="AXStaticText", depth=1, value="7", index=0),
             Node(role="AXButton", depth=1, label="All Clear", index=1)]
    text, is_diff = diff(signature(before), after)
    assert is_diff
    assert text.splitlines() == [
        '- static text value="0"', '- button "Delete"',
        '+ 0 static text value="7"', '+ 1 button "All Clear"',
    ]


def test_diff_without_previous_or_with_no_change():
    nodes = [Node(role="AXButton", depth=0, label="OK", index=0)]
    assert diff(None, nodes) == ('0 button "OK"', False)
    assert diff(signature(nodes), nodes) == ("(no changes in the Accessibility tree)", True)


def test_diff_falls_back_to_the_full_tree_when_most_lines_changed():
    before = [Node(role="AXButton", depth=0, label=str(i), index=i) for i in range(30)]
    after = [Node(role="AXButton", depth=0, label=f"x{i}", index=i) for i in range(30)]
    text, is_diff = diff(signature(before), after)
    assert not is_diff and text == render(after)


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


def test_approval_card_offers_the_conversation_scope_for_computer_use():
    from openprogram.agent.permissions import approval
    from openprogram.execution.waits import _APPROVAL_SCOPES
    assert "computer_use" in approval._SESSION_SCOPE_TOOLS
    assert "session" in _APPROVAL_SCOPES


# ----------------------------------------------------------------- text helpers

def test_find_text_honours_prefix_and_suffix_and_utf16_offsets():
    from openprogram.computer_use.macos import find_text, utf16_len
    value = "the cat sat on the mat"
    assert find_text(value, "the") == 0
    assert find_text(value, "the", suffix=" mat") == 15
    assert find_text(value, "the", prefix="on ") == 15
    assert find_text(value, "dog") is None
    assert utf16_len("a😀b") == 4
