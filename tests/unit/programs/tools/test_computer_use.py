"""computer_use: pure logic (key chords, tree rendering, diffs, rules, approval)."""
from __future__ import annotations

import pytest

from openprogram.computer_use import keys
from openprogram.computer_use import macos
from openprogram.computer_use import ocr
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

    assert macos._running_apps(FakeAppKit) == [me]


def test_the_tree_walk_stops_at_a_cycle_back_to_the_app_or_an_element_seen_before(monkeypatch):
    # QuickTime Player with no document lists the application as its window, whose child is itself.
    graph = {"app": ["window", "menubar"], "window": ["button", "app"], "button": ["window"], "menubar": []}
    roles = {"app": "AXApplication", "window": "AXWindow", "button": "AXButton", "menubar": "AXMenuBar"}
    computer = macos.MacComputer()
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
    assert tool.computer_use(action="start_audio_recording", app="Music", max_duration=30).text == "Recording Music"
    assert started == [("Music", 30)] and computer.settled == 0
    assert tool.computer_use(action="stop_audio_recording").is_error  # the approval names the app
    assert tool.requires_approval(action="start_audio_recording", app="Music") == "computer_use controls music"


def test_recordings_are_saved_under_the_state_directory_and_pruned(monkeypatch, tmp_path):
    import openprogram.paths as paths
    monkeypatch.setattr(paths, "get_state_dir", lambda: tmp_path)
    monkeypatch.setattr(macos, "KEEP_RECORDINGS", 2)
    saved = [macos._save_recording("Quick Time", b"x") for _ in range(3)]
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
