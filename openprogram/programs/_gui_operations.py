"""Fixed host operations for the version-one durable GUI orchestration API."""
from __future__ import annotations

import inspect
import time


def _host_runtime():
    """The Runtime the registered gui_agent call runs on."""
    from openprogram.agentic_programming.call_state import _current_runtime
    return _current_runtime.get(None)


def guard(operation, payload, context):
    """Check fresh desktop access before a capability effect is registered."""
    if operation != "capability" or payload["state"]["next_call"] != "computer_use":
        return
    if _expired(payload["state"]):
        return
    if not payload["state"]["availability"].get("computer_use", {}).get("available"):
        return
    from openprogram.system_access import required_access_state
    state = required_access_state("gui_agent", {"surface": "desktop"})
    if state and state["state"] == "waiting" and context is not None:
        from openprogram.agentic_programming.continuation import FunctionSystemAccessRequired
        context.boundary()
        # Prove the original execution owner still owns this admission point.
        with context.store._transaction() as connection:
            context.owned(connection)
        raise FunctionSystemAccessRequired(context.call_key)


def _settings(config):
    from openprogram.programs.gui_harness_bridge import DEFAULT_MAX_STEPS
    steps = config["max_steps"]
    steps = DEFAULT_MAX_STEPS if steps is None else int(steps)
    return (steps if steps > 0 else None), (
        float(config["max_seconds"]) if config["max_seconds"] and float(config["max_seconds"]) > 0 else None
    )


def _expired(state):
    return state["max_seconds"] is not None and time.time() >= state["start"] + state["max_seconds"]


def _timeout(state):
    return {**state, "status": "failed", "reason_code": "timeout",
            "terminal_reason": "GUI Agent exceeded its Runtime time limit."}


def _last_image_path(history):
    for entry in reversed(history):
        output = entry.get("output")
        if isinstance(output, dict):
            step = output.get("step")
            return str(step["img_path"]) if isinstance(step, dict) and step.get("img_path") else ""
    return ""


def _availability(capability_loop, config):
    availability = capability_loop.capability_status(vm_url=config["vm_url"], browser_backend=config["backend"])
    desktop = availability.get("computer_use", {})
    access = desktop.get("system_access") or []
    # Pinned MacWindow marks recoverable OS grants unavailable. Retain that
    # diagnostic while allowing a planner to select the guarded capability.
    if (not desktop.get("available") and not desktop.get("missing_dependencies") and access
            and any(row.get("status") == "not_granted" for row in access)
            and all(row.get("status") in {"granted", "not_granted"} for row in access)):
        availability = {**availability, "computer_use": {**desktop, "available": True, "requires_system_access": True}}
    return availability


def _blocked_access(state):
    return {
        "status": "infeasible", "success": False,
        "reason_code": state.get("reason_code", "system_access_required"),
        "summary": state.get("detail") or "Waiting for system access.",
        "system_access": state["capabilities"], "completion_verified": False,
    }


def _legacy(config):
    from openprogram.programs import gui_harness_bridge
    from openprogram.system_access import required_access_state
    surface = str(config["surface"] or "").strip().lower()
    steps, seconds = _settings(config)
    if surface not in {"", "desktop", "browser", "vm"}:
        return gui_harness_bridge._normalize_gui_result({
            "status": "failed", "reason_code": "invalid_surface", "summary": f"Unknown GUI surface: {surface}",
        })
    preferred = {"desktop": "computer_use", "browser": "browser_use", "vm": "vm_use"}.get(surface, "")
    if config["backend"] and not preferred:
        preferred = "browser_use"
    if preferred == "browser_use":
        from openprogram.programs.gui_browser_agent import run_browser_gui_agent
        return gui_harness_bridge._normalize_gui_result(run_browser_gui_agent(
            task=config["task"], max_steps=steps, max_seconds=seconds,
            backend=config["backend"], allow_general=config["allow_general"],
        ))
    if surface == "desktop" and not config["vm_url"]:
        access = required_access_state("gui_agent", {"surface": "desktop"})
        if access and access["state"] != "ready":
            return gui_harness_bridge._normalize_gui_result(_blocked_access(access))
    args = {
        "task": config["task"], "max_steps": steps or 0, "app_name": config["app_name"],
        "max_seconds": seconds, "allow_general": config["allow_general"],
        "browser_backend": config["backend"], "vm_url": config["vm_url"], "preferred_capability": preferred,
    }
    original = gui_harness_bridge._GUI_LEGACY_IMPL
    signature = inspect.signature(original)
    if not any(p.kind is inspect.Parameter.VAR_KEYWORD for p in signature.parameters.values()):
        args = {key: value for key, value in args.items() if key in signature.parameters}
    from openprogram.session_resources import resource_use
    vm = config["vm_url"]
    with resource_use("vm" if vm else "desktop", "VM" if vm else config["app_name"], vm or config["app_name"]):
        result = gui_harness_bridge._normalize_gui_result(original(**args))
    if isinstance(result, dict) and not vm:
        from openprogram.system_access import report
        result["system_access"] = report()["capabilities"]
    return result


def dispatch(operation, payload):
    if operation == "initialize":
        surface = str(payload["surface"] or "").strip().lower()
        if surface or payload["backend"] or payload["vm_url"]:
            return {"route": "legacy"}
        if _host_runtime() is None:
            raise ValueError("gui_agent requires a Runtime")
        steps, seconds = _settings(payload)
        return {"route": "capability_loop", "status": "running", "start": time.time(),
                "max_steps": steps, "max_seconds": seconds, "history": [], "iterations": 0,
                "capability_calls": 0, "feedback": {"computer_use": None, "vm_use": None},
                "reason_code": "", "terminal_reason": "", "blocker": "", "handoff_instruction": ""}
    if operation == "legacy":
        return _legacy(payload)
    from gui_harness.tasks import capability_loop
    config, state = payload["config"], payload["state"]
    remaining = None if state["max_seconds"] is None else max(0.001, state["start"] + state["max_seconds"] - time.time())
    if operation == "plan":
        if _expired(state):
            return {"stopped": "timeout"}
        if state["max_steps"] is not None and state["iterations"] >= state["max_steps"] * 3 + 3:
            return {"stopped": "decision_limit"}
        availability = _availability(capability_loop, config)
        try:
            decision = capability_loop.plan_next_capability(
                task=config["task"], history=state["history"], availability=availability,
                preferred_capability="", timeout_s=remaining,
            )
        except Exception as exc:
            decision = {"call": "terminal", "args": {"status": "failed", "reason_code": "planner_error", "reason": str(exc)}}
        return {"decision": decision, "availability": availability}
    if operation == "decide":
        planned = payload["decision"]
        if planned.get("stopped") == "timeout" or _expired(state):
            return _timeout(state)
        if planned.get("stopped") == "decision_limit":
            return {**state, "status": "failed", "reason_code": "decision_limit", "terminal_reason": "GUI Agent reached its Runtime decision limit."}
        state = {**state, "iterations": state["iterations"] + 1}
        decision = planned["decision"]
        call = str(decision.get("call") or "")
        if state["max_seconds"] is not None and time.time() >= state["start"] + state["max_seconds"]:
            return {**state, "status": "failed", "reason_code": "timeout", "terminal_reason": "GUI Agent exceeded its Runtime time limit."}
        if state["max_steps"] is not None and state["iterations"] > state["max_steps"] * 3 + 3:
            return {**state, "status": "failed", "reason_code": "decision_limit", "terminal_reason": "GUI Agent reached its Runtime decision limit."}
        if call == "terminal":
            terminal = capability_loop.validate_terminal_decision(decision, state["history"])
            if not terminal.get("accepted"):
                return {**state, "history": state["history"] + [{"type": "terminal_rejected", "decision": decision, "reason": terminal.get("reason", "unsupported terminal")}], "next_call": ""}
            status = str(terminal["status"])
            return {**state, "status": status, "reason_code": terminal.get("reason_code") or ("completed" if status == "succeeded" else status),
                    "terminal_reason": str(terminal.get("reason") or ""), "blocker": str(terminal.get("blocker") or ""),
                    "handoff_instruction": str(terminal.get("handoff_instruction") or "")}
        if call not in capability_loop.CAPABILITIES:
            return {**state, "history": state["history"] + [{"type": "terminal_rejected", "decision": decision, "reason": f"unknown capability: {call}"}], "next_call": ""}
        if state["max_steps"] is not None and state["capability_calls"] >= state["max_steps"]:
            return {**state, "status": "failed", "reason_code": "safety_step_limit", "terminal_reason": "GUI Agent reached its Runtime action limit."}
        return {**state, "next_call": call, "next_args": dict(decision.get("args") or {}), "availability": planned["availability"]}
    if operation == "capability":
        if _expired(state):
            return {"deadline_expired": True}
        call = state["next_call"]
        if not call:
            return {"skip": True}
        if not state["availability"].get(call, {}).get("available"):
            return {"status": "failed", "success": False, "reason_code": "capability_unavailable", "summary": f"{call} is not currently available"}
        if call == "computer_use":
            from openprogram.system_access import required_access_state
            access = required_access_state("gui_agent", {"surface": "desktop"})
            if access and access["state"] != "ready":
                return _blocked_access(access)
            fresh = capability_loop.capability_status(vm_url=config["vm_url"], browser_backend=config["backend"])
            if not fresh.get(call, {}).get("available"):
                return {"status": "failed", "success": False, "reason_code": "capability_unavailable", "summary": f"{call} is not currently available"}
        try:
            return capability_loop.call_capability(
                call, state["next_args"], app_name=config["app_name"],
                allow_general=config["allow_general"], browser_backend=config["backend"], vm_url=config["vm_url"],
                feedback=state["feedback"].get(call), max_seconds=None if remaining is None else max(1.0, remaining),
            )
        except Exception as exc:
            return {"status": "failed", "success": False, "reason_code": "capability_operation_failed", "summary": str(exc), "error_type": type(exc).__name__}
    if operation == "advance":
        result = payload["result"]
        if result.get("deadline_expired"):
            return _timeout(state)
        if result.get("skip"):
            return state
        call = state["next_call"]
        calls = state["capability_calls"] + 1
        feedback = dict(state["feedback"])
        if call in feedback:
            feedback[call] = result.get("next_feedback")
        runtime = _host_runtime()
        if hasattr(runtime, "compact"):
            runtime.compact(threshold_tokens=200_000)
        return {**state, "capability_calls": calls, "feedback": feedback,
                "history": state["history"] + [{"type": "capability_call", "step": calls, "capability": call, "input": state["next_args"], "output": result}]}
    if operation == "finish":
        from gui_harness.tasks.result import conclusion, save_workflow_record
        try:
            summary = ({"summary": state["handoff_instruction"] or state["terminal_reason"] or "GUI Agent timed out.",
                        "issues": "Conclusion skipped because the Runtime deadline expired."} if _expired(state) else
                       conclusion(task=config["task"], completed=state["status"] == "succeeded", steps_taken=state["capability_calls"],
                                 infeasible=state["status"] == "infeasible", status=state["status"], handoff_instruction=state["handoff_instruction"],
                                 img_path=_last_image_path(state["history"]), timeout_s=remaining, history=state["history"]))
        except Exception as exc:
            summary = {"summary": str(exc), "issues": None}
            if state["status"] == "succeeded":
                state = {**state, "status": "failed", "reason_code": "conclusion_error"}
        from openprogram.programs.gui_harness_bridge import _normalize_gui_result
        final = _normalize_gui_result({"task": config["task"], "status": state["status"], "reason_code": state["reason_code"],
                                      "summary": state["handoff_instruction"] if state["status"] == "infeasible" and state["handoff_instruction"] else summary.get("summary", ""),
                                      "issues": summary.get("issues"), "blocker": state["blocker"], "handoff_instruction": state["handoff_instruction"],
                                      "steps_taken": state["capability_calls"], "iterations": state["iterations"], "total_time": round(time.time() - state["start"], 2),
                                      "history": state["history"]})
        save_workflow_record(final, config["app_name"])
        return final
    raise ValueError("Unknown GUI operation")
