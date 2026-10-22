"""``code``: Python that drives the targets, in the isolated GUI interpreter.

The interpreter is ``backend/gui_runner.py``: a sandboxed child without
files, network or processes, stopped between calls. It reaches the host only
through ``backend/gui_broker.py``, which records every primitive as an effect
of the running execution. Each call registers one broker resource per target
with the call's own approval scope (the declared app; no page JavaScript, no
upload, no new external origin) and defines ``cu`` over those resources, so
``await cu.app.click(...)`` is the action call of the same name.

One interpreter lives for one execution attempt of a conversation, so
variables carry across the code calls of a turn.
"""
from __future__ import annotations

import json
from pathlib import Path
import threading
from typing import Any, Callable

from openprogram.programs._execution_common import ToolReturn

from . import params
from .targets import app as app_target
from .targets import browser as browser_target
from .targets import vm as vm_target

MAX_TIMEOUT = 120

_GUIDE = (Path(__file__).parent / "guides" / "code.md").read_text(encoding="utf-8")

_PRELUDE = """
class _CuTarget:
    def __init__(self, handle):
        self._handle = handle

    def __getattr__(self, action):
        if action.startswith("_"):
            raise AttributeError(action)

        async def call(**arguments):
            return (await ui.call(self._handle, action, arguments))["value"]
        call.__name__ = action
        return call


class _Cu:
    pass


cu = _Cu()
for _name, _handle in {handles}.items():
    setattr(cu, _name, _CuTarget(_handle))
del _name, _handle
"""

_lock = threading.Lock()
# conversation -> (execution identity, broker, runner)
_runners: dict[str, tuple[tuple, Any, Any]] = {}


class CodeError(RuntimeError):
    pass


def guide() -> str:
    return _GUIDE


def _identity() -> tuple[str, str, int, str]:
    from openprogram.agent.run_control import get_current_execution_id
    from openprogram.agentic_programming.call_state import current_tool_call_id
    from openprogram.execution.control.shared import default_control_service

    execution_id = get_current_execution_id()
    invocation = current_tool_call_id()
    execution = default_control_service().executions.get_execution(execution_id) if execution_id else None
    if execution is None or not invocation:
        raise CodeError("code runs only inside a conversation turn")
    return execution_id, execution.current_attempt_id, execution.owner_lease.get("generation"), invocation


def _runner(session: str):
    """This conversation's interpreter for the running attempt, started on first use."""
    from openprogram.backend.gui_broker import GuiBroker
    from openprogram.backend.gui_runner import GuiPythonRunner
    from openprogram.execution.control.shared import default_control_service

    execution_id, attempt_id, generation, invocation = _identity()
    key = (execution_id, attempt_id, generation)
    with _lock:
        held = _runners.get(session)
        if held and held[0] == key and not held[2]._closed:
            held[1].bind_invocation(invocation)
            return held[1], held[2]
        if held:
            held[2].close()
        broker = GuiBroker(effects=default_control_service().effects, execution_id=execution_id,
                           attempt_id=attempt_id, generation=generation, invocation_id=invocation)
        runner = GuiPythonRunner(broker=broker)
        runner.__enter__()
        _runners[session] = (key, broker, runner)
        return broker, runner


def close(session: str) -> None:
    with _lock:
        held = _runners.pop(session, None)
    if held:
        held[2].close()


def _adapter(target, action: str, call_args: dict, session: str) -> Callable:
    def method(arguments: dict, observation, context) -> ToolReturn:
        context.check()
        name, step, problem = params.check_step(target.NAME, action, dict(arguments))
        if problem:
            return ToolReturn(text=f"Error: {problem}", is_error=True)
        if target is app_target and name == "get_app_state":
            # Code parses what it reads, so a read is the whole tree, not the change since the last one.
            step.setdefault("full", True)
        result = target.run([(name, step)], call_args, session)
        # Code reads text and data; screenshots come back to a model through action calls.
        return ToolReturn(text=result.text, json_data=result.json_data, is_error=result.is_error)
    return method


def _validator(name: str, call_args: dict) -> Callable:
    declared = app_target.normalized_app(call_args.get("app"))

    def validate(action: str, arguments: dict, observation) -> None:
        if name == "app":
            named = app_target.normalized_app(arguments.get("app"))
            if action != "list_apps" and named != declared:
                raise PermissionError(f"this code call is approved for app {declared or '(none)'}; "
                                      f"{action} names {named or 'no app'}")
        elif name == "browser":
            if action == "evaluate":
                raise PermissionError("evaluate is not available in code; call it as an action")
            if browser_target.approval([(action, arguments)], {}):
                raise PermissionError(f"{action} needs its own approval; call it as an action")
    return validate


def _resources(call_args: dict) -> dict[str, tuple[Any, tuple[str, ...]]]:
    targets: dict[str, tuple[Any, tuple[str, ...]]] = {"browser": (browser_target, browser_target.ACTIONS)}
    if app_target.normalized_app(call_args.get("app")) and app_target.available():
        targets["app"] = (app_target, app_target.ACTIONS)
    if vm_target.available():
        targets["vm"] = (vm_target, vm_target.ACTIONS)
    return targets


def run(code: str, call_args: dict, session: str, *, timeout: float = 60) -> ToolReturn:
    from openprogram.backend.gui_runner import GuiRunnerError
    from openprogram.sandbox import SandboxUnavailable

    timeout = max(1.0, min(float(timeout or 60), MAX_TIMEOUT))
    try:
        broker, runner = _runner(session)
    except (CodeError, SandboxUnavailable, PermissionError) as exc:
        return ToolReturn(text=f"Error: code is unavailable here: {exc}", is_error=True)
    handles = {}
    try:
        for name, (target, actions) in _resources(call_args).items():
            methods = {action: _adapter(target, action, call_args, session) for action in actions}
            handles[name] = broker.register(target=name, methods=methods, validate=_validator(name, call_args))
        prelude = runner.execute(_PRELUDE.replace("{handles}", json.dumps(handles)), timeout=10)
        if prelude.error:
            raise GuiRunnerError(prelude.error)
        result = runner.execute(code, timeout=timeout)
    except (GuiRunnerError, ValueError, PermissionError) as exc:
        close(session)
        return ToolReturn(text=f"Error: the code interpreter stopped ({exc}); its variables are gone.", is_error=True)
    finally:
        for handle in handles.values():
            broker.revoke_resource(handle)
    parts = []
    if result.stdout:
        parts.append(result.stdout.rstrip("\n"))
    if result.stderr:
        parts.append("stderr:\n" + result.stderr.rstrip("\n"))
    if result.error:
        parts.append(f"Error: {result.error}")
    return ToolReturn(text="\n".join(parts) or "Done (nothing printed).", is_error=result.error is not None)


__all__ = ["MAX_TIMEOUT", "close", "guide", "run"]
