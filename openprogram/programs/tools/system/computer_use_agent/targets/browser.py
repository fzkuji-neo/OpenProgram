"""Target ``browser``: a web browser, chosen first, then operated with one set of actions.

As in Codex, the browser is chosen by ``args.browser``: omitted, it is
OpenProgram's built-in browser, driven through the web_use runtime;
``chrome`` or ``edge`` is the user's own browser, reached through the
Playwright Extension (``extension_browser``). The actions are the same in
all of them. ``list_pages``, ``observe``, ``verify`` and ``close`` are
web_use commands of the same name; every other action is an ``act`` action.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from openprogram.programs._execution_common import ToolReturn
from openprogram.web_use_contract import _ACT_ACTION_ENUM

NAME = "browser"

COMMANDS = ("list_pages", "observe", "verify", "close")
ACT_ACTIONS = tuple(_ACT_ACTION_ENUM)
ACTIONS = (*COMMANDS, *ACT_ACTIONS)
# Fields that address the session rather than describe the action.
_CALL_FIELDS = ("backend", "page", "page_context_token", "web_session_id")
# Choosing the browser; it is not an argument of any action.
_BROWSER_FIELD = "browser"

_GUIDE = (Path(__file__).parent.parent / "guides" / "browser.md").read_text(encoding="utf-8")


def guide() -> str:
    return _GUIDE


def available() -> bool:
    return True


def _is_local(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    return host in {"localhost", "127.0.0.1", "::1"} or host.endswith((".localhost", ".test"))


def user_browser(args: dict) -> str:
    """``chrome`` or ``edge`` when the call operates the user's own browser, else ``""``."""
    from openprogram.programs.workflow.browser.extension_browser import browser_of
    return browser_of(args)


def approval(steps: list[tuple[str, dict]], args: dict) -> str | bool:
    """Uploads and new external origins ask; the conversation's Pages are its grant.

    The user's own Chrome or Edge holds their sign-ins: one grant covers it."""
    chosen = user_browser(args)
    if chosen:
        from openprogram.programs.workflow.browser.extension_browser import NAMES
        if any(action == "upload" for action, _ in steps):
            return f"computer_use_agent uploads a local file to a website in your {NAMES[chosen]}"
        return f"computer_use_agent controls your {NAMES[chosen]}"
    for action, step in steps:
        merged = {**args, **step}
        if action == "upload":
            return "Upload the selected local file to the bound website; this can transmit file contents immediately."
        url = str(merged.get("url") or "")
        if url and not _is_local(url):
            return f"computer_use_agent opens {urlparse(url).scheme}://{urlparse(url).netloc}"
    return False


def evaluates(steps: list[tuple[str, dict]]) -> bool:
    """Whether a call runs page JavaScript, which is approved every time."""
    return any(action == "evaluate" for action, _ in steps)


def open_target(args: dict, session: str) -> ToolReturn:
    return run([("list_pages", {})], args, session)


def _one(action: str, step: dict, args: dict, session: str = "") -> Any:
    from openprogram.programs.workflow.browser import run_web_use

    merged = {**args, **step}
    chosen = user_browser(merged)
    merged.pop(_BROWSER_FIELD, None)
    if chosen:
        return _in_user_browser(chosen, action, merged, session)
    call = {field: str(merged.pop(field) or "") for field in _CALL_FIELDS if field in merged}
    if action == "select":
        if not str(merged.get("value") or "").strip():
            return ToolReturn(text="Error: select needs value, the option's value or label text.", is_error=True)
    if action in COMMANDS:
        command, arguments = action, merged
        if action == "verify":
            arguments = {"action": "verify", **merged}
    else:
        command, arguments = "act", {"action": action, **merged}
    return run_web_use(command, call.get("backend", ""), call.get("page", ""), call.get("page_context_token", ""),
                       call.get("web_session_id", ""), arguments or None)


def _in_user_browser(chosen: str, action: str, merged: dict, session: str) -> Any:
    from openprogram.programs.workflow.browser import extension_browser

    try:
        browser = extension_browser.ExtensionBrowser(session, chosen)
    except extension_browser.Unavailable as exc:
        return ToolReturn(text=f"Error: {exc}", is_error=True)
    for field in _CALL_FIELDS:
        if field != "page":
            merged.pop(field, None)
    if action in COMMANDS:
        result = browser.run(action, merged)
    else:
        result = browser.run("act", {"action": action, **merged})
    images = result.pop("_images", [])
    return ToolReturn(json_data=result, images=images, is_error=result.get("ok") is False)


def _failed(result: Any) -> bool:
    if isinstance(result, ToolReturn):
        return result.is_error
    return isinstance(result, dict) and result.get("ok") is False


def _as_return(result: Any) -> ToolReturn:
    if isinstance(result, ToolReturn):
        return result
    return ToolReturn(json_data=result, is_error=_failed(result))


def run(steps: list[tuple[str, dict]], args: dict, session: str) -> ToolReturn:
    """Run one action, or several in order, stopping at the first failure."""
    for number, (action, _) in enumerate(steps, 1):
        if action not in ACTIONS:
            where = f"step {number}: " if len(steps) > 1 else ""
            return ToolReturn(text=f"Error: {where}unknown browser action {action!r}; actions: {', '.join(ACTIONS)}",
                              is_error=True)
    if len(steps) == 1:
        return _as_return(_one(steps[0][0], steps[0][1], args, session))
    results, images = [], []
    for number, (action, step) in enumerate(steps, 1):
        result = _as_return(_one(action, step, args, session))
        images.extend(result.images)
        results.append({"step": number, "action": action,
                        "result": result.json_data if result.json_data is not None else result.text})
        if result.is_error:
            results.append({"stopped": f"step {number} failed; the steps after it did not run"})
            return ToolReturn(json_data=results, images=images, is_error=True)
    return ToolReturn(json_data=results, images=images)


__all__ = ["ACTIONS", "NAME", "approval", "available", "evaluates", "guide", "open_target", "run", "user_browser"]
