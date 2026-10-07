"""Platform tasks."""
from __future__ import annotations
from importlib import import_module

# Bind to this workflow package, including an isolated published snapshot.
state = import_module("..", __package__)


def _run_browser_task(
    *,
    task: str,
    url: str,
    max_steps: int,
    max_seconds: int,
    runtime,
    binding_id: str = "",
) -> dict:
    if runtime is None:
        raise ValueError("browser task requires a runtime argument")
    if not (task or "").strip():
        raise ValueError("task must not be empty")
    controller = state._new_controller()
    controller.initial_url = url or ""
    controller.binding_id = binding_id
    controller.max_steps = max(1, min(int(max_steps), 100))
    result: dict
    pending_screenshot_result: state.Any = None
    from .planner_failures import PlannerFailures, rejected_tool
    failures = PlannerFailures()
    try:
        if url and not state._is_http_url(url):
            result = controller.final_result(
                summary="Initial URL must use http or https.",
                reason_code="unsupported_url",
            )
        else:
            from openprogram.agent import surface_context
            if not controller.binding_id and surface_context.tool_enabled(surface_context.current()):
                controller.binding_id = surface_context.resolve_binding("")
                controller.initial_url = ""
            # deferred browser tool loop; runtime owns restricted AgentTool execution
            call_limit = min(controller.max_steps * 3 + 3, 303)
            deadline = state.time.monotonic() + max(1, min(int(max_seconds), 1800))
            last_summary = ""
            result = {}
            observation = controller.execute(action="observe")
            if not isinstance(observation, dict) or "frame_id" not in observation:
                result = controller.final_result(
                    summary="The bound Page could not be observed.",
                    reason_code=(
                        observation.get("reason_code", "page_unavailable")
                        if isinstance(observation, dict)
                        else "page_unavailable"
                    ),
                )
                call_limit = 0
            prior_result: state.Any = None
            pending_screenshot: dict[str, str] | None = None
            action_tool = controller.tool_for_actions([
                "navigate", "click", "type", "press", "scroll", "hover",
                "select", "upload", "stop", "screenshot", "verify",
            ])
            for call_index in range(call_limit):
                remaining = deadline - state.time.monotonic()
                if remaining <= 0:
                    result = controller.final_result(
                        summary="Browser task exceeded its wall-clock limit.",
                        reason_code="timeout",
                    )
                    break
                instruction = state._step_prompt(
                    task.strip(),
                    url,
                    observation,
                    state._result_for_prompt(prior_result),
                )
                content: list[dict[str, state.Any]] = [
                    {"type": "text", "text": instruction},
                ]
                if pending_screenshot is not None:
                    content.append(pending_screenshot)
                    pending_screenshot = None
                image_was_sent = len(content) == 2
                sent_screenshot_result = (
                    pending_screenshot_result if image_was_sent else None
                )
                if image_was_sent:
                    pending_screenshot_result = None
                action_seq_before = getattr(controller, "_action_seq", 0)
                try:
                    reply = state.agent(
                        content,
                        tools=[action_tool],
                        tool_choice={"type": "function", "name": "browser_page"},
                        parallel_tool_calls=False,
                        max_iterations=1,
                        stop_after_tool_round=True,
                        timeout_s=max(1, remaining),
                        execution_kind="browser_agent",
                        runtime=runtime,
                        return_raw=True,
                    )
                finally:
                    if image_was_sent:
                        try:
                            controller.revoke_screenshot()
                        finally:
                            state._release_screenshot_payload(
                                content, sent_screenshot_result,
                            )
                            if (
                                getattr(controller, "_planner_screenshot_result", None)
                                is sent_screenshot_result
                            ):
                                controller._planner_screenshot_result = None
                action_executed = (
                    getattr(controller, "_action_seq", action_seq_before)
                    != action_seq_before
                )
                summary = (
                    reply if isinstance(reply, str)
                    else reply.get("summary") if isinstance(reply, dict)
                    else None
                )
                if isinstance(summary, str) and summary.strip():
                    last_summary = summary.strip()
                result = controller.final_result(summary=last_summary)
                if result.get("status") == "succeeded":
                    result = controller.final_result(
                        summary="Browser task completed and verified."
                    )
                    break
                rejected = rejected_tool(runtime) if not action_executed else None
                if rejected:
                    result = controller.final_result(reason_code=rejected["reason_code"], summary=rejected["message"])
                    break
                prior_result = (
                    controller._last_result
                    if action_executed
                    else {"ok": False, "reason_code": "tool_not_executed"}
                )
                stalled = failures.record(prior_result, observation.get("frame_id"))
                if stalled or getattr(controller, "_terminal_reason", ""):
                    failure = stalled or {"reason_code": controller._terminal_reason,
                                          "summary": str((prior_result or {}).get("message") or controller._terminal_reason)}
                    result = controller.final_result(**failure)
                    break
                if action_executed and getattr(controller, "_last_action", "") == "screenshot":
                    pending_screenshot_result = prior_result
                    pending_screenshot = state._screenshot_image_block(prior_result)
                if controller._frame is None:
                    observation = controller.execute(action="observe")
                    if not isinstance(observation, dict) or "frame_id" not in observation:
                        result = controller.final_result(
                            summary="The bound Page could not be observed after the action.",
                            reason_code=(
                                observation.get("reason_code", "page_unavailable")
                                if isinstance(observation, dict)
                                else "page_unavailable"
                            ),
                        )
                        break
                else:
                    observation = controller._frame
            else:
                if call_limit:
                    result = controller.final_result(
                        summary=last_summary or (
                            "Browser task ended without successful verification."
                        )
                    )
    except (state.CancelledError, state.ExecInterrupt, state.asyncio.CancelledError) as exc:
        result = controller.final_result(
            summary=str(exc) or "Browser task cancelled.",
            reason_code="cancelled",
        )
    except Exception as exc:
        name = type(exc).__name__.lower()
        message = str(exc).lower()
        reason = (
            "timeout" if "timeout" in name or "timed out" in message
            else getattr(controller, "_terminal_reason", "") or "tool_error"
        )
        result = controller.final_result(summary=str(exc), reason_code=reason)
    finally:
        try:
            unreleased_screenshot = (
                pending_screenshot_result
                or getattr(controller, "_planner_screenshot_result", None)
            )
            if not (
                isinstance(unreleased_screenshot, state.ToolReturn)
                and unreleased_screenshot.images
            ):
                current_result = getattr(controller, "_last_result", None)
                unreleased_screenshot = (
                    current_result
                    if isinstance(current_result, state.ToolReturn)
                    and current_result.images
                    else None
                )
            if unreleased_screenshot is not None:
                try:
                    controller.revoke_screenshot()
                finally:
                    state._release_screenshot_payload([], unreleased_screenshot)
                    if hasattr(controller, "_planner_screenshot_result"):
                        controller._planner_screenshot_result = None
        finally:
            cleanup_error = controller.close()
    if cleanup_error:
        result["cleanup_error"] = cleanup_error
        result["summary"] = (
            result.get("summary", "") + f" Cleanup warning: {cleanup_error}"
        ).strip()
        if result.get("status") == "succeeded":
            result["status"] = "failed"
            result["reason_code"] = "cleanup_failed"
            result.pop("observation", None)
            result["completion_evidence"] = []
    return result
