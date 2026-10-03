"""Optional adapter from the installed GUI Agent Harness to web_use."""

from __future__ import annotations

import inspect
from typing import Callable
from weakref import WeakSet

from openprogram.agentic_programming.continuation import gui_operation

DEFAULT_MAX_STEPS = 150
_GUI_ORCHESTRATION_FNS = WeakSet()


def _normalize_gui_result(result):
    if not isinstance(result, dict):
        return result
    normalized = dict(result)
    status = str(normalized.get("status") or "")
    if normalized.get("infeasible_declared"):
        status = "infeasible"
    elif not status:
        if isinstance(normalized.get("success"), bool):
            status = "succeeded" if normalized["success"] else "failed"
    if not status:
        return normalized
    normalized["status"] = status
    normalized["success"] = status == "succeeded"
    reason_code = str(normalized.get("reason_code") or "").strip()
    if not reason_code or (
        status == "infeasible" and reason_code in {"completed", "succeeded", "verified"}
    ):
        normalized["reason_code"] = "completed" if status == "succeeded" else status
    if status == "infeasible":
        normalized["infeasible_declared"] = True
        if not str(normalized.get("handoff_instruction") or "").strip():
            normalized["handoff_instruction"] = str(normalized.get("summary") or "")
    else:
        normalized.setdefault("infeasible_declared", False)
        normalized.setdefault("handoff_instruction", "")
    return normalized


def install_gui_harness_web_use(original: Callable | None = None):
    """Replace the registered gui_agent entry with a backend-aware wrapper."""
    if original is None:
        from gui_harness.main import gui_agent as original
    original_impl = getattr(original, "__wrapped__", original)
    globals()["_GUI_LEGACY_IMPL"] = original_impl

    from openprogram.agentic_programming import Agent

    class GuiHarnessAgent(Agent):
        method_options = {
            "gui_agent": {
                "name": "gui_agent",
                "resumable": True,
                "as_tool": True,
                "toolset": ("harness",),
                "input": {
                    "task": {
                        "source": "llm",
                        "description": "What to do",
                        "multiline": True,
                    },
                    "max_steps": {
                        "description": "Maximum GUI Agent iterations",
                        "hidden": True,
                        "advanced": True,
                    },
                    "app_name": {
                        "description": "Desktop app name used for visual memory",
                        "hidden": True,
                        "advanced": True,
                    },
                    "surface": {
                        "description": "Browser execution path or legacy capability preference",
                        "hidden": True,
                        "advanced": True,
                    },
                    "backend": {
                        "description": "Optional built-in Page web_use backend",
                        "options": [
                            "playwright_mcp",
                            "chrome_devtools_mcp",
                            "open_claude_chrome",
                        ],
                        "hidden": True,
                        "advanced": True,
                    },
                    "max_seconds": {
                        "description": "Wall-clock limit",
                        "hidden": True,
                        "advanced": True,
                    },
                    "vm_url": {
                        "description": "Optional OSWorld-compatible VM endpoint",
                        "hidden": True,
                        "advanced": True,
                    },
                    "allow_general": {"hidden": True},
                    "runtime": {"hidden": True},
                },
                "parameters": {
                    "type": "object",
                    "properties": {
                        "task": {
                            "type": "string",
                            "description": "What to do",
                        },
                    },
                    "required": ["task"],
                },
                "tool": True,
            },
        }

        @staticmethod
        def gui_agent(
            task: str,
            max_steps: int | None = None,
            app_name: str = "desktop",
            surface: str = "",
            backend: str = "",
            max_seconds: float | None = None,
            vm_url: str = "",
            runtime=None,
            allow_general: bool = False,
        ) -> dict:
            """Run bounded capabilities with retained decisions and effect receipts."""
            config = {
                "task": task,
                "max_steps": max_steps,
                "app_name": app_name,
                "surface": surface,
                "backend": backend,
                "max_seconds": max_seconds,
                "vm_url": vm_url,
                "allow_general": allow_general,
            }
            state = gui_operation("initialize", "initialize", config)
            if state["route"] == "legacy":
                return gui_operation("legacy", "legacy", config)
            while state["status"] == "running":
                decision = gui_operation(
                    "plan", "plan", {"config": config, "state": state}
                )
                state = gui_operation(
                    "decide",
                    "decide",
                    {"config": config, "state": state, "decision": decision},
                )
                if state["status"] == "running":
                    result = gui_operation(
                        "capability", "capability", {"config": config, "state": state}
                    )
                    state = gui_operation(
                        "advance",
                        "advance",
                        {"config": config, "state": state, "result": result},
                    )
            return gui_operation("finish", "finish", {"config": config, "state": state})

    gui_agent = GuiHarnessAgent().gui_agent

    # ``programs run`` resolves a registered function's module and then looks
    # up the public function name on that module.  The wrapper is defined here
    # so it can close over the installed harness implementation; publish that
    # same bound method instead of adding a second execution wrapper.
    globals()["gui_agent"] = gui_agent
    _GUI_ORCHESTRATION_FNS.add(inspect.unwrap(gui_agent))
    return gui_agent


__all__ = ["DEFAULT_MAX_STEPS", "install_gui_harness_web_use"]
