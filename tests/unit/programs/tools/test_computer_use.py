"""computer_use_agent's app target: pure logic (key chords, tree rendering, diffs, rules, approval)."""
from __future__ import annotations

import pytest

from openprogram.computer_use import base
from openprogram.computer_use import keys
from openprogram.computer_use import macos
from openprogram.computer_use import ocr
from openprogram.computer_use.tree import Node, diff, number, render, role_name, snapshot
from openprogram.programs.permission_rule import exact_rule_for_call, parse_command, rule_to_string
from openprogram.programs.tools.system.computer_use_agent import tool as entry
from openprogram.programs.tools.system.computer_use_agent.targets import app as tool


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


# ----------------------------------------------------------------- OCR fallback

def test_vision_boxes_become_screenshot_pixels_in_reading_order():
    found = [("right", (0.5, 0.8, 0.2, 0.1)), ("left", (0.1, 0.81, 0.2, 0.1)), ("below", (0.1, 0.1, 0.3, 0.1)),
             ("  ", (0, 0, 0.1, 0.1))]
    boxes = ocr.boxes_from_normalized(found, 1000, 500)
    assert [b.text for b in boxes] == ["left", "right", "below"]
    assert boxes[1] == ocr.TextBox("right", 500, 50, 200, 50)
    assert boxes[1].line() == '"right" at (600, 75), 200x50'


def test_ocr_lines_are_capped_and_matched_case_insensitively():
    boxes = [ocr.TextBox(f"Item {n}", 0, n * 10, 50, 10) for n in range(ocr.MAX_LINES + 5)]
    rendered = ocr.render(boxes).splitlines()
    assert len(rendered) == ocr.MAX_LINES + 1 and rendered[-1].startswith("…and 5 more")
    assert [b.text for b in ocr.matching(boxes, "item  10")] == ["Item 10"] + [f"Item {n}" for n in range(100, 110)]


def test_recognition_hints_put_preferred_languages_first_then_cjk_and_english():
    supported = ["en-US", "fr-FR", "zh-Hans", "zh-Hant", "ja-JP", "ko-KR", "de-DE"]
    assert ocr.pick_languages(["zh-Hant-TW", "fr-CA"], supported) == [
        "zh-Hant", "fr-FR", "zh-Hans", "ja-JP", "ko-KR", "en-US"]
    assert ocr.pick_languages(["de-AT"], ["en-US", "de-DE"]) == ["de-DE", "en-US"]


def test_touching_outlines_merge_into_one_control_and_text_or_odd_sizes_are_dropped():
    boxes = [(100, 100, 20, 30), (122, 110, 20, 20),   # one icon drawn as two outlines, 2 px apart
             (300, 100, 40, 40),                        # a lone icon
             (500, 104, 30, 30),                        # covers the word below
             (10, 10, 6, 6), (10, 300, 400, 30), (600, 100, 20, 120)]   # a speck, a bar, a sliver
    shapes = ocr.shapes_from_boxes(boxes, [ocr.TextBox("Save", 495, 100, 60, 40),
                                           ocr.TextBox("前", 300, 100, 40, 40)], scale=2.0)  # a misread icon
    assert shapes == [ocr.Shape(100, 100, 42, 30), ocr.Shape(300, 100, 40, 40)]
    assert ocr.render_shapes(shapes).splitlines() == ["(121, 115), 42x30", "(320, 120), 40x40"]
    corners = [(0, 0, 36, 36), (1964, 1064, 36, 36), (900, 500, 40, 40)]   # two window corners and an icon
    assert ocr.shapes_from_boxes(corners, [], scale=2.0, size=(2000, 1100)) == [ocr.Shape(900, 500, 40, 40)]
    many = [ocr.Shape(n * 40, 0, 20, 20) for n in range(ocr.MAX_SHAPES + 2)]
    assert ocr.render_shapes(many).splitlines()[-1].startswith("…and 2 more")


def test_vision_outlines_icons_that_carry_no_text():
    if not ocr.available():
        pytest.skip("Vision is not installed")
    AppKit = pytest.importorskip("AppKit")
    image = AppKit.NSImage.alloc().initWithSize_((600, 160))
    image.lockFocus()
    AppKit.NSColor.whiteColor().set()
    AppKit.NSBezierPath.fillRect_(((0, 0), (600, 160)))
    names = ["gearshape", "trash", "magnifyingglass", "square.and.arrow.up"]
    for i, name in enumerate(names):
        symbol = AppKit.NSImage.imageWithSystemSymbolName_accessibilityDescription_(name, None)
        symbol.drawInRect_(((40 + i * 120, 90), (32, 32)))
    font = {AppKit.NSFontAttributeName: AppKit.NSFont.systemFontOfSize_(22)}
    AppKit.NSString.stringWithString_("Save changes").drawAtPoint_withAttributes_((40, 20), font)
    image.unlockFocus()
    bitmap = AppKit.NSBitmapImageRep.alloc().initWithData_(image.TIFFRepresentation())
    png = bytes(bitmap.representationUsingType_properties_(AppKit.NSBitmapImageFileTypePNG, {}))
    width, height = bitmap.pixelsWide(), bitmap.pixelsHigh()
    scale = width / 600
    shapes = ocr.detect_shapes(png, width, height, ocr.recognize(png, width, height), scale)
    assert len(shapes) == len(names)
    for shape, i in zip(shapes, range(len(names))):
        cx, cy = shape.center
        assert abs(cx / scale - (56 + i * 120)) < 8 and abs(cy / scale - (160 - 106)) < 8


def test_only_the_window_walk_counts_towards_a_sparse_tree():
    nodes = [Node("AXWindow", 0), Node("AXButton", 1), Node("AXButton", 1), Node("AXMenuBar", 0), Node("AXMenuBarItem", 1)]
    assert macos._window_node_count(nodes) == 3
    assert macos._window_node_count(nodes[:3]) == 3


def test_find_falls_back_to_text_on_the_screenshot(monkeypatch):
    computer = macos.MacComputer()
    state = macos.WindowState(pid=1, window_title="Game", nodes=[Node("AXWindow", 0, label="Game", index=0)],
                              has_screenshot=True, scale=2.0, size=(400, 300),
                              text_boxes=[ocr.TextBox("New Game", 100, 200, 120, 30)])
    monkeypatch.setattr(computer, "_state_for", lambda session, query: (None, state))
    assert '"New Game" at (160, 215)' in computer.find("s", "Game", text="new game")
    assert computer.find("s", "Game", text="quit").startswith("no element of the last tree matches")
    assert computer.find("s", "Game", text="Game").startswith("1 match(es)")


def test_vision_reads_mixed_scripts_from_a_rendered_image():
    if not ocr.available():
        pytest.skip("Vision is not installed")
    AppKit = pytest.importorskip("AppKit")
    Foundation = pytest.importorskip("Foundation")
    image = AppKit.NSImage.alloc().initWithSize_((520, 160))
    image.lockFocus()
    AppKit.NSColor.whiteColor().set()
    AppKit.NSBezierPath.fillRect_(((0, 0), (520, 160)))
    font = {AppKit.NSFontAttributeName: AppKit.NSFont.systemFontOfSize_(30)}
    Foundation.NSString.stringWithString_("Start Game").drawAtPoint_withAttributes_((30, 100), font)
    Foundation.NSString.stringWithString_("设置 选项").drawAtPoint_withAttributes_((260, 20), font)
    image.unlockFocus()
    bitmap = AppKit.NSBitmapImageRep.alloc().initWithData_(image.TIFFRepresentation())
    png = bytes(bitmap.representationUsingType_properties_(AppKit.NSBitmapImageFileTypePNG, {}))
    width, height = bitmap.pixelsWide(), bitmap.pixelsHigh()
    boxes = ocr.recognize(png, width, height)
    assert [b.text.replace(" ", "") for b in boxes] == ["StartGame", "设置选项"]
    x, y = boxes[0].center
    assert x < width / 2 and y < height / 2


def test_running_apps_are_looked_up_per_process_so_a_new_launch_is_seen():
    import os
    import platform
    if platform.system() != "Darwin":
        pytest.skip("libproc is macOS only")
    me = object()

    class FakeAppKit:
        class NSRunningApplication:
            @staticmethod
            def runningApplicationWithProcessIdentifier_(pid):
                return me if pid == os.getpid() else None

    from openprogram.computer_use.processes import running_applications
    assert running_applications(FakeAppKit) == [me]


def test_the_tree_walk_stops_at_a_cycle_back_to_the_app_or_an_element_seen_before(monkeypatch):
    # QuickTime Player with no document lists the application as its window, whose child is itself.
    graph = {"app": ["window", "menubar"], "window": ["button", "app"], "button": ["window"], "menubar": []}
    roles = {"app": "AXApplication", "window": "AXWindow", "button": "AXButton", "menubar": "AXMenuBar"}
    computer = macos.MacComputer()
    monkeypatch.setattr(computer, "_other_space_windows", lambda root, windows: [])
    monkeypatch.setattr(computer, "_node", lambda element, depth: (
        Node(roles[element], depth, label=element), list(graph[element])))
    monkeypatch.setattr(computer, "_attr", lambda element, name: {
        ("app", "AXChildren"): graph["app"], ("app", "AXMenuBar"): "menubar",
        ("app", "AXWindows"): ["app", "window"]}.get((element, name)) or (
        roles.get(element) if name == "AXRole" else None))
    nodes, _elements, complete = computer._read_tree("app", "window")
    assert [n.label for n in nodes] == ["window", "button", "menubar"] and complete
    assert computer._windows("app") == ["window"]
    # A focused "window" that is the application itself is not picked.
    monkeypatch.setattr(computer, "_attr", lambda element, name: {
        ("app", "AXWindows"): ["app"], ("app", "AXFocusedWindow"): "app"}.get((element, name)) or (
        roles.get(element) if name == "AXRole" else None))
    assert computer._pick_window("app", None) is None


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
    args = {"target": "app", "action": "click", "args": {"app": "  Calculator ", "element_index": 12, "x": 1}}
    assert parse_command("computer_use_agent", args) == "calculator"
    assert rule_to_string(exact_rule_for_call("computer_use_agent", args)) == "computer_use_agent(calculator)"
    assert parse_command("computer_use_agent", {"target": "app", "action": "list_apps"}) is None
    assert parse_command("computer_use_agent", {"target": "browser", "action": "click", "args": {"ref": "e1"}}) is None


def test_every_action_but_list_apps_requires_approval_per_app():
    assert entry.requires_approval(target="app", action="list_apps") is False
    assert entry.requires_approval(target="app", action="click", args={"app": "Calculator"}) == \
        "computer_use_agent controls calculator"
    assert entry.requires_approval(target="app", action="get_app_state") == "computer_use_agent controls an application"
    # Opening the target, code and a fresh agent all reach the whole app.
    for call in ({}, {"code": "pass"}, {"context": "fresh"}):
        assert entry.requires_approval(target="app", args={"app": "Notes"}, **call) == "computer_use_agent controls notes"


def test_tool_is_a_resident_default_hidden_from_chat_channels():
    from openprogram.programs import DEFAULT_TOOLS, DEFERRED_DEFAULT_TOOLS, RESIDENT_TOOLS, _unsafe_in_for
    from openprogram.programs._runtime import get
    registered = get("computer_use_agent")
    assert registered is not None and not registered._defer
    assert "computer_use_agent" in DEFAULT_TOOLS and "computer_use_agent" not in DEFERRED_DEFAULT_TOOLS
    assert "computer_use_agent" in RESIDENT_TOOLS
    assert {"wechat", "telegram", "plan"} <= set(_unsafe_in_for("computer_use_agent"))
    assert registered.parameters["properties"]["target"]["enum"] == ["app", "browser", "vm"]
    for gone in ("computer_use", "gui_agent", "web_use"):
        assert gone not in DEFAULT_TOOLS and gone not in RESIDENT_TOOLS


def test_unknown_action_is_an_error_without_touching_the_host():
    result = tool.run([("fly", {})], {"app": "Notes"}, "s")
    assert result.is_error and "unknown app action" in result.text
    result = entry.computer_use_agent(target="printer")
    assert result.is_error and "unknown target" in result.text


def test_desktop_access_is_required_for_everything_but_list_apps():
    from openprogram.system_access import _desktop_operation
    assert _desktop_operation("computer_use_agent", {"target": "app", "action": "list_apps"}) is None
    assert _desktop_operation("computer_use_agent", {"target": "app", "action": "click", "args": {"app": "Notes"}}) \
        == "computer_use:desktop"
    assert _desktop_operation("computer_use_agent", {"target": "app", "code": "pass"}) == "computer_use:desktop"
    assert _desktop_operation("computer_use_agent", {"target": "browser", "action": "click"}) is None


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
    agent_tool = get("computer_use_agent")

    def run(args, *, mode="auto", allow=(), source="web"):
        rules = SimpleNamespace(allow=list(allow), ask=[], deny=[])
        req = SimpleNamespace(permission_mode=mode, permission_rules=rules, session_id="s-test",
                              source=source, surface_context=None)
        return policy.permission_decision(agent_tool, req, {"target": "app", **args})[:2]
    return run


@pytest.mark.parametrize("mode", ["default", "acceptEdits"])
def test_first_touch_of_an_app_asks_in_the_modes_that_ask(decide, mode):
    assert decide({"action": "click", "args": {"app": "Calculator"}}, mode=mode) == ("ask", "APP_GRANT_REQUIRED")


def test_bypass_runs_and_auto_reviews_app_control_without_a_grant(decide):
    click = {"action": "click", "args": {"app": "Calculator"}}
    assert decide(click, mode="bypass") == ("allow", "BYPASS")
    assert decide(click, mode="auto") == ("auto", "AUTO_CLASSIFY")


@pytest.mark.parametrize("rule", ["computer_use_agent(calculator)", "computer_use(calculator)"])
def test_an_allow_rule_for_the_app_lets_it_run_and_names_only_that_app(decide, rule):
    # Rules saved under the tool's earlier name still grant the app.
    click = {"action": "click", "args": {"app": "Calculator"}}
    assert decide(click, allow=[rule], mode="default") == ("allow", "PERMISSION_RULE_ALLOW")
    assert decide({"action": "click", "args": {"app": "Notes"}}, allow=[rule], mode="default") == ("ask", "APP_GRANT_REQUIRED")


def test_list_apps_needs_no_grant_and_unattended_sources_cannot_grant(decide):
    assert decide({"action": "list_apps"}, mode="bypass") == ("allow", "BYPASS")
    assert decide({"action": "click", "args": {"app": "Calculator"}}, mode="default", source="cron")[0] == "deny"


def test_page_scripts_ask_every_time_and_never_become_a_rule(decide):
    from openprogram.agent.permissions import policy
    call = {"target": "browser", "actions": [{"action": "evaluate", "args": {"script": "1"}}]}
    assert policy.force_approval("computer_use_agent", call) and policy.one_shot_approval("computer_use_agent", call)
    assert not policy.force_approval("computer_use_agent", {"target": "browser", "action": "click"})


def test_approval_card_offers_the_conversation_scope_for_computer_use():
    from openprogram.agent.permissions import approval
    from openprogram.execution.waits import _APPROVAL_SCOPES
    assert "computer_use_agent" in approval._SESSION_SCOPE_TOOLS
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
    result = tool.run([("click", {"app": "Calculator", "element_index": 3})], {"app": "Calculator"}, "s")
    assert not result.is_error and computer.settled == 1
    assert result.text == 'Done: pressed button "7".\n\n+ 4 button "="'
    assert computer.calls[0][1]["element_index"] == 3


def test_a_read_only_result_comes_back_without_a_new_state(fake):
    computer = fake(macos.Report("menu bar: File | Edit"))
    result = tool.run([("menu", {})], {"app": "Calculator"}, "s")
    assert result.text == "menu bar: File | Edit" and computer.settled == 0


def test_a_batch_runs_in_order_stops_at_the_first_error_and_reports_the_state_once(fake):
    computer = fake("typed 3 character(s)", macos.ComputerUseError("element 9 no longer exists"), "unused")
    result = tool.run([("type_text", {"text": "abc"}), ("click", {"element_index": 9}), ("press_key", {"key": "Return"})],
                      {"app": "Notes"}, "s")
    assert result.is_error and computer.settled == 1 and len(computer.calls) == 2
    assert result.text.startswith("Done:\n1. typed 3 character(s)\nError: step 2 (click) failed: element 9 no longer exists")
    assert all(step["app"] == "Notes" for _, step in computer.calls)


@pytest.mark.parametrize("steps, message", [
    ([{"action": "get_app_state"}, {"action": "click"}], "cannot run among several steps"),
    ([{"action": "click", "args": {"app": "Finder", "element_index": 1}}, {"action": "wait"}], "names another app"),
    ([{"action": "click"}] * 21, "at most 20"),
    ([{"args": {}}], "needs action"),
])
def test_steps_are_checked_before_any_step_runs(fake, steps, message):
    computer = fake()
    entry._shown.add(("default", 0, "app"))
    result = entry.computer_use_agent(target="app", args={"app": "Notes"}, actions=steps)
    assert result.is_error and message in result.text and computer.calls == []


def test_the_first_call_to_a_target_carries_its_guide_once(fake):
    computer = fake()
    computer.list_apps = lambda: "Notes (running)"
    entry._shown.clear()
    first = entry.computer_use_agent(target="app", action="list_apps")
    assert first.text.startswith('Guide: target "app"') and first.text.endswith("Notes (running)")
    assert entry.computer_use_agent(target="app", action="list_apps").text == "Notes (running)"
    assert entry.computer_use_agent(target="app", action="guide").text.startswith('Guide: target "app"')


def test_every_action_but_list_apps_needs_an_app(fake):
    fake()
    result = tool.run([("list_windows", {})], {}, "s")
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


def test_the_mention_menu_lists_running_regular_apps_but_not_refused_ones(monkeypatch):
    import os

    class _App:
        def __init__(self, name, bundle, pid, policy=0):
            self.name, self.bundle, self.pid, self.policy = name, bundle, pid, policy
        def bundleIdentifier(self): return self.bundle
        def localizedName(self): return self.name
        def processIdentifier(self): return self.pid
        def activationPolicy(self): return self.policy
        def isTerminated(self): return False
        def bundleURL(self): return None

    class _AppKit:
        NSApplicationActivationPolicyRegular = 0

    apps = [_App("Notes", "com.apple.Notes", 11), _App("Calculator", "com.apple.calculator", 12),
            _App("Passwords", "com.apple.Passwords", 13), _App("Dock helper", "com.apple.dock.extra", 14, policy=1),
            _App("Me", "com.example.me", os.getpid())]
    monkeypatch.setattr(macos, "_appkit", lambda: _AppKit)
    monkeypatch.setattr(macos, "running_applications", lambda appkit: apps)
    computer = macos.MacComputer.__new__(macos.MacComputer)
    listed = computer.running_apps()
    assert [(a["name"], a["bundle_id"]) for a in listed] == [("Calculator", "com.apple.calculator"),
                                                             ("Notes", "com.apple.Notes")]

    monkeypatch.setattr(macos, "backend", lambda: computer)
    reply = _ws_reply({"running": True, "request_id": "r2"})["data"]
    assert reply["status"] == "ok" and [a["name"] for a in reply["apps"]] == ["Calculator", "Notes"]


def test_app_lookup_rejects_anything_but_a_short_list_of_names():
    assert _ws_reply({"apps": "notes"})["data"]["status"] == "error"
    assert _ws_reply({"apps": ["x"] * 51})["data"]["status"] == "error"


# ----------------------------------------------------------------- audio

def test_recording_limits_default_to_a_minute_and_stop_at_five():
    from openprogram.computer_use import audio
    assert audio.seconds(None) == 60 and audio.seconds("12.5") == 12.5
    for bad in (0, -1, 301, "long"):
        with pytest.raises(ValueError):
            audio.seconds(bad)


def test_float_samples_become_a_16_bit_mono_wav_with_their_peak():
    import io
    import wave
    from array import array
    from openprogram.computer_use import audio
    data, peak = audio.wav(array("f", [0.0, 0.5, -1.5, 0.25]).tobytes())
    clip = wave.open(io.BytesIO(data))
    assert (clip.getnchannels(), clip.getsampwidth(), clip.getframerate(), clip.getnframes()) == (1, 2, 16000, 4)
    assert array("h", clip.readframes(4)).tolist() == [0, 16383, -32767, 8191] and peak == 1.0


def test_a_recording_keeps_samples_only_up_to_its_limit():
    from openprogram.computer_use import audio
    recording = audio.Recording(app="Music", pid=1, limit=1.0)
    recording.take(b"\0" * 4 * 12_000)
    recording.take(b"\0" * 4 * 12_000)
    assert recording.frames == audio.SAMPLE_RATE and recording.seconds == 1.0


def _clip(peak, tmp_path):
    return macos.AudioClip(app="Music", path=tmp_path / "a.wav", data=b"RIFF", seconds=2.0, peak=peak)


def test_a_stopped_recording_reports_its_file_and_transcript(monkeypatch, tmp_path):
    from openprogram import voice
    monkeypatch.setattr(voice, "transcribe", lambda data: {"text": " 你好 ", "engine": "local", "model": "m"})
    text = tool._clip_text(_clip(0.3, tmp_path), transcribe=True)
    assert text == f"Recorded 2 seconds of Music, saved to {tmp_path / 'a.wav'}.\nTranscript (local, m):\n你好"
    assert "silent" in tool._clip_text(_clip(0.0, tmp_path), transcribe=True)
    assert "Transcript" not in tool._clip_text(_clip(0.3, tmp_path), transcribe=False)

    def broken(data):
        raise voice.VoiceError("No speech engine is set up.")
    monkeypatch.setattr(voice, "transcribe", broken)
    assert tool._clip_text(_clip(0.3, tmp_path), transcribe=True).endswith("Not transcribed: No speech engine is set up.")


def test_audio_actions_reach_the_backend_without_a_state_read(fake):
    computer = fake()
    started = []
    computer.start_audio = lambda session, app, limit: started.append((app, limit)) or macos.Report("Recording Music")
    assert tool.run([("start_audio_recording", {"max_duration": 30})], {"app": "Music"}, "s").text == "Recording Music"
    assert started == [("Music", 30)] and computer.settled == 0
    assert tool.run([("stop_audio_recording", {})], {}, "s").is_error  # the approval names the app
    assert entry.requires_approval(target="app", action="start_audio_recording", args={"app": "Music"}) == \
        "computer_use_agent controls music"


def test_recordings_are_saved_under_the_state_directory_and_pruned(monkeypatch, tmp_path):
    import openprogram.paths as paths
    monkeypatch.setattr(paths, "get_state_dir", lambda: tmp_path)
    monkeypatch.setattr(base, "KEEP_RECORDINGS", 2)
    saved = [base.save_recording("Quick Time", b"x") for _ in range(3)]
    left = sorted(p.name for p in (tmp_path / "computer-use" / "audio").iterdir())
    assert len(left) == 2 and saved[-1].name in left and saved[0].name.endswith("quick-time.wav")


def test_wait_needs_no_state_and_is_bounded(monkeypatch):
    computer = macos.MacComputer()
    monkeypatch.setattr(computer, "resolve_app", lambda query, launch=True: type(
        "App", (), {"processIdentifier": lambda self: 7})())
    assert computer.act("s", "wait", {"app": "Music", "duration": 0.05}) == "waited 0.05s"
    with pytest.raises(macos.ComputerUseError):
        computer.act("s", "wait", {"app": "Music", "duration": 11})
    assert {"hover", "wait"} <= set(tool.ACTING_ACTIONS)


def test_a_recording_reaches_models_that_hear_audio_and_only_them():
    import base64
    from openprogram.programs._execution_common import ToolReturn, _normalize_result
    from openprogram.providers._shared.google import convert_messages
    from openprogram.providers.types import (AssistantMessage, Context, Model, ToolCall, ToolResultMessage,
                                             UserMessage)

    result = _normalize_result(ToolReturn(text="Recorded 1 seconds of Chess.", audio=[b"RIFFwav"]), call_id="c1",
                               max_chars=10_000, persist_full=False, head_ratio=0.5)
    assert [c.type for c in result.content] == ["text", "audio"]
    assert base64.b64decode(result.content[1].data) == b"RIFFwav" and result.content[1].mime_type == "audio/wav"

    def contents(inputs):
        model = Model(id="gemini-2.5-pro", name="g", api="google-generative-ai", provider="google",
                      base_url="", input=inputs)
        calls = [ToolCall(id=f"c{i}", name="computer_use_agent", arguments={}) for i in (1, 2)]
        messages = [UserMessage(content="listen", timestamp=0),
                    AssistantMessage(content=calls, api=model.api, provider=model.provider, model=model.id, timestamp=0),
                    *[ToolResultMessage(tool_call_id=f"c{i}", tool_name="computer_use_agent", content=result.content, timestamp=0)
                      for i in (1, 2)]]
        return convert_messages(model, Context(messages=messages))

    heard = contents(["text", "audio"])
    # Both function responses stay in one turn; the audio follows it.
    assert sum("functionResponse" in p for p in heard[-2]["parts"]) == 2
    assert [p.get("inlineData", {}).get("mimeType") for p in heard[-1]["parts"]] == [None, "audio/wav", None, "audio/wav"]
    deaf = contents(["text", "image"])
    assert not any("inlineData" in p for turn in deaf for p in turn["parts"])


def test_chat_completions_models_see_tool_result_screenshots_and_hear_recordings():
    import base64
    from openprogram.programs._execution_common import ToolReturn, _normalize_result
    from openprogram.providers.openai_completions.openai_completions import _build_messages
    from openprogram.providers.types import (AssistantMessage, Context, ImageContent, Model, TextContent, ToolCall,
                                             ToolResultMessage, UserMessage)

    clip = _normalize_result(ToolReturn(text="Recorded 1 seconds of Chess.", audio=[b"RIFFwav"]), call_id="c1",
                             max_chars=10_000, persist_full=False, head_ratio=0.5).content
    shot = [TextContent(text="Calculator."), ImageContent(data=base64.b64encode(b"png").decode(), mime_type="image/png")]

    def messages(inputs):
        model = Model(id="m", name="m", api="openai-completions", provider="openrouter", base_url="", input=inputs)
        calls = [ToolCall(id=f"c{i}", name="computer_use_agent", arguments={}) for i in (1, 2)]
        return _build_messages(Context(messages=[
            UserMessage(content="look and listen", timestamp=0),
            AssistantMessage(content=calls, api=model.api, provider=model.provider, model=model.id, timestamp=0),
            ToolResultMessage(tool_call_id="c1", tool_name="computer_use_agent", content=clip, timestamp=0),
            ToolResultMessage(tool_call_id="c2", tool_name="computer_use_agent", content=shot, timestamp=0),
            UserMessage(content="next", timestamp=0)]), model)

    both = messages(["text", "image", "audio"])
    # The tool messages stay together after the calls; the media follow as one user turn.
    assert [m["role"] for m in both] == ["user", "assistant", "tool", "tool", "user", "user"]
    assert [p["type"] for p in both[4]["content"]] == ["text", "input_audio", "image_url"]
    assert both[4]["content"][1]["input_audio"]["format"] == "wav"
    assert [p["type"] for p in messages(["text", "image"])[4]["content"]] == ["text", "image_url"]
    assert [m["role"] for m in messages(["text"])] == ["user", "assistant", "tool", "tool", "user"]


# ----------------------------------------------------------------- other Spaces

def _off_space(monkeypatch, insert_result=True):
    computer = macos.MacComputer()
    inserted = []
    monkeypatch.setattr(macos, "_frameworks", lambda: (None, None, None, None))
    monkeypatch.setattr(computer, "_keys_reach", lambda pid, state: False)
    monkeypatch.setattr(computer, "_insert", lambda pid, text: inserted.append(text) or insert_result)
    monkeypatch.setattr(computer, "_focused_element", lambda pid: None)
    monkeypatch.setattr(computer, "_refuse_secure_input", lambda: None)
    monkeypatch.setattr(computer, "_post_chord", lambda *a, **k: pytest.fail("keys posted to another Space"))
    monkeypatch.setattr(computer, "_post_text", lambda *a, **k: pytest.fail("keys posted to another Space"))
    return computer, inserted


def test_keys_for_a_window_on_another_space_become_inserted_text_or_an_error(monkeypatch):
    computer, inserted = _off_space(monkeypatch)
    assert "inserted 5 character(s)" in computer._do_type_text(None, 1, None, {"text": "hello"})
    assert "as plain text" in computer._do_paste(None, 1, None, {"text": "<b>hi</b>", "format": "html"})
    assert inserted == ["hello", "hi"]
    with pytest.raises(base.ComputerUseError, match="another Space"):
        computer._do_press_key(None, 1, None, {"key": "Escape"})
    computer, _ = _off_space(monkeypatch, insert_result=False)
    with pytest.raises(base.ComputerUseError, match="takes no inserted text"):
        computer._do_type_text(None, 1, None, {"text": "x"})


class _Sky:
    available = True

    def __init__(self):
        self.searches = []

    def remote_windows(self, pid, wanted):
        self.searches.append(set(wanted))
        return {wid: f"window {wid}" for wid in wanted if wid != 99}


class _Cg:
    kCGWindowListOptionOnScreenOnly = kCGNullWindowID = 0

    @staticmethod
    def CGWindowListCopyWindowInfo(option, window):  # noqa: N802 - Quartz name
        return [{"kCGWindowNumber": 10}]


class _Ax:
    @staticmethod
    def AXUIElementGetPid(root, _):  # noqa: N802 - HIServices name
        return 0, 7


def test_windows_on_other_spaces_are_found_once_per_set_of_window_ids(monkeypatch):
    computer = macos.MacComputer()
    sky = _Sky()
    rows = [
        {"kCGWindowNumber": 10, "kCGWindowOwnerPID": 7, "kCGWindowLayer": 0, "kCGWindowBounds": {"Width": 500, "Height": 400}},
        {"kCGWindowNumber": 11, "kCGWindowOwnerPID": 7, "kCGWindowLayer": 0, "kCGWindowBounds": {"Width": 500, "Height": 400}},
        {"kCGWindowNumber": 12, "kCGWindowOwnerPID": 7, "kCGWindowLayer": 0, "kCGWindowBounds": {"Width": 1512, "Height": 37}},
        {"kCGWindowNumber": 13, "kCGWindowOwnerPID": 8, "kCGWindowLayer": 0, "kCGWindowBounds": {"Width": 500, "Height": 400}},
    ]
    monkeypatch.setattr(macos, "skylight", lambda: sky)
    monkeypatch.setattr(macos, "_frameworks", lambda: (None, _Ax, _Cg, None))
    monkeypatch.setattr(computer, "_window_rows", lambda: rows)
    monkeypatch.setattr(computer, "_ax_window_id", lambda window: 0)
    # 10 is on screen (listed by AXWindows already), 12 is a menu-bar strip, 13 is another app's.
    assert computer._other_space_windows("root", []) == ["window 11"]
    assert computer._other_space_windows("root", []) == ["window 11"]
    assert sky.searches == [{11}]
    rows.append({"kCGWindowNumber": 99, "kCGWindowOwnerPID": 7, "kCGWindowLayer": 0,
                 "kCGWindowBounds": {"Width": 300, "Height": 200}})
    assert computer._other_space_windows("root", []) == ["window 11"]
    assert sky.searches == [{11}, {11, 99}]


def test_a_step_reports_its_screen_point_for_the_agent_cursor(monkeypatch):
    from types import SimpleNamespace
    import openprogram.native_window_resources as nw
    computer = macos.MacComputer()
    state = macos.WindowState(pid=1, window_title="Calc", window_id=70, has_screenshot=True, scale=2.0,
                              origin=(800.0, 400.0), size=(500, 300))
    app = SimpleNamespace(processIdentifier=lambda: 1, localizedName=lambda: "Calculator")
    points = []
    monkeypatch.setattr(nw, "note_action_point", lambda name, point, action: points.append((name, point, action)))
    monkeypatch.setattr(macos, "CUE_LEAD_SECONDS", 0)
    monkeypatch.setattr(computer, "_onscreen_ids", lambda pid: {70})

    computer._cue(app, state, "click", {"x": 100, "y": 60})
    assert points == [("Calculator", (850.0, 430.0), "click")]

    computer._cue(app, state, "press_key", {"key": "return"})
    assert len(points) == 1, "a step without a target shows no cursor"

    monkeypatch.setattr(computer, "_onscreen_ids", lambda pid: set())
    computer._cue(app, state, "click", {"x": 100, "y": 60})
    assert len(points) == 1, "a window on another Space shows no cursor here"
