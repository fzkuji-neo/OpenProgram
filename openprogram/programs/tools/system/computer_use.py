"""``computer_use``: read and operate application windows in the background.

One tool, one ``action`` parameter, the action set of Codex's macOS
computer use. The model reads an app with ``get_app_state`` (screenshot
plus an indexed Accessibility tree), acts by element index or screenshot
pixel, and gets the changed part of the tree back after every action.

Everything happens in the background: the user's frontmost app, key
window and cursor are not touched. Approval is per application; the
permission rule a grant writes names the app, so one approval covers
every later action in it.
"""
from __future__ import annotations

import platform
import time
from typing import Any

from openprogram.programs._execution_common import ToolReturn
from openprogram.programs._runtime import function

NAME = "computer_use"

ACTIONS = (
    "list_apps", "get_app_state", "click", "type_text", "press_key", "set_value",
    "scroll", "drag", "perform_secondary_action", "select_text", "paste",
)
READ_ONLY_ACTIONS = frozenset({"list_apps"})

DESCRIPTION = """Read and operate macOS application windows in the background (the user keeps the keyboard, mouse and front app).

Start with get_app_state(app) (list_apps shows what is installed and running; get_app_state launches a closed app in the background). It returns a screenshot of the app's window plus its Accessibility tree, one element per line with an index. After every action it returns the lines that changed; pass full=true for the whole tree again.

Prefer element_index over coordinates: element actions reach hidden and covered windows. x,y are pixels of that app's last screenshot and are only for things the tree does not expose (canvases, custom controls). Calling get_app_state again before acting is unnecessary unless the result says an element is stale.

Actions:
- list_apps: running and installed applications.
- get_app_state(app, window?, full?): screenshot and tree; window selects one by title or index.
- click(app, element_index | x,y, mouse_button=left|right|middle, click_count=1..3, key=modifiers such as "cmd" or "shift+alt").
- type_text(app, text, element_index?): types into the focused element (or focuses element_index first). Use set_value to replace a field's whole value, paste for long text.
- press_key(app, key, element_index?, duration?): xdotool names, e.g. "Return", "Escape", "Tab", "super+c", "ctrl+shift+Tab", "KP_0", "F5". "super"/"cmd" is the Command key.
- set_value(app, element_index, value): sets a text field, slider or checkbox value directly.
- scroll(app, element_index | x,y, direction=up|down|left|right, pages=1).
- drag(app, x, y, to_x, to_y).
- perform_secondary_action(app, element_index, action_name): one of the element's listed actions (e.g. AXShowMenu, AXIncrement).
- select_text(app, element_index, text, prefix?, suffix?, selection_type=text|cursor_before|cursor_after): selects text inside a text element, or places the cursor around it.
- paste(app, text, format=text|md|html, element_index?): inserts via the clipboard and restores the clipboard afterwards. Use md for formatted text in rich editors.

Refused: password fields, the Keychain and Passwords apps, system login prompts, and OpenProgram itself. Ask the user to do those steps."""

_PARAMETERS = {
    "type": "object",
    "properties": {
        "action": {"type": "string", "enum": list(ACTIONS), "description": "What to do."},
        "app": {"type": "string", "description": "Application name, bundle id or .app path, as list_apps prints it. Required for every action except list_apps."},
        "element_index": {"type": "integer", "description": "Index of an element in the app's last state."},
        "x": {"type": "number", "description": "Pixel x in the app's last screenshot."},
        "y": {"type": "number", "description": "Pixel y in the app's last screenshot."},
        "to_x": {"type": "number", "description": "drag: destination pixel x."},
        "to_y": {"type": "number", "description": "drag: destination pixel y."},
        "mouse_button": {"type": "string", "enum": ["left", "right", "middle"], "description": "click: which button (default left)."},
        "click_count": {"type": "integer", "minimum": 1, "maximum": 3, "description": "click: 2 for a double click, 3 for triple."},
        "key": {"type": "string", "description": "press_key: the chord. click: modifiers held during the click."},
        "text": {"type": "string", "description": "type_text / paste: the text. select_text: the text to find."},
        "value": {"type": ["string", "number", "boolean"], "description": "set_value: the new value."},
        "direction": {"type": "string", "enum": ["up", "down", "left", "right"], "description": "scroll direction (default down)."},
        "pages": {"type": "number", "description": "scroll: how many pages (default 1, fractions allowed)."},
        "action_name": {"type": "string", "description": "perform_secondary_action: the action to perform."},
        "prefix": {"type": "string", "description": "select_text: text that must precede the match."},
        "suffix": {"type": "string", "description": "select_text: text that must follow the match."},
        "selection_type": {"type": "string", "enum": ["text", "cursor_before", "cursor_after"], "description": "select_text: select the text or place the cursor."},
        "format": {"type": "string", "enum": ["text", "md", "html"], "description": "paste: clipboard format (default text)."},
        "window": {"type": "string", "description": "get_app_state: a window title substring or index when the app has several windows."},
        "full": {"type": "boolean", "description": "get_app_state: return the whole tree instead of the changes."},
        "duration": {"type": "number", "description": "press_key: seconds to hold the key."},
    },
    "required": ["action"],
}


def available() -> bool:
    """Process-level gate: macOS with the PyObjC frameworks installed."""
    if platform.system() != "Darwin":
        return False
    from openprogram.computer_use.macos import support
    return bool(support()["available"])


def normalized_app(app: Any) -> str:
    """The key an approval rule is written for: the app as the model named it, lower-cased."""
    return " ".join(str(app or "").split()).lower()


def requires_approval(action: str = "", app: str = "", **_: Any) -> bool | str:
    """Every action except the read-only listing asks once per application."""
    if str(action or "") in READ_ONLY_ACTIONS:
        return False
    target = normalized_app(app) or "an application"
    return f"computer_use controls {target}"


def _session_id() -> str:
    try:
        from openprogram.agent.run_control import get_current_session_id
        return get_current_session_id() or "default"
    except Exception:
        return "default"


def computer_use(
    action: str,
    app: str = "",
    element_index: int | None = None,
    x: float | None = None,
    y: float | None = None,
    to_x: float | None = None,
    to_y: float | None = None,
    mouse_button: str = "left",
    click_count: int = 1,
    key: str = "",
    text: str = "",
    value: Any = None,
    direction: str = "down",
    pages: float = 1,
    action_name: str = "",
    prefix: str = "",
    suffix: str = "",
    selection_type: str = "text",
    format: str = "text",
    window: str = "",
    full: bool = False,
    duration: float = 0,
) -> ToolReturn:
    """Read and operate macOS application windows in the background."""
    from openprogram.computer_use.macos import SETTLE_SECONDS, ComputerUseError, backend

    action = str(action or "").strip()
    if action not in ACTIONS:
        return ToolReturn(text=f"Error: unknown action {action!r}. Actions: {', '.join(ACTIONS)}.", is_error=True)
    session = _session_id()
    try:
        computer = backend()
        if action == "list_apps":
            return ToolReturn(text=computer.list_apps())
        if action == "get_app_state":
            observation = computer.get_state(session, app, window=window or None, full=bool(full), as_diff=not full)
            return ToolReturn(text=observation.text, images=[observation.image] if observation.image else [])
        args = {
            "app": app, "element_index": element_index, "x": x, "y": y, "to_x": to_x, "to_y": to_y,
            "mouse_button": mouse_button, "click_count": click_count, "key": key, "text": text,
            "value": value, "direction": direction, "pages": pages, "action_name": action_name,
            "prefix": prefix, "suffix": suffix, "selection_type": selection_type, "format": format,
            "duration": duration,
        }
        summary = computer.act(session, action, args)
        time.sleep(SETTLE_SECONDS)
        observation = computer.get_state(session, app, as_diff=True)
        return ToolReturn(text=f"Done: {summary}.\n\n{observation.text}",
                          images=[observation.image] if observation.image else [])
    except ComputerUseError as exc:
        return ToolReturn(text=f"Error: {exc}", is_error=True)


function(
    name=NAME,
    description=DESCRIPTION,
    parameters=_PARAMETERS,
    toolset=["core"],
    unsafe_in=["wechat", "telegram", "plan"],
    requires_approval=requires_approval,
    check_fn=available,
    defer=True,
    timeout=120,
    max_result_chars=60_000,
    path_params={},
    url_params=[],
)(computer_use)

__all__ = ["ACTIONS", "DESCRIPTION", "NAME", "available", "computer_use", "normalized_app", "requires_approval"]
