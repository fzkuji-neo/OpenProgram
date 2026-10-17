"""Turn a step's target into what a backend takes.

``element_index`` (app) and ``ref`` (browser) go to the backend as they
are; so do ``x``, ``y`` in pixels of the target's last screenshot. A
``describe`` (and, for drags, ``to_describe``) is found on a fresh
screenshot by gui_harness's ``locate_target``: icon detection, OCR,
remembered components and a model check. Its centre becomes ``x``, ``y``.
"""
from __future__ import annotations

from contextlib import contextmanager
import importlib.util
import os
from pathlib import Path
import tempfile
from typing import Any, Callable

GUIDE = (Path(__file__).parent / "guides" / "describe.md").read_text(encoding="utf-8")
GUIDE_UNAVAILABLE = ("Grounding by description (describe) needs the GUI perception libraries, which this runtime does "
                     "not include; point by element index or by x,y pixels of the last screenshot.")


class GroundingError(RuntimeError):
    """A description could not be placed on the screenshot."""


def describe_available() -> bool:
    """gui_harness and the detector it runs are importable on this host."""
    try:
        return all(importlib.util.find_spec(name) is not None for name in ("gui_harness", "ultralytics", "cv2"))
    except (ImportError, ValueError):
        return False


@contextmanager
def _runtime():
    """Run gui_harness's model calls on the conversation's model."""
    from openprogram.agentic_programming.call_state import _current_runtime

    if _current_runtime.get(None) is not None:
        yield
        return
    from openprogram.agent.run_control import get_current_session_id
    from openprogram.agent.session_model import read_session_chat_model
    from openprogram.providers.registry import create_runtime

    session = get_current_session_id()
    provider, model = read_session_chat_model(session) if session else (None, None)
    token = _current_runtime.set(create_runtime(provider=provider or None, model=model or None))
    try:
        yield
    finally:
        _current_runtime.reset(token)


def locate(image: bytes, description: str, *, app_name: str) -> tuple[float, float]:
    """The centre of what ``description`` names, in pixels of ``image``."""
    if not describe_available():
        raise GroundingError("describe needs the GUI perception package (gui_harness with its detector), "
                             "which this runtime does not include; use element_index, ref or x,y")
    from gui_harness.planning.component_memory import locate_target

    handle, path = tempfile.mkstemp(prefix="computer-use-ground-", suffix=".png")
    try:
        with os.fdopen(handle, "wb") as file:
            file.write(image)
        with _runtime():
            location = locate_target(task=description, target=description, img_path=path, app_name=app_name)
    except GroundingError:
        raise
    except Exception as exc:  # noqa: BLE001 - the detector's failure is the step's failure
        raise GroundingError(f"could not look for {description!r}: {type(exc).__name__}: {exc}") from exc
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass
    if not location or location.get("verification_status") in {"unverified_guess", "rejected"}:
        raise GroundingError(f"{description!r} was not found on the screenshot; describe it differently or use x,y")
    return float(location["cx"]), float(location["cy"])


def resolve_screenshot(capture: Callable[[], bytes], step: dict[str, Any], *, app_name: str) -> dict[str, Any]:
    """Replace ``describe`` / ``to_describe`` with pixels of a screenshot ``capture`` takes now."""
    out = dict(step)
    describe, to_describe = out.pop("describe", None), out.pop("to_describe", None)
    if not describe and not to_describe:
        return out
    image = capture()
    if describe:
        out["x"], out["y"] = locate(image, str(describe), app_name=app_name)
    if to_describe:
        out["to_x"], out["to_y"] = locate(image, str(to_describe), app_name=app_name)
    return out


def resolve_app(computer, session: str, app: str, step: dict[str, Any]) -> dict[str, Any]:
    """``describe`` on an application window, in pixels of the screenshot it now takes."""
    from openprogram.computer_use.base import ComputerUseError

    if step.get("element_index") is not None:
        return {key: value for key, value in step.items() if key not in {"describe", "to_describe"}}

    def capture() -> bytes:
        observation = computer.get_state(session, app, include="screenshot")
        if not observation.image:
            raise GroundingError("the window has no screenshot to search; show_window first")
        return observation.image

    try:
        return resolve_screenshot(capture, step, app_name=" ".join(app.split()).lower() or "desktop")
    except GroundingError as exc:
        raise ComputerUseError(str(exc)) from exc


__all__ = ["GUIDE", "GUIDE_UNAVAILABLE", "GroundingError", "describe_available", "locate", "resolve_app", "resolve_screenshot"]
