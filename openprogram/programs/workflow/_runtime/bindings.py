"""Inject llm, agent, goal, and control-flow callables into a workflow."""

from __future__ import annotations

import importlib
from typing import Callable, Optional


def _agent_function(session_id: str, spawn_caller: Optional[str]) -> Callable:
    from openprogram.agent.sub_agent_run import run_agent_turn

    def agent(
        prompt: str,
        description: str = "",
        agent_id: str = "",
        start_from: str = "clean",
        run_in_background: bool = False,
        to: str = "",
        archive_when_done: bool = False,
    ) -> str:
        if run_in_background:
            raise ValueError("run_in_background is not supported in workflow context")
        if to:
            raise ValueError("to= dispatch is not supported in workflow context")
        if archive_when_done:
            raise ValueError("archive_when_done is not supported in workflow context")
        if start_from != "clean":
            raise ValueError("start_from must be 'clean' in workflow context")

        result = run_agent_turn(
            session_id=session_id,
            prompt=prompt,
            agent_id=agent_id or "main",
            branch_from=None,
            label=description or "workflow agent",
            spawn_caller=spawn_caller,
            advance_head=False,
            tools_override=None,
        )
        if result.failed:
            raise RuntimeError(result.error or "workflow agent turn failed")
        return result.final_text or ""

    return agent


def _agent_loop_function() -> Callable:
    from openprogram.agentic_programming import agent

    return agent


def _llm_function() -> Callable:
    from openprogram.agentic_programming import llm

    return llm


def _goal_function() -> Callable:
    from openprogram.programs.workflow.goal import goal

    return goal


def _validate_and_retry_function() -> Callable:
    from openprogram.agentic_programming.control_flow import validate_and_retry

    return validate_and_retry


def _route_function() -> Callable:
    from openprogram.agentic_programming.control_flow import route

    return route


def _conditional_function() -> Callable:
    from openprogram.agentic_programming.control_flow import conditional

    return conditional


def _registered_program_entries() -> dict[str, Callable]:
    """Resolve Python-callable entries defined by PROGRAM_MODULES."""
    from openprogram.programs._registry import PROGRAM_MODULES

    from openprogram.programs._runtime import all_tools
    allowed_modules = {
        f"openprogram.programs.workflow.{name}"
        for name in PROGRAM_MODULES
        if name not in {"search_workflows", "create_workflow", "revise_workflow", "auto_workflow"}
    }
    for module_name in allowed_modules:
        try:
            importlib.import_module(module_name)
        except Exception:
            continue
    found: dict[str, Callable] = {}
    for tool in all_tools():
        source = getattr(tool, "_source_module", "")
        if not getattr(tool, "_is_agent_method", False) or not any(
            source == name or source.startswith(name + ".") for name in allowed_modules
        ):
            continue
        function = getattr(tool, "_python_callable", None)
        if callable(function):
            found[tool.name] = function
    return found
