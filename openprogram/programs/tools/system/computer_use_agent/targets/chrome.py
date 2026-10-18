"""Target ``chrome``: the user's own Chrome, through Playwright MCP's extension mode.

``@playwright/mcp --extension`` opens a relay and the Playwright Extension
in the user's Chrome connects to it, so Playwright drives the user's real
tabs with their sign-ins. Every action is one of the server's tools with
its ``browser_`` prefix dropped, and its arguments are passed unchanged.
One server runs per conversation and stays connected between calls.
"""
from __future__ import annotations

import base64
from pathlib import Path
import tempfile
import threading
from typing import Any

from openprogram.programs._execution_common import ToolReturn

NAME = "chrome"
EXTENSION_ID = "mmlmfjhmonkocbjadbfplnigmagldckm"
EXTENSION_URL = f"https://chromewebstore.google.com/detail/playwright-extension/{EXTENSION_ID}"
# Node code run in the server's own process, outside the page: never offered.
WITHHELD = frozenset({"run_code_unsafe"})
_PREFIX = "browser_"
# Connecting waits for the user to pick a tab in the extension.
_TIMEOUT = 120.0

_GUIDE = (Path(__file__).parent.parent / "guides" / "chrome.md").read_text(encoding="utf-8")

_lock = threading.Lock()
_clients: dict[str, Any] = {}
_tools: list[Any] = []


def token() -> str:
    try:
        from openprogram.setup import _read_config
        value = (_read_config().get("computer_use") or {}).get("chrome_extension_token")
    except Exception:
        return ""
    return str(value or "").strip()


def available() -> bool:
    return True


def _command() -> list[str]:
    from openprogram.programs.workflow.browser.mcp_backends import _NPX_PREFIX, _PLAYWRIGHT_MCP_VERSION

    output = Path(tempfile.gettempdir()) / "openprogram-chrome"
    return [*_NPX_PREFIX, f"@playwright/mcp@{_PLAYWRIGHT_MCP_VERSION}", "--extension",
            "--output-dir", str(output)]


def _client(session: str):
    from openprogram.programs.workflow.browser.mcp_backends import _SyncMCPClient

    with _lock:
        client = _clients.get(session)
        if client is not None and client.is_alive():
            return client
        _clients.pop(session, None)
    env = {"PLAYWRIGHT_MCP_EXTENSION_TOKEN": token()} if token() else {}
    client = _SyncMCPClient(_command(), timeout=_TIMEOUT, env=env)
    with _lock:
        _clients[session] = client
        _tools[:] = list(client._client.tools)
    return client


def actions() -> dict[str, Any]:
    """The server's tools by action name, once a server has started."""
    return {tool.name[len(_PREFIX):]: tool for tool in _tools
            if tool.name.startswith(_PREFIX) and tool.name[len(_PREFIX):] not in WITHHELD}


def _action_lines() -> str:
    lines = []
    for name, tool in actions().items():
        props = (tool.inputSchema or {}).get("properties") or {}
        required = set((tool.inputSchema or {}).get("required") or [])
        params = ", ".join(p if p in required else f"{p}?" for p in props)
        summary = " ".join(str(tool.description or "").split())
        lines.append(f"- {name}({params}): {summary}")
    return "Actions\n" + "\n".join(lines)


def guide() -> str:
    if not _tools:
        return _GUIDE + "\nActions are listed once Chrome is first opened; open the target to see them."
    return _GUIDE + "\n" + _action_lines()


def approval(steps: list[tuple[str, dict]], args: dict) -> str | bool:
    """One grant covers the user's Chrome; uploads and page scripts are named."""
    for action, _ in steps:
        if action == "file_upload":
            return "computer_use_agent uploads local files to a website in your Chrome"
    return "computer_use_agent controls your Chrome"


def evaluates(steps: list[tuple[str, dict]]) -> bool:
    return any(action == "evaluate" for action, _ in steps)


def _result(result: Any) -> ToolReturn:
    texts, images = [], []
    for item in getattr(result, "content", None) or []:
        kind = getattr(item, "type", "")
        if kind == "text":
            texts.append(str(getattr(item, "text", "")))
        elif kind == "image" and getattr(item, "data", None):
            images.append(base64.b64decode(item.data))
    error = bool(getattr(result, "isError", False))
    return ToolReturn(text="\n".join(texts).strip(), images=images, is_error=error)


def _start(session: str) -> Any:
    try:
        return _client(session)
    except Exception as exc:
        raise RuntimeError(
            f"could not start Playwright MCP for Chrome ({exc}). It needs Node.js (npx) and the Playwright "
            f"Extension installed in Chrome: {EXTENSION_URL}") from exc


def open_target(args: dict, session: str) -> ToolReturn:
    return run([("tabs", {"action": "list"})], args, session)


def run(steps: list[tuple[str, dict]], args: dict, session: str) -> ToolReturn:
    try:
        client = _start(session)
    except RuntimeError as exc:
        return ToolReturn(text=f"Error: {exc}", is_error=True)
    known = actions()
    texts, images = [], []
    for number, (action, step) in enumerate(steps, 1):
        where = f"step {number} ({action}): " if len(steps) > 1 else ""
        if action not in known:
            texts.append(f"Error: {where}unknown chrome action {action!r}; actions: {', '.join(known)}")
            return ToolReturn(text="\n".join(texts), images=images, is_error=True)
        try:
            result = _result(client.call(_PREFIX + action, {**args, **step}))
        except Exception as exc:
            result = ToolReturn(text=f"{exc}. If Chrome did not connect, check that the Playwright Extension "
                                     f"is installed ({EXTENSION_URL}) and a tab was shared.", is_error=True)
        texts.append(f"{where}{result.text}" if where else result.text)
        images.extend(result.images)
        if result.is_error:
            if not texts[-1].startswith("Error"):
                texts[-1] = "Error: " + texts[-1]
            if number < len(steps):
                texts.append(f"Stopped: step {number} failed; the steps after it did not run.")
            return ToolReturn(text="\n".join(texts), images=images, is_error=True)
    return ToolReturn(text="\n\n".join(t for t in texts if t), images=images)


__all__ = ["EXTENSION_URL", "NAME", "actions", "approval", "available", "evaluates", "guide", "open_target", "run",
           "token"]
