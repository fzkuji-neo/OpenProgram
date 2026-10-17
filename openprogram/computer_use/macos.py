"""macOS backend for the ``computer_use`` tool.

It reads one application window as a screenshot plus an indexed
Accessibility tree, and acts on it in the background, the way Codex's
macOS computer use does: the user's frontmost app, key window and cursor
are left alone.

* Element actions (press, focus, set value, select text, secondary
  actions, page scrolling) go through the Accessibility API.
* Keyboard input is posted to the application's process.
* Pointer input at a coordinate (clicks, drags, wheel scrolling) is posted
  to the process through SkyLight with the stamps a real gesture carries,
  so the window takes it without being raised. See :mod:`.skylight`.

Coordinates the model gives are pixels of the last screenshot of that
window; they are converted to screen points here.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import importlib.util
import math
import os
from pathlib import Path
import platform
import subprocess
import threading
import time
from typing import Any

from . import keys as keymap
from .skylight import SUBTYPE_DEFAULT, SUBTYPE_TOUCH, skylight
from .tree import Node, TRANSPARENT_ROLES, diff, render, signature


class ComputerUseError(RuntimeError):
    """An action that cannot run; the message is shown to the model."""


# Applications the tool never reads or drives: credential prompts and
# stores, and OpenProgram itself, whose approval cards it must not answer.
REFUSED_BUNDLES = frozenset({
    "com.apple.securityagent", "com.apple.loginwindow", "com.apple.keychainaccess",
    "com.apple.passwords", "ai.openprogram.desktop", "ai.openprogram.runtime",
})

APP_DIRECTORIES = (
    "/Applications", "/Applications/Utilities", "/System/Applications",
    "/System/Applications/Utilities", "/System/Library/CoreServices/Applications",
    str(Path.home() / "Applications"),
)

MAX_NODES = 1500
MAX_DEPTH = 60
MAX_IMAGE_SIDE = 1568
MAX_TEXT_CHARS = 5000
MAX_DRAG_STEPS = 24
SETTLE_SECONDS = 0.45
# Wheel notches per page: ten notches of three lines cover about one window.
TICKS_PER_PAGE = 10
LINES_PER_TICK = 3

_ERROR_TYPE = 5        # kAXValueAXErrorType
_INVALID_ELEMENT = -25202
_SECURE = "AXSecureTextField"
_TEXT_ROLES = frozenset({"AXTextField", "AXTextArea", "AXComboBox", "AXSearchField"})
_SETTABLE_ROLES = _TEXT_ROLES | {"AXSlider", "AXIncrementor", "AXStepper", "AXDateField", "AXColorWell"}
_TOGGLE_ROLES = frozenset({"AXCheckBox", "AXRadioButton", "AXSwitch", "AXToggle"})
_ATTRS = ["AXRole", "AXSubrole", "AXTitle", "AXDescription", "AXValue", "AXPlaceholderValue",
          "AXEnabled", "AXFocused", "AXSelected", "AXExpanded", "AXChildren", "AXHelp"]
_BUTTONS = {"left": 0, "right": 1, "middle": 2}


def support() -> dict[str, Any]:
    """Whether this host can run the backend, without prompting for access."""
    if platform.system() != "Darwin":
        return {"available": False, "reason": "computer_use currently supports macOS only"}
    missing = [name for name in ("AppKit", "ApplicationServices", "Quartz", "ScreenCaptureKit")
               if importlib.util.find_spec(name) is None]
    if missing:
        return {"available": False, "reason": "missing PyObjC frameworks: " + ", ".join(missing)}
    return {"available": True, "reason": ""}


def _check_cancelled() -> None:
    try:
        from openprogram.agent.run_control import check_cancelled
    except ImportError:
        return
    check_cancelled()


class _Frameworks:
    _lock = threading.Lock()
    _loaded = None

    @classmethod
    def get(cls):
        with cls._lock:
            if cls._loaded is None:
                import AppKit
                import ApplicationServices
                import Quartz
                import ScreenCaptureKit
                # A headless worker needs its WindowServer connection before
                # an asynchronous capture. This activates nothing.
                AppKit.NSApplication.sharedApplication()
                cls._loaded = (AppKit, ApplicationServices, Quartz, ScreenCaptureKit)
            return cls._loaded


def _frameworks():
    state = support()
    if not state["available"]:
        raise ComputerUseError(state["reason"])
    appkit, ax, cg, sc = _Frameworks.get()
    if not ax.AXIsProcessTrusted():
        raise ComputerUseError(
            "OpenProgram does not have Accessibility access. Grant it in System Settings > "
            "Privacy & Security > Accessibility, then try again.")
    return appkit, ax, cg, sc


def _frameworks_cached():
    return _Frameworks.get()


@dataclass
class WindowState:
    """What the model last saw of one application window."""
    pid: int
    window_title: str
    window_id: int = 0
    elements: list[Any] = field(default_factory=list)
    nodes: list[Node] = field(default_factory=list)
    signature: list[str] | None = None
    origin: tuple[float, float] = (0.0, 0.0)
    size: tuple[float, float] = (0.0, 0.0)
    scale: float = 1.0           # screenshot pixels per screen point
    has_screenshot: bool = False


@dataclass
class Observation:
    text: str
    image: bytes | None
    app: str


class MacComputer:
    """One backend per worker; state is kept per (session, pid)."""

    def __init__(self) -> None:
        self._states: dict[tuple[str, int], WindowState] = {}
        self._lock = threading.RLock()

    # ------------------------------------------------------------------ AX helpers
    def _attr(self, element, name):
        _, ax, _, _ = _frameworks_cached()
        code, value = ax.AXUIElementCopyAttributeValue(element, name, None)
        return value if code == 0 else None

    def _attrs(self, element, names):
        _, ax, _, _ = _frameworks_cached()
        code, values = ax.AXUIElementCopyMultipleAttributeValues(element, names, 0, None)
        if code != 0 or values is None:
            return {}
        out = {}
        for name, value in zip(names, values):
            if type(value).__name__ == "AXValueRef" and ax.AXValueGetType(value) == _ERROR_TYPE:
                continue
            out[name] = value
        return out

    def _actions(self, element) -> list[str]:
        _, ax, _, _ = _frameworks_cached()
        code, names = ax.AXUIElementCopyActionNames(element, None)
        return [str(n) for n in names or []] if code == 0 else []

    def _settable(self, element, name) -> bool:
        _, ax, _, _ = _frameworks_cached()
        code, value = ax.AXUIElementIsAttributeSettable(element, name, None)
        return code == 0 and bool(value)

    def _frame(self, element) -> tuple[float, float, float, float] | None:
        _, ax, _, _ = _frameworks_cached()
        values = self._attrs(element, ["AXPosition", "AXSize"])
        if "AXPosition" not in values or "AXSize" not in values:
            return None
        ok1, point = ax.AXValueGetValue(values["AXPosition"], ax.kAXValueCGPointType, None)
        ok2, size = ax.AXValueGetValue(values["AXSize"], ax.kAXValueCGSizeType, None)
        if not ok1 or not ok2:
            return None
        return float(point.x), float(point.y), float(size.width), float(size.height)

    def _set(self, element, name, value) -> int:
        _, ax, _, _ = _frameworks_cached()
        return ax.AXUIElementSetAttributeValue(element, name, value)

    def _perform(self, element, action) -> int:
        _, ax, _, _ = _frameworks_cached()
        return ax.AXUIElementPerformAction(element, action)

    # ------------------------------------------------------------------ apps
    def _window_rows(self) -> list[dict]:
        _, _, cg, _ = _frameworks()
        return list(cg.CGWindowListCopyWindowInfo(
            cg.kCGWindowListOptionAll | cg.kCGWindowListExcludeDesktopElements, cg.kCGNullWindowID) or [])

    def _app_rows(self) -> list[dict[str, Any]]:
        appkit, _, _, _ = _frameworks()
        windows: dict[int, int] = {}
        for row in self._window_rows():
            if row.get("kCGWindowLayer") == 0 and row.get("kCGWindowAlpha", 1) > 0:
                pid = int(row.get("kCGWindowOwnerPID", -1))
                windows[pid] = windows.get(pid, 0) + 1
        running = []
        for app in appkit.NSWorkspace.sharedWorkspace().runningApplications():
            if app.activationPolicy() != appkit.NSApplicationActivationPolicyRegular:
                continue
            bundle = str(app.bundleIdentifier() or "")
            running.append({
                "name": str(app.localizedName() or ""), "bundle_id": bundle,
                "pid": int(app.processIdentifier()), "active": bool(app.isActive()),
                "hidden": bool(app.isHidden()), "windows": windows.get(int(app.processIdentifier()), 0),
                "path": str(app.bundleURL().path()) if app.bundleURL() else "",
                "refused": bundle.lower() in REFUSED_BUNDLES,
            })
        return running

    def _installed(self) -> list[dict[str, str]]:
        appkit, _, _, _ = _frameworks()
        manager = appkit.NSFileManager.defaultManager()
        seen, rows = set(), []
        for directory in APP_DIRECTORIES:
            try:
                names = sorted(os.listdir(directory))
            except OSError:
                continue
            for name in names:
                if not name.endswith(".app"):
                    continue
                path = os.path.join(directory, name)
                bundle = appkit.NSBundle.bundleWithPath_(path)
                bundle_id = str(bundle.bundleIdentifier() or "") if bundle else ""
                if not bundle_id or bundle_id.lower() in seen:
                    continue
                seen.add(bundle_id.lower())
                display = str(manager.displayNameAtPath_(path) or name)
                if display.endswith(".app"):
                    display = display[:-4]
                rows.append({"name": name[:-4], "display_name": display, "bundle_id": bundle_id, "path": path})
        return rows

    def list_apps(self) -> str:
        running = self._app_rows()
        running_ids = {row["bundle_id"].lower() for row in running}
        lines = ["Running applications:"]
        for row in sorted(running, key=lambda r: (not r["active"], r["name"].lower())):
            state = []
            if row["active"]:
                state.append("frontmost")
            if row["hidden"]:
                state.append("hidden")
            state.append(f"{row['windows']} window" + ("" if row["windows"] == 1 else "s"))
            if row["refused"]:
                state.append("not controllable")
            lines.append(f"- {row['name']} ({row['bundle_id'] or 'no bundle id'}, pid {row['pid']}; {', '.join(state)})")
        installed = [row for row in self._installed() if row["bundle_id"].lower() not in running_ids
                     and row["bundle_id"].lower() not in REFUSED_BUNDLES]
        if installed:
            lines.append("")
            lines.append("Installed, not running (get_app_state launches them in the background):")
            for row in installed:
                label = row["display_name"] if row["display_name"] == row["name"] else f"{row['display_name']} / {row['name']}"
                lines.append(f"- {label} ({row['bundle_id']})")
        return "\n".join(lines)

    def _running_match(self, query: str):
        appkit, _, _, _ = _frameworks()
        q = query.strip().lower()
        pid = int(q[4:]) if q.startswith("pid:") and q[4:].isdigit() else None
        for app in appkit.NSWorkspace.sharedWorkspace().runningApplications():
            if app.isTerminated():
                continue
            if pid is not None:
                if int(app.processIdentifier()) == pid:
                    return app
                continue
            names = {str(app.bundleIdentifier() or "").lower(), str(app.localizedName() or "").lower()}
            url = app.bundleURL()
            if url is not None:
                path = str(url.path())
                names.update({path.lower(), Path(path).stem.lower()})
            if q in names:
                return app
        return None

    def resolve_app(self, query: str, *, launch: bool = True):
        """The running application for ``query``, launched in the background if needed."""
        if not isinstance(query, str) or not query.strip():
            raise ComputerUseError("app is required: a name, bundle id or .app path from list_apps")
        app = self._running_match(query)
        if app is None:
            # A refused app says so whether or not it is running.
            target = self._installed_match(query)
            if target is not None:
                self._refuse(target["bundle_id"], target["display_name"])
            if not launch:
                raise ComputerUseError(f"{query!r} is not running")
            if target is None:
                raise ComputerUseError(f"No application matches {query!r}. Call list_apps to see what is available.")
            subprocess.run(["/usr/bin/open", "-g", "-b", target["bundle_id"]], check=False,
                           capture_output=True, timeout=20)
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                _check_cancelled()
                app = self._running_match(target["bundle_id"])
                if app is not None and app.isFinishedLaunching():
                    break
                time.sleep(0.2)
            if app is None:
                raise ComputerUseError(f"{target['display_name']} did not start")
            self._wait_for_window(int(app.processIdentifier()), 5)
        self._refuse(str(app.bundleIdentifier() or ""), str(app.localizedName() or ""))
        return app

    def _installed_match(self, query: str) -> dict[str, str] | None:
        q = query.strip().lower()
        if q.endswith(".app") and os.path.isdir(query):
            appkit, _, _, _ = _frameworks()
            bundle = appkit.NSBundle.bundleWithPath_(query)
            if bundle and bundle.bundleIdentifier():
                return {"bundle_id": str(bundle.bundleIdentifier()), "display_name": Path(query).stem, "path": query}
        for row in self._installed():
            if q in {row["bundle_id"].lower(), row["name"].lower(), row["display_name"].lower(), row["path"].lower()}:
                return row
        return None

    def _refuse(self, bundle_id: str, name: str) -> None:
        if bundle_id.lower() in REFUSED_BUNDLES:
            raise ComputerUseError(f"{name or bundle_id} cannot be controlled with computer_use.")

    def _wait_for_window(self, pid: int, seconds: float) -> None:
        _, ax, _, _ = _frameworks()
        root = ax.AXUIElementCreateApplication(pid)
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if self._attr(root, "AXWindows"):
                return
            time.sleep(0.15)

    # ------------------------------------------------------------------ windows
    def _windows(self, root) -> list[Any]:
        return list(self._attr(root, "AXWindows") or [])

    def _pick_window(self, root, which):
        windows = self._windows(root)
        if which not in (None, ""):
            if isinstance(which, int) or (isinstance(which, str) and which.strip().isdigit()):
                index = int(which)
                if 0 <= index < len(windows):
                    return windows[index]
                raise ComputerUseError(f"window {index} does not exist; the app has {len(windows)} window(s)")
            needle = str(which).strip().lower()
            for window in windows:
                if needle in str(self._attr(window, "AXTitle") or "").lower():
                    return window
            raise ComputerUseError(f"no window title contains {which!r}")
        for name in ("AXFocusedWindow", "AXMainWindow"):
            window = self._attr(root, name)
            if window is not None:
                return window
        return windows[0] if windows else None

    def _window_id(self, window, pid: int, frame) -> int:
        """The window server's id for an Accessibility window."""
        wid = skylight().window_id(window) if skylight().available else None
        if wid:
            return wid
        if frame is None:
            return 0
        x, y, width, height = frame
        for row in self._window_rows():
            if int(row.get("kCGWindowOwnerPID", -1)) != pid or row.get("kCGWindowLayer") != 0:
                continue
            bounds = row.get("kCGWindowBounds") or {}
            if (abs(float(bounds.get("X", 0)) - x) < 3 and abs(float(bounds.get("Y", 0)) - y) < 3
                    and abs(float(bounds.get("Width", 0)) - width) < 3 and abs(float(bounds.get("Height", 0)) - height) < 3):
                return int(row.get("kCGWindowNumber", 0))
        return 0

    # ------------------------------------------------------------------ tree
    def _node(self, element, depth: int):
        values = self._attrs(element, _ATTRS)
        role = str(values.get("AXRole") or "AXUnknown")
        subrole = str(values.get("AXSubrole") or "")
        label = values.get("AXTitle") or values.get("AXDescription") or ""
        label = str(label) if isinstance(label, str) else ""
        help_text = values.get("AXHelp")
        if not label and isinstance(help_text, str):
            label = help_text
        raw_value = values.get("AXValue")
        value = ""
        flags: list[str] = []
        secure = role == _SECURE or subrole == _SECURE
        if secure:
            flags.append("secure")
        elif role in _TOGGLE_ROLES and (isinstance(raw_value, (int, float, bool))
                                        or str(raw_value).strip().lower() in ("0", "1", "true", "false")):
            on = raw_value if isinstance(raw_value, (int, float, bool)) else str(raw_value).strip().lower() in ("1", "true")
            flags.append("checked" if on else "unchecked")
        elif isinstance(raw_value, str):
            value = raw_value
        elif isinstance(raw_value, (int, float)) and not isinstance(raw_value, bool):
            value = f"{raw_value:g}" if isinstance(raw_value, float) else str(raw_value)
        if values.get("AXEnabled") is False:
            flags.append("disabled")
        if values.get("AXFocused") is True:
            flags.append("focused")
        if values.get("AXSelected") is True:
            flags.append("selected")
        if values.get("AXExpanded") is True:
            flags.append("expanded")
        if role in _SETTABLE_ROLES and not secure and self._settable(element, "AXValue"):
            flags.append("settable")
        placeholder = values.get("AXPlaceholderValue")
        node = Node(role=role, subrole=subrole, depth=depth, label=label, value=value,
                    placeholder=str(placeholder) if isinstance(placeholder, str) else "",
                    flags=flags, actions=self._actions(element))
        children = values.get("AXChildren") or []
        return node, list(children)

    def _walk(self, roots: list[tuple[Any, int]], nodes, elements, budget: list[int], *, menus_open_only=False):
        stack = list(reversed(roots))
        while stack:
            _check_cancelled()
            if budget[0] <= 0:
                return False
            element, depth = stack.pop()
            node, children = self._node(element, depth)
            transparent = (node.role in TRANSPARENT_ROLES and not node.label and not node.value
                           and not [a for a in node.actions if a not in ("AXScrollToVisible", "AXShowMenu")])
            child_depth = depth
            if not transparent:
                node.index = len(nodes)
                nodes.append(node)
                elements.append(element)
                budget[0] -= 1
                child_depth = depth + 1
            if child_depth > MAX_DEPTH:
                continue
            if menus_open_only and node.role == "AXMenuBarItem" and "selected" not in node.flags:
                continue
            stack.extend((child, child_depth) for child in reversed(children))
        return True

    def _read_tree(self, root, window, full: bool):
        nodes: list[Node] = []
        elements: list[Any] = []
        budget = [MAX_NODES]
        complete = True
        if window is not None:
            complete = self._walk([(window, 0)], nodes, elements, budget)
        # Menus and popovers opened by the app sit beside its windows.
        for child in self._attr(root, "AXChildren") or []:
            role = str(self._attr(child, "AXRole") or "")
            if role in ("AXMenu", "AXPopover") or (
                    role == "AXWindow" and child != window
                    and self._attr(child, "AXSubrole") in ("AXFloatingWindow", "AXSystemDialog", "AXDialog")):
                complete = self._walk([(child, 0)], nodes, elements, budget) and complete
        menubar = self._attr(root, "AXMenuBar")
        if menubar is not None and budget[0] > 0:
            complete = self._walk([(menubar, 0)], nodes, elements, budget, menus_open_only=not full) and complete
        return nodes, elements, complete

    # ------------------------------------------------------------------ screenshot
    def _capture(self, pid: int, frame) -> tuple[bytes | None, float]:
        appkit, _, _, sc = _frameworks()
        x, y, width, height = frame
        content = _await(lambda cb: sc.SCShareableContent
                         .getShareableContentExcludingDesktopWindows_onScreenWindowsOnly_completionHandler_(True, False, cb))
        match = None
        for window in content.windows():
            owner = window.owningApplication()
            if owner is None or int(owner.processID()) != pid or window.windowLayer() != 0:
                continue
            f = window.frame()
            if max(abs(f.origin.x - x), abs(f.origin.y - y), abs(f.size.width - width), abs(f.size.height - height)) < 3:
                match = window
                break
        if match is None:
            return None, 1.0
        backing = 2.0
        for screen in appkit.NSScreen.screens() or []:
            backing = max(1.0, float(screen.backingScaleFactor()))
            break
        scale = min(backing, MAX_IMAGE_SIDE / max(width, height, 1))
        config = sc.SCStreamConfiguration.alloc().init()
        config.setWidth_(max(1, int(round(width * scale))))
        config.setHeight_(max(1, int(round(height * scale))))
        config.setShowsCursor_(False)
        content_filter = sc.SCContentFilter.alloc().initWithDesktopIndependentWindow_(match)
        image = _await(lambda cb: sc.SCScreenshotManager
                       .captureImageWithFilter_configuration_completionHandler_(content_filter, config, cb))
        bitmap = appkit.NSBitmapImageRep.alloc().initWithCGImage_(image)
        data = bitmap.representationUsingType_properties_(appkit.NSBitmapImageFileTypePNG, {})
        return bytes(data), float(config.width()) / width if width else scale

    # ------------------------------------------------------------------ state
    def get_state(self, session: str, query: str, *, window=None, full=False, as_diff=True) -> Observation:
        with self._lock:
            _, ax, _, _ = _frameworks()
            app = self.resolve_app(query)
            pid = int(app.processIdentifier())
            root = ax.AXUIElementCreateApplication(pid)
            ax.AXUIElementSetMessagingTimeout(root, 3.0)
            target = self._pick_window(root, window)
            frame = self._frame(target) if target is not None else None
            title = str(self._attr(target, "AXTitle") or "") if target is not None else ""
            minimized = bool(self._attr(target, "AXMinimized")) if target is not None else False
            nodes, elements, complete = self._read_tree(root, target, full)
            image, scale = (None, 1.0)
            if frame is not None and frame[2] > 1 and frame[3] > 1 and not minimized:
                image, scale = self._capture(pid, frame)
            key = (session, pid)
            previous = self._states.get(key)
            prior = previous.signature if (as_diff and previous and previous.window_title == title) else None
            body, is_diff = diff(prior, nodes)
            self._states[key] = WindowState(
                pid=pid, window_title=title, window_id=self._window_id(target, pid, frame) if target is not None else 0,
                elements=elements, nodes=nodes, signature=signature(nodes),
                origin=(frame[0], frame[1]) if frame else (0.0, 0.0),
                size=(frame[2], frame[3]) if frame else (0.0, 0.0), scale=scale, has_screenshot=image is not None)
            name = str(app.localizedName() or query)
            lines = [f"App: {name} ({app.bundleIdentifier() or 'no bundle id'}, pid {pid})"
                     + ("" if app.isActive() else ", in the background")]
            if target is None:
                lines.append("Window: none open. The tree lists the menu bar only.")
            else:
                note = " (minimized)" if minimized else ""
                lines.append(f'Window: "{title}"{note}, {int(frame[2])}x{int(frame[3])} points' if frame else f'Window: "{title}"')
                if image is not None:
                    w, h = int(round(frame[2] * scale)), int(round(frame[3] * scale))
                    lines.append(f"Screenshot: {w}x{h} pixels; x,y coordinates in actions are pixels of this screenshot.")
                else:
                    lines.append("Screenshot: unavailable for this window (off screen, minimized, or on another Space). Use element indices.")
            others = [str(self._attr(w, "AXTitle") or "") for w in self._windows(root) if w != target]
            if others:
                lines.append("Other windows: " + "; ".join(f'"{t}"' if t else "(untitled)" for t in others[:8])
                             + ". Pass window=<title> to read one.")
            if not complete:
                lines.append(f"The tree was cut at {MAX_NODES} elements.")
            lines.append("")
            lines.append("Accessibility tree changes since the last state:" if is_diff else "Accessibility tree:")
            lines.append(body or "(empty)")
            return Observation(text="\n".join(lines), image=image, app=name)

    def _state_for(self, session: str, query: str) -> tuple[Any, WindowState]:
        app = self.resolve_app(query, launch=False)
        state = self._states.get((session, int(app.processIdentifier())))
        if state is None:
            raise ComputerUseError(f"Call get_app_state for {query!r} first; actions use its element indices and screenshot.")
        return app, state

    def _element(self, state: WindowState, index) -> Any:
        if index is None or isinstance(index, bool):
            raise ComputerUseError("element_index is required")
        try:
            index = int(index)
        except (TypeError, ValueError) as exc:
            raise ComputerUseError("element_index must be an integer") from exc
        if not 0 <= index < len(state.elements):
            raise ComputerUseError(f"element_index {index} is not in the last state (0-{len(state.elements) - 1}).")
        element = state.elements[index]
        _, ax, _, _ = _frameworks()
        code, _ = ax.AXUIElementCopyAttributeValue(element, "AXRole", None)
        if code == _INVALID_ELEMENT:
            raise ComputerUseError(f"element {index} no longer exists. Call get_app_state for a fresh tree.")
        return element

    def _node_at(self, state: WindowState, index) -> Node:
        return state.nodes[int(index)]

    def _point(self, state: WindowState, x, y) -> tuple[float, float]:
        if x is None or y is None:
            raise ComputerUseError("x and y are required when no element_index is given")
        if not state.has_screenshot:
            raise ComputerUseError("This window has no screenshot to take coordinates from; use element_index.")
        try:
            px, py = float(x), float(y)
        except (TypeError, ValueError) as exc:
            raise ComputerUseError("x and y must be numbers") from exc
        width, height = state.size[0] * state.scale, state.size[1] * state.scale
        if not (math.isfinite(px) and math.isfinite(py) and 0 <= px <= width and 0 <= py <= height):
            raise ComputerUseError(f"({x}, {y}) is outside the {int(width)}x{int(height)} screenshot")
        return state.origin[0] + px / state.scale, state.origin[1] + py / state.scale

    def _center(self, element) -> tuple[float, float]:
        frame = self._frame(element)
        if frame is None or frame[2] <= 0 or frame[3] <= 0:
            raise ComputerUseError("This element has no on-screen frame to point at.")
        return frame[0] + frame[2] / 2, frame[1] + frame[3] / 2

    # ------------------------------------------------------------------ pointer (background)
    def _route(self, state: WindowState):
        """The SkyLight route for this window, or an explanation of why not."""
        sky = skylight()
        if not sky.available:
            raise ComputerUseError("Background pointer input is unavailable on this macOS; use element_index actions.")
        if not state.window_id:
            raise ComputerUseError("The window has no window-server id to route pointer input to; use element_index actions.")
        return sky

    def _mouse_event(self, cg, kind, point, button_code, flags=0):
        source = cg.CGEventSourceCreate(cg.kCGEventSourceStateHIDSystemState)
        event = cg.CGEventCreateMouseEvent(source, kind, point, button_code)
        if flags:
            cg.CGEventSetFlags(event, flags)
        return event

    def _post_mouse(self, sky, cg, state, pid, event, point, *, click_state, button, subtype, group):
        sky.stamp_mouse(event, pid=pid, window_id=state.window_id, click_state=click_state, button=button,
                        subtype=subtype, group=group, location=point)
        sky.post(pid, event)

    def _primer(self, sky, cg, state, pid, point, group) -> None:
        """A mouseMoved at the point first: AppKit hit-tests against the last tracked position."""
        move = self._mouse_event(cg, cg.kCGEventMouseMoved, point, cg.kCGMouseButtonLeft)
        self._post_mouse(sky, cg, state, pid, move, point, click_state=0, button=0, subtype=SUBTYPE_TOUCH, group=group)
        time.sleep(0.012)

    def _with_modifiers(self, pid: int, flags: int, body) -> None:
        """Hold modifier keys in the target process around a pointer gesture."""
        held = []
        try:
            for flag, code in keymap.MODIFIER_KEYCODES.items():
                if flags & flag:
                    self._post_key_event(pid, code, True, flags)
                    held.append(code)
                    time.sleep(0.008)
            body()
        finally:
            for code in reversed(held):
                self._post_key_event(pid, code, False, 0)
                time.sleep(0.008)

    def _background_click(self, state: WindowState, pid: int, point, button: str, count: int, flags: int) -> None:
        sky = self._route(state)
        _, _, cg, _ = _frameworks()
        kinds = {
            "left": (cg.kCGEventLeftMouseDown, cg.kCGEventLeftMouseUp, cg.kCGMouseButtonLeft),
            "right": (cg.kCGEventRightMouseDown, cg.kCGEventRightMouseUp, cg.kCGMouseButtonRight),
            "middle": (cg.kCGEventOtherMouseDown, cg.kCGEventOtherMouseUp, cg.kCGMouseButtonCenter),
        }
        down, up, code = kinds[button]
        number = _BUTTONS[button]
        sky.focus_without_raise(pid, state.window_id)
        time.sleep(0.05)
        group = sky.next_group()

        def gesture():
            self._primer(sky, cg, state, pid, point, group)
            for click in range(1, count + 1):
                event = self._mouse_event(cg, down, point, code, flags)
                self._post_mouse(sky, cg, state, pid, event, point, click_state=click, button=number,
                                 subtype=SUBTYPE_TOUCH, group=group)
                # An NSButton's mouseDown enters a tracking loop that polls for
                # the mouseUp; too tight a gap and the click is dropped.
                time.sleep(0.028)
                event = self._mouse_event(cg, up, point, code, flags)
                self._post_mouse(sky, cg, state, pid, event, point, click_state=click, button=number,
                                 subtype=SUBTYPE_TOUCH, group=group)
                if count > 1:
                    time.sleep(0.08)

        self._with_modifiers(pid, flags, gesture)

    def _background_drag(self, state: WindowState, pid: int, start, end) -> None:
        sky = self._route(state)
        _, _, cg, _ = _frameworks()
        left = cg.kCGMouseButtonLeft
        sky.focus_without_raise(pid, state.window_id)
        time.sleep(0.05)
        group = sky.next_group()
        self._primer(sky, cg, state, pid, start, group)
        event = self._mouse_event(cg, cg.kCGEventLeftMouseDown, start, left)
        self._post_mouse(sky, cg, state, pid, event, start, click_state=1, button=0, subtype=SUBTYPE_DEFAULT, group=group)
        time.sleep(0.12)
        distance = math.hypot(end[0] - start[0], end[1] - start[1])
        steps = max(2, min(MAX_DRAG_STEPS, int(distance / 12) + 1))
        for step in range(1, steps + 1):
            t = step / steps
            point = (start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t)
            event = self._mouse_event(cg, cg.kCGEventLeftMouseDragged, point, left)
            self._post_mouse(sky, cg, state, pid, event, point, click_state=1, button=0, subtype=SUBTYPE_DEFAULT, group=group)
            time.sleep(0.016)
        time.sleep(0.08)
        event = self._mouse_event(cg, cg.kCGEventLeftMouseUp, end, left)
        self._post_mouse(sky, cg, state, pid, event, end, click_state=1, button=0, subtype=SUBTYPE_DEFAULT, group=group)

    def _background_scroll(self, state: WindowState, pid: int, point, direction: str, pages: float) -> None:
        sky = self._route(state)
        _, _, cg, _ = _frameworks()
        ticks = max(1, int(round(pages * TICKS_PER_PAGE)))
        # macOS: a positive vertical delta reveals content above.
        dy = {"up": LINES_PER_TICK, "down": -LINES_PER_TICK}.get(direction, 0)
        dx = {"left": LINES_PER_TICK, "right": -LINES_PER_TICK}.get(direction, 0)
        group = sky.next_group()
        self._primer(sky, cg, state, pid, point, group)
        for _ in range(ticks):
            _check_cancelled()
            source = cg.CGEventSourceCreate(cg.kCGEventSourceStateHIDSystemState)
            event = cg.CGEventCreateScrollWheelEvent(source, cg.kCGScrollEventUnitLine, 2, dy, dx)
            cg.CGEventSetLocation(event, point)
            self._post_mouse(sky, cg, state, pid, event, point, click_state=0, button=0, subtype=SUBTYPE_DEFAULT, group=group)
            time.sleep(0.03)

    # ------------------------------------------------------------------ keyboard (background)
    def _post_key_event(self, pid: int, keycode: int, down: bool, flags: int, text: str = "") -> None:
        _, _, cg, _ = _frameworks()
        source = cg.CGEventSourceCreate(cg.kCGEventSourceStateHIDSystemState)
        event = cg.CGEventCreateKeyboardEvent(source, keycode, down)
        cg.CGEventSetFlags(event, flags)
        if text:
            cg.CGEventKeyboardSetUnicodeString(event, len(text.encode("utf-16-le")) // 2, text)
        sky = skylight()
        if sky.available:
            sky.post(pid, event, keyboard=True)
        else:
            cg.CGEventPostToPid(pid, event)

    def _post_chord(self, pid: int, chord: keymap.Chord, duration: float = 0.0) -> None:
        flags = 0
        for flag, code in keymap.MODIFIER_KEYCODES.items():
            if chord.flags & flag and code != chord.keycode:
                flags |= flag
                self._post_key_event(pid, code, True, flags)
                time.sleep(0.008)
        self._post_key_event(pid, chord.keycode, True, chord.flags)
        time.sleep(max(0.012, min(float(duration or 0), 10.0)))
        self._post_key_event(pid, chord.keycode, False, chord.flags)
        for flag, code in reversed(list(keymap.MODIFIER_KEYCODES.items())):
            if chord.flags & flag and code != chord.keycode:
                flags &= ~flag
                self._post_key_event(pid, code, False, flags)
                time.sleep(0.008)

    def _post_text(self, pid: int, text: str) -> None:
        for index, char in enumerate(text):
            if index % 40 == 0:
                _check_cancelled()
            if char == "\n":
                self._post_chord(pid, keymap.Chord(36, 0))
                continue
            if char == "\t":
                self._post_chord(pid, keymap.Chord(48, 0))
                continue
            self._post_key_event(pid, 0, True, 0, char)
            self._post_key_event(pid, 0, False, 0, char)
            time.sleep(0.004)

    def _refuse_secure_input(self) -> None:
        """Secure keyboard entry means a password field has focus somewhere."""
        _, _, cg, _ = _frameworks()
        info = cg.CGSessionCopyCurrentDictionary() or {}
        if info.get("kCGSSessionSecureInputPID"):
            raise ComputerUseError("Secure keyboard entry is active (a password field is focused somewhere on this Mac); "
                                   "typing is refused until it closes.")

    # ------------------------------------------------------------------ text helpers
    def _focus(self, element) -> None:
        if self._settable(element, "AXFocused"):
            self._set(element, "AXFocused", True)
            time.sleep(0.08)

    def _refuse_secure(self, node: Node | None, element=None) -> None:
        if node is not None and "secure" in node.flags:
            raise ComputerUseError("This is a password field. computer_use does not type into password fields; ask the user to fill it.")
        if element is not None:
            role = str(self._attr(element, "AXRole") or "")
            subrole = str(self._attr(element, "AXSubrole") or "")
            if _SECURE in (role, subrole):
                raise ComputerUseError("The focused field is a password field. computer_use does not type into it; ask the user to fill it.")

    def _focused_element(self, pid: int):
        _, ax, _, _ = _frameworks()
        return self._attr(ax.AXUIElementCreateApplication(pid), "AXFocusedUIElement")

    # ------------------------------------------------------------------ actions
    def act(self, session: str, action: str, args: dict[str, Any]) -> str:
        """Run one action and return a short description of what happened."""
        with self._lock:
            app, state = self._state_for(session, args.get("app") or "")
            pid = int(app.processIdentifier())
            handler = getattr(self, f"_do_{action}", None)
            if handler is None:
                raise ComputerUseError(f"unknown action {action!r}")
            return handler(app, pid, state, args)

    def _do_click(self, app, pid, state, args) -> str:
        button = str(args.get("mouse_button") or "left").lower()
        button = {"l": "left", "r": "right", "m": "middle"}.get(button, button)
        if button not in _BUTTONS:
            raise ComputerUseError("mouse_button must be left, right or middle")
        try:
            count = int(args.get("click_count") or 1)
        except (TypeError, ValueError) as exc:
            raise ComputerUseError("click_count must be 1, 2 or 3") from exc
        if not 1 <= count <= 3:
            raise ComputerUseError("click_count must be 1, 2 or 3")
        flags = keymap.modifier_flags(args.get("key"))
        index = args.get("element_index")
        if index is not None:
            element = self._element(state, index)
            node = self._node_at(state, index)
            actions = self._actions(element)
            simple = count == 1 and not flags
            if simple and button == "left":
                for action in ("AXPress", "AXConfirm", "AXPick"):
                    if action in actions and self._perform(element, action) == 0:
                        return f"pressed {node.body()}"
                if node.role in ("AXRow", "AXOutlineRow", "AXCell") and self._settable(element, "AXSelected"):
                    if self._set(element, "AXSelected", True) == 0:
                        return f"selected {node.body()}"
                if node.role in _TEXT_ROLES and self._settable(element, "AXFocused"):
                    if self._set(element, "AXFocused", True) == 0:
                        return f"focused {node.body()}"
            if simple and button == "right" and "AXShowMenu" in actions:
                if self._perform(element, "AXShowMenu") == 0:
                    return f"opened the context menu of {node.body()}"
            self._background_click(state, pid, self._center(element), button, count, flags)
            return f"{_click_words(button, count)} {node.body()}"
        point = self._point(state, args.get("x"), args.get("y"))
        self._background_click(state, pid, point, button, count, flags)
        return f"{_click_words(button, count)} at ({args.get('x')}, {args.get('y')})"

    def _do_drag(self, app, pid, state, args) -> str:
        start = self._point(state, args.get("x"), args.get("y"))
        end = self._point(state, args.get("to_x"), args.get("to_y"))
        self._background_drag(state, pid, start, end)
        return f"dragged from ({args.get('x')}, {args.get('y')}) to ({args.get('to_x')}, {args.get('to_y')})"

    def _do_scroll(self, app, pid, state, args) -> str:
        direction = str(args.get("direction") or "down").lower()
        direction = {"u": "up", "d": "down", "l": "left", "r": "right"}.get(direction, direction)
        if direction not in ("up", "down", "left", "right"):
            raise ComputerUseError("direction must be up, down, left or right")
        try:
            pages = float(args.get("pages") or 1)
        except (TypeError, ValueError) as exc:
            raise ComputerUseError("pages must be a number between 0 and 20") from exc
        if not 0 < pages <= 20:
            raise ComputerUseError("pages must be between 0 and 20")
        index = args.get("element_index")
        if index is not None:
            element = self._element(state, index)
            node = self._node_at(state, index)
            action = {"up": "AXScrollUpByPage", "down": "AXScrollDownByPage",
                      "left": "AXScrollLeftByPage", "right": "AXScrollRightByPage"}[direction]
            target = element
            for _ in range(12):
                if target is None:
                    break
                if action in self._actions(target):
                    for _ in range(max(1, int(round(pages)))):
                        self._perform(target, action)
                        time.sleep(0.05)
                    return f"scrolled {direction} {pages:g} page(s) in {node.body()}"
                bar = self._attr(target, "AXVerticalScrollBar" if direction in ("up", "down") else "AXHorizontalScrollBar")
                if bar is not None and self._settable(bar, "AXValue"):
                    current = self._attr(bar, "AXValue")
                    if isinstance(current, (int, float)):
                        step = self._page_fraction(target, direction) * pages
                        sign = -1 if direction in ("up", "left") else 1
                        self._set(bar, "AXValue", max(0.0, min(1.0, float(current) + sign * step)))
                        return f"scrolled {direction} {pages:g} page(s) in {node.body()}"
                target = self._attr(target, "AXParent")
            self._background_scroll(state, pid, self._center(element), direction, pages)
            return f"scrolled {direction} {pages:g} page(s) over {node.body()}"
        point = self._point(state, args.get("x"), args.get("y"))
        self._background_scroll(state, pid, point, direction, pages)
        return f"scrolled {direction} {pages:g} page(s) at ({args.get('x')}, {args.get('y')})"

    def _page_fraction(self, area, direction) -> float:
        frame = self._frame(area)
        contents = self._attr(area, "AXContents") or self._attr(area, "AXChildren") or []
        inner = self._frame(contents[0]) if contents else None
        if frame and inner:
            visible = frame[3] if direction in ("up", "down") else frame[2]
            total = inner[3] if direction in ("up", "down") else inner[2]
            if total > visible > 0:
                return 0.9 * visible / (total - visible)
        return 0.25

    def _do_press_key(self, app, pid, state, args) -> str:
        try:
            chord = keymap.parse_chord(str(args.get("key") or ""))
        except keymap.KeyNameError as exc:
            raise ComputerUseError(str(exc)) from exc
        if args.get("element_index") is not None:
            self._focus(self._element(state, args["element_index"]))
        if chord.text:
            self._refuse_secure_input()
        self._post_chord(pid, chord, float(args.get("duration") or 0))
        return f"pressed {args.get('key')}"

    def _do_type_text(self, app, pid, state, args) -> str:
        text = args.get("text")
        if not isinstance(text, str) or not text:
            raise ComputerUseError("text is required")
        if len(text) > MAX_TEXT_CHARS:
            raise ComputerUseError(f"text is longer than {MAX_TEXT_CHARS} characters; use paste")
        if args.get("element_index") is not None:
            element = self._element(state, args["element_index"])
            self._refuse_secure(self._node_at(state, args["element_index"]))
            self._focus(element)
        self._refuse_secure(None, self._focused_element(pid))
        self._refuse_secure_input()
        self._post_text(pid, text)
        return f"typed {len(text)} character(s)"

    def _do_set_value(self, app, pid, state, args) -> str:
        index = args.get("element_index")
        element = self._element(state, index)
        node = self._node_at(state, index)
        self._refuse_secure(node, element)
        if not self._settable(element, "AXValue"):
            raise ComputerUseError(f"element {index} has no settable value; use click or type_text")
        value = args.get("value")
        if value is None:
            raise ComputerUseError("value is required")
        current = self._attr(element, "AXValue")
        if isinstance(current, (int, float)) and not isinstance(current, bool):
            try:
                value = float(value)
            except (TypeError, ValueError) as exc:
                raise ComputerUseError("this element takes a number") from exc
        elif not isinstance(value, str):
            value = str(value)
        code = self._set(element, "AXValue", value)
        if code != 0:
            raise ComputerUseError(f"the app refused the value (Accessibility error {code})")
        return f"set {node.body()} to {value!r}"

    def _do_perform_secondary_action(self, app, pid, state, args) -> str:
        index = args.get("element_index")
        element = self._element(state, index)
        node = self._node_at(state, index)
        wanted = str(args.get("action_name") or "").strip()
        if not wanted:
            raise ComputerUseError("action_name is required")
        actions = self._actions(element)
        normalized = {a.lower(): a for a in actions}
        squashed = "ax" + wanted.replace(" ", "").replace("_", "").lower().removeprefix("ax")
        match = normalized.get(wanted.lower()) or normalized.get(squashed)
        if match is None:
            listed = ", ".join(actions) or "none"
            raise ComputerUseError(f"element {index} does not expose {wanted!r}; its actions are: {listed}")
        code = self._perform(element, match)
        if code != 0:
            raise ComputerUseError(f"{match} failed (Accessibility error {code})")
        return f"performed {match} on {node.body()}"

    def _do_select_text(self, app, pid, state, args) -> str:
        _, ax, _, _ = _frameworks()
        index = args.get("element_index")
        element = self._element(state, index)
        node = self._node_at(state, index)
        value = self._attr(element, "AXValue")
        if not isinstance(value, str):
            raise ComputerUseError(f"element {index} has no text value to select in")
        text = args.get("text")
        if not isinstance(text, str) or not text:
            raise ComputerUseError("text is required")
        start = find_text(value, text, args.get("prefix") or "", args.get("suffix") or "")
        if start is None:
            raise ComputerUseError(f"{text!r} was not found in element {index} with that prefix and suffix")
        location = utf16_len(value[:start])
        length = utf16_len(text)
        kind = str(args.get("selection_type") or "text")
        if kind == "cursor_before":
            length = 0
        elif kind == "cursor_after":
            location, length = location + length, 0
        elif kind != "text":
            raise ComputerUseError("selection_type must be text, cursor_before or cursor_after")
        self._focus(element)
        selection = ax.AXValueCreate(ax.kAXValueCFRangeType, (location, length))
        code = self._set(element, "AXSelectedTextRange", selection)
        if code != 0:
            raise ComputerUseError(f"the app refused the selection (Accessibility error {code})")
        where = {"text": "selected", "cursor_before": "placed the cursor before", "cursor_after": "placed the cursor after"}[kind]
        return f"{where} {text!r} in {node.body()}"

    def _do_paste(self, app, pid, state, args) -> str:
        appkit, _, _, _ = _frameworks()
        text = args.get("text")
        if not isinstance(text, str) or not text:
            raise ComputerUseError("text is required")
        kind = str(args.get("format") or "text").lower()
        if kind == "markdown":
            kind = "md"
        if kind not in ("text", "md", "html"):
            raise ComputerUseError("format must be text, md or html")
        if args.get("element_index") is not None:
            element = self._element(state, args["element_index"])
            self._refuse_secure(self._node_at(state, args["element_index"]))
            self._focus(element)
        self._refuse_secure(None, self._focused_element(pid))
        self._refuse_secure_input()
        board = appkit.NSPasteboard.generalPasteboard()
        saved = _save_pasteboard(board)
        board.clearContents()
        if kind == "text":
            board.setString_forType_(text, appkit.NSPasteboardTypeString)
        else:
            html = markdown_to_html(text) if kind == "md" else text
            board.setString_forType_(html, appkit.NSPasteboardTypeHTML)
            board.setString_forType_(text if kind == "md" else _strip_tags(text), appkit.NSPasteboardTypeString)
        written = board.changeCount()
        try:
            self._post_chord(pid, keymap.parse_chord("cmd+v"))
            time.sleep(0.6)
        finally:
            # Leave a clipboard the user changed meanwhile alone.
            if board.changeCount() == written:
                _restore_pasteboard(board, saved)
        return f"pasted {len(text)} character(s) as {'markdown' if kind == 'md' else kind}"


# ---------------------------------------------------------------------- helpers

def _await(start):
    done, result = threading.Event(), []

    def callback(value, error):
        result.extend((value, error))
        done.set()

    start(callback)
    deadline = time.monotonic() + 8
    while not done.wait(0.02):
        _check_cancelled()
        if time.monotonic() >= deadline:
            raise ComputerUseError("Window capture timed out")
    if result[1] is not None or result[0] is None:
        raise ComputerUseError(f"Window capture failed: {result[1]}")
    return result[0]


def _click_words(button: str, count: int) -> str:
    verb = {"left": "clicked", "right": "right-clicked", "middle": "middle-clicked"}[button]
    if count == 1:
        return verb
    if button == "left":
        return {2: "double-clicked", 3: "triple-clicked"}[count]
    return f"{verb} {count} times"


def utf16_len(text: str) -> int:
    return len(text.encode("utf-16-le")) // 2


def find_text(value: str, text: str, prefix: str = "", suffix: str = "") -> int | None:
    """Index of the first ``text`` in ``value`` preceded by ``prefix`` and followed by ``suffix``."""
    start = value.find(text)
    while start != -1:
        before = value[max(0, start - len(prefix)):start]
        after = value[start + len(text):start + len(text) + len(suffix)]
        if (not prefix or before == prefix) and (not suffix or after == suffix):
            return start
        start = value.find(text, start + 1)
    return None


def markdown_to_html(text: str) -> str:
    from markdown_it import MarkdownIt
    return MarkdownIt("commonmark").enable("table").enable("strikethrough").render(text)


def _strip_tags(html: str) -> str:
    import re
    from html import unescape
    return unescape(re.sub(r"<[^>]+>", "", html))


def _save_pasteboard(board) -> list[dict[str, bytes]]:
    saved = []
    for item in board.pasteboardItems() or []:
        entry = {}
        for kind in item.types() or []:
            data = item.dataForType_(kind)
            if data is not None:
                entry[str(kind)] = bytes(data)
        saved.append(entry)
    return saved


def _restore_pasteboard(board, saved) -> None:
    import AppKit
    board.clearContents()
    items = []
    for entry in saved:
        item = AppKit.NSPasteboardItem.alloc().init()
        for kind, data in entry.items():
            item.setData_forType_(AppKit.NSData.dataWithBytes_length_(data, len(data)), kind)
        items.append(item)
    if items:
        board.writeObjects_(items)


_BACKEND: MacComputer | None = None
_BACKEND_LOCK = threading.Lock()


def backend() -> MacComputer:
    global _BACKEND
    with _BACKEND_LOCK:
        if _BACKEND is None:
            _BACKEND = MacComputer()
        return _BACKEND


__all__ = ["ComputerUseError", "MacComputer", "Observation", "REFUSED_BUNDLES", "SETTLE_SECONDS",
           "backend", "find_text", "markdown_to_html", "render", "support", "utf16_len"]
