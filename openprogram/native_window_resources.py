"""The native app window an Agent operates, for the conversation's preview.

A GUI step that acted on a macOS window returns that window's identity as
``target`` (window_id, pid, app_name) together with the screenshot it
observed. The worker keeps the latest frame per conversation and tells the
App, so the chat preview follows desktop apps the way it follows web pages.
Frames live in memory only: they are what the Agent saw, not a record.
"""
from __future__ import annotations

import json
import logging
import threading
import time
from pathlib import Path
from typing import Any, Callable, Mapping

_log = logging.getLogger(__name__)

_MAX_FRAME_BYTES = 8 * 1024 * 1024
_FRAME_KEYS = ("screenshot_artifact", "img_path")
_lock = threading.Lock()
_latest: dict[str, dict[str, Any]] = {}


def operated_window(output: Any) -> dict[str, Any] | None:
    """The window a function result says it acted on, if it names one."""
    if not isinstance(output, Mapping):
        return None
    target = output.get("target")
    if not isinstance(target, Mapping):
        return None
    window_id, pid, app_name = target.get("window_id"), target.get("pid"), target.get("app_name")
    if type(window_id) is not int or type(pid) is not int or not isinstance(app_name, str):
        return None
    return {"window_id": window_id, "pid": pid, "app_name": app_name[:120]}


def _frame_path(value: Any, depth: int = 0) -> Path | None:
    if depth > 3:
        return None
    if isinstance(value, Mapping):
        for key in _FRAME_KEYS:
            path = value.get(key)
            if isinstance(path, str) and path.lower().endswith(".png"):
                candidate = Path(path)
                if candidate.is_file():
                    return candidate
        for item in value.values():
            found = _frame_path(item, depth + 1)
            if found is not None:
                return found
    return None


def _read_frame(output: Mapping[str, Any]) -> bytes | None:
    path = _frame_path(output)
    if path is None:
        return None
    try:
        if path.stat().st_size > _MAX_FRAME_BYTES:
            return None
        # Read now: the harness may delete its capture after the step.
        return path.read_bytes()
    except OSError:
        return None


def _owner() -> tuple[str | None, str | None]:
    try:
        from openprogram.processes import current_owner
        session_id, execution_id, _ = current_owner()
        return session_id, execution_id
    except Exception:
        from openprogram.agent.run_control import get_current_execution_id, get_current_session_id
        return get_current_session_id(), get_current_execution_id()


_forward: Callable[[dict[str, Any]], None] | None = None


def forward_to_parent(sink: Callable[[dict[str, Any]], None] | None) -> None:
    """In an agentic subprocess, hand windows to the worker instead of keeping them."""
    global _forward
    _forward = sink


def note_operated_window(output: Any) -> None:
    """Record the window a finished function acted on and tell the App."""
    window = operated_window(output)
    if window is None:
        return
    session_id, execution_id = _owner()
    observed = {**window, "execution_id": execution_id or "", "frame": _read_frame(output)}
    if _forward is not None:
        _forward(observed)
        return
    if session_id:
        record_operated_window(observed, session_id=session_id)


def record_operated_window(
    observed: Mapping[str, Any], *, session_id: str, execution_id: str | None = None,
) -> None:
    """Keep the latest window of a conversation and announce it.

    The caller names the conversation; a subprocess's own claim is not used.
    """
    window = operated_window({"target": observed})
    if window is None or not session_id:
        return
    frame = observed.get("frame")
    frame = frame if isinstance(frame, bytes) and len(frame) <= _MAX_FRAME_BYTES else None
    with _lock:
        previous = _latest.get(session_id) or {}
        same_window = previous.get("window_id") == window["window_id"]
        entry = {
            **window,
            "session_id": session_id,
            "execution_id": str(execution_id or observed.get("execution_id") or ""),
            "sequence": int(previous.get("sequence") or 0) + 1,
            "at": time.time(),
            # A step without a capture keeps the last frame of the same window.
            "frame": frame if frame is not None else (previous.get("frame") if same_window else None),
        }
        _latest[session_id] = entry
    try:
        from openprogram.webui import server as _s
        _s._broadcast(json.dumps({"type": "native.window", "data": public_window(entry)}))
    except Exception:
        _log.debug("native window broadcast failed", exc_info=True)


def public_window(entry: Mapping[str, Any]) -> dict[str, Any]:
    return {
        key: entry[key]
        for key in ("session_id", "execution_id", "window_id", "pid", "app_name", "sequence", "at")
    } | {"has_frame": entry.get("frame") is not None}


def latest_window(session_id: str) -> dict[str, Any] | None:
    with _lock:
        entry = _latest.get(session_id)
        return dict(entry) if entry else None


__all__ = [
    "forward_to_parent", "latest_window", "note_operated_window", "operated_window",
    "public_window", "record_operated_window",
]
