"""Eligibility for abandoning an ownerless chat frame, never its external effects."""
from __future__ import annotations

from .conversation_scope import conversation_execution_scope
from .model import CommandKind, CommandStatus, ExecutionStatus, TERMINAL_EXECUTION_STATUSES
from .waits import DurableWaitStore


def recovery_state(store, execution, *, allow_cancel: bool = False) -> dict:
    records, parents = conversation_execution_scope(store, execution.session_id)
    descendants = []
    for child in records:
        if child.status in TERMINAL_EXECUTION_STATUSES or child.execution_id == execution.execution_id:
            continue
        parent = parents.get(child.execution_id)
        seen = {child.execution_id}
        while parent:
            if parent in seen:
                raise ValueError("Cyclic conversation execution ancestry")
            seen.add(parent)
            if parent == execution.execution_id:
                descendants.append(child.execution_id)
                break
            parent = parents.get(parent)
    state = {"active_children": descendants, "can_start_new_turn": False,
             "recovery_mode": None, "recovery_reason": None}
    if descendants:
        return dict(state, recovery_reason="active_children")
    if execution.current_attempt_id:
        return dict(state, recovery_reason="active_owner")
    if DurableWaitStore(store).list_open(execution_id=execution.execution_id):
        return dict(state, recovery_reason="pending_wait")
    pending = store.list_commands(execution.execution_id,
                                 statuses=(CommandStatus.ACCEPTED, CommandStatus.APPLYING))
    if any(not allow_cancel or command.kind is not CommandKind.CANCEL for command in pending):
        return dict(state, recovery_reason="pending_control")
    if execution.status in TERMINAL_EXECUTION_STATUSES:
        from .effects import EffectStore
        restricted = bool(EffectStore(store).list_unresolved(execution.execution_id))
        return dict(state, can_start_new_turn=True,
                    recovery_mode="restricted_new_turn" if restricted else "new_turn")
    payload = store.get_agent_turn_input(execution.execution_id)
    if (not payload or payload.get("kind") != "chat"
            or payload.get("request", {}).get("interaction") in {"spawn", "merge"}):
        return dict(state, recovery_reason="not_ordinary_chat")
    if (execution.status is ExecutionStatus.RECONCILIATION_REQUIRED
            and execution.reason_code == "effect_reconciliation"):
        return dict(state, can_start_new_turn=True, recovery_mode="restricted_new_turn")
    if (execution.status is ExecutionStatus.PAUSED
            and execution.reason_code == "continuation_contract_mismatch"):
        return dict(state, can_start_new_turn=True, recovery_mode="new_turn")
    if allow_cancel and execution.status is ExecutionStatus.CANCELLING:
        from .effects import EffectStore
        if EffectStore(store).list_unresolved(execution.execution_id):
            return dict(state, can_start_new_turn=True, recovery_mode="restricted_new_turn")
    return dict(state, recovery_reason="checkpoint_or_control_required")


def start_recovery_turn(store, execution, event):
    """Consume one saved restart intent through ordinary immutable admission."""
    import asyncio
    import threading
    from openprogram.agent.production_driver import CanonicalAgentAdapter
    from openprogram.events import emit_ws_frame
    from openprogram.programs.workflow.goal import chat
    import openprogram.programs.workflow.goal as goals
    from . import restart
    from .foreground import active_foreground_task

    data = event.payload
    source = store.get_execution_input(execution.execution_id)
    payload = store.get_agent_turn_input(execution.execution_id)
    if source is None or not payload or payload.get("kind") != "chat":
        return "unsupported_input"
    request = dict(payload["request"])
    if (request.get("interaction") not in {None, "interactive"}
            or request.get("source") not in {"web", "tui", "acp"}):
        return "noninteractive"
    key = f"restart:{execution.execution_id}:{event.sequence}"
    new_id = store.admission_execution_id(execution.session_id, key)
    with chat.locked(execution.session_id):
        current = store.get_execution(execution.execution_id)
        closed = (current.status is ExecutionStatus.INTERRUPTED
                  and current.reason_code == "restart_new_turn"
                  and current.status_version == data["expected_version"] + 1)
        if current.status_version != data["expected_version"] and not closed:
            return "execution_changed"
        if (restart.window_seconds() == 0 or restart.time() < data["interrupted_at"]
                or (data["resume_before"] is not None and restart.time() > data["resume_before"])):
            return "expired"
        state = recovery_state(store, current)
        if not state["can_start_new_turn"]:
            return None
        foreground = active_foreground_task(store, execution.session_id)
        if foreground and foreground["execution_id"] != new_id:
            return "superseded"
        goal = goals.load_goal(execution.session_id)
        expected = request.get("goal_context")
        if not expected and goal:
            created = goal.get("creation_execution_context") or {}
            if (created.get("execution_id") == execution.execution_id
                    and {key: created.get(key) for key in ("goal_id", "revision", "run_id")} == chat.identity(goal)):
                expected = chat.identity(goal)
                request["goal_context"] = expected
        if expected:
            if (not goal or goal.get("status") != "active" or goal.get("stop_requested")
                    or chat.identity(goal) != expected
                    or goal.get("execution_id") not in {execution.execution_id, new_id}):
                return "goal_changed"
            if goal.get("execution_id") == execution.execution_id:
                if goal.get("usage_pending_until") is not None:
                    goals.accumulate_goal_usage(execution.session_id, goal, until=goal["usage_pending_until"])
                if goal.get("accounted_execution_id") != execution.execution_id:
                    goals.accumulate_goal_usage(execution.session_id, goal)
                    goals.checkpoint_active_elapsed(goal, stop=True)
                    goal["turns_used"] = int(goal.get("turns_used") or 0) + 1
                    goal["run_turns"] = int(goal.get("run_turns") or 0) + 1
                    goal["accounted_execution_id"] = execution.execution_id
                exhausted = goals.budget_exhausted(goal)
                if exhausted:
                    goal.update(status="budget_exhausted", phase="terminal", last_reason=exhausted)
                chat.publish(execution.session_id, goal)
                if goal.get("usage_pending_until") is not None:
                    raise goals.GoalStateUnavailable("Interrupted Goal usage settlement is pending")
                if exhausted:
                    return "budget_exhausted"
            request.update(goal_trigger=True, goal_previous_execution=execution.execution_id)
        elif goal and goal.get("execution_mode") == "chat" and goal.get("status") == "active":
            # A new/revised Goal is not authority to continue the abandoned task.
            return "goal_changed"
        request.update(
            user_text="Continue the interrupted task using saved conversation history. Inspect actual state before acting. Prior tool results may be unknown; do not assume failure or repeat an external action without confirmation.",
            user_msg_id=new_id + "_user", user_already_persisted=False,
            history_override=None, attachments=None, surface_context=None, spawn_caller=None,
        )
        request.pop("branch_from", None)
        adapter = CanonicalAgentAdapter(store=store, event_sink=emit_ws_frame)
        admission = adapter.admit_payload(
            session_id=execution.session_id, payload=dict(payload, request=request),
            trusted_actor=source.trusted_actor, user_message_id=request["user_msg_id"],
            assistant_message_id=request["user_msg_id"] + "_reply",
            config_snapshot_ref=source.config_snapshot_ref, admission_key=key,
            recovery_from=(current.execution_id, current.status_version),
        )

    def activate():
        latest = store.get_execution(admission.execution_id)
        if latest.status is not ExecutionStatus.QUEUED or latest.current_attempt_id:
            return  # Startup's checkpoint consumer owns already recovered admissions.
        try:
            asyncio.run(adapter.activate(admission))
        except Exception:
            # A concurrent activation/CAS must never fail the winning owner.
            latest = store.get_execution(admission.execution_id)
            if latest.status is ExecutionStatus.QUEUED and latest.current_attempt_id is None:
                adapter.fail_admission(admission, reason_code="restart_activation_failed")
    threading.Thread(target=activate, name="chat-restart", daemon=True).start()
    return "new_turn_admitted"
