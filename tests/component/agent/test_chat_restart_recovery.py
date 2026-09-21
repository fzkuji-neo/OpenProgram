"""Ownerless chats continue through a new turn without replaying old effects."""
from openprogram.agent.dispatcher.types import TurnRequest
from openprogram.agent.production_driver import CanonicalAgentAdapter
from openprogram.execution.attempts import AttemptStore
from openprogram.execution.effects import EffectClassification, EffectStatus, EffectStore
import threading
from types import SimpleNamespace

import pytest
from tests.component.agent.test_chat_goal import runtime  # noqa: F401


def interrupted_chat(store, *, kind="tool.before", graceful=False):
    adapter = CanonicalAgentAdapter(store=store)
    admission = adapter.admit(
        TurnRequest("goal-chat", "finish existing task", "main", "web"),
        trusted_actor={}, user_message_id="original-user", assistant_message_id="original-reply",
        config_snapshot_ref="session:goal-chat",
    )
    attempts = AttemptStore(store)
    leased, reserved = attempts.lease(admission.execution_id, expected_version=admission.status_version,
                                     owner_id="abandoned-worker", ttl_seconds=30)
    active, _ = attempts.activate(leased.attempt_id, generation=leased.generation,
                                 expected_execution_version=reserved.status_version)
    effects = EffectStore(store)
    effect = effects.register(effect_id="unknown-write", execution_id=admission.execution_id,
        attempt_id=active.attempt_id, action_id="original-call",
        classification=EffectClassification.NONREPEATABLE, idempotency_key=None,
        metadata={"kind": kind, "payload": {"tool_name": "bash", "tool_call_id": "original-call"}})
    effects.mark_dispatched(effect.effect_id, expected_status=EffectStatus.PLANNED)
    if graceful:
        from openprogram.execution.restart import prepare_shutdown
        prepare_shutdown(SimpleNamespace(_execution_store=store, _execution_control=adapter.entry.control))
    adapter.entry.control.recover_owner_loss(admission.execution_id)
    return admission, effect


def test_explicit_goal_resume_can_inspect_unknown_effect_without_replaying_it(runtime):
    goals, chat, store = runtime
    admission, effect = interrupted_chat(store)
    # Stored older restart pauses remain supported by the public Resume action.
    goal = goals.load_goal("goal-chat")
    goal.update(status="paused_recoverable", phase="paused", pause_reason="worker_restart")
    goals.save_goal("goal-chat", goal)
    resumed = chat.resume("goal-chat")
    assert resumed["status"] == "active"
    observed = goals.goal_execution_state(resumed, "goal-chat")
    assert observed["can_start_new_turn"] is True
    assert observed["recovery_mode"] == "restricted_new_turn"
    assert EffectStore(store).get(effect.effect_id).status is EffectStatus.DISPATCHED
    assert len(store.list_for_session("goal-chat")) == 1
    assert store.get_execution(admission.execution_id).current_attempt_id is None


@pytest.mark.parametrize("accepted_only", [False, True])
def test_explicit_resume_supersedes_unconfirmed_cancel_without_claiming_effect_cancelled(runtime, accepted_only):
    import asyncio
    from openprogram.execution import default_control_service
    goals, chat, store = runtime
    admission, effect = interrupted_chat(store)
    current = store.get_execution(admission.execution_id)
    if accepted_only:
        from openprogram.execution.model import CommandKind
        store.accept_command(command_id="user-stop", execution_id=current.execution_id,
            expected_version=current.status_version, actor={"surface": "web"},
            kind=CommandKind.CANCEL, payload={"reason_code": "cancel.user"})
    else:
        asyncio.run(default_control_service().request_cancel(
            command_id="user-stop", execution_id=current.execution_id,
            expected_version=current.status_version, actor={"surface": "web"}, reason_code="cancel.user"))
    goal = goals.load_goal("goal-chat")
    goal.update(status="paused", pause_reason="user", stop_requested=True)
    goals.save_goal("goal-chat", goal)
    assert goals.goal_execution_state(goal, "goal-chat")["can_start_new_turn"] is True
    resumed = chat.resume("goal-chat")
    assert resumed["status"] == "active"
    assert store.get_command("user-stop").status.value == "rejected"
    assert EffectStore(store).get(effect.effect_id).status is EffectStatus.DISPATCHED


@pytest.mark.parametrize("has_goal", [True, False])
@pytest.mark.parametrize("fault", [None, "after_admission", "goal_publication", "startup_after_admission", "shutdown_pause"])
def test_restart_admits_one_new_turn_with_original_authority(runtime, monkeypatch, has_goal, fault):
    from openprogram.execution import default_control_service
    from openprogram.execution.restart import reconcile
    from openprogram.execution.model import ExecutionStatus
    goals, chat, store = runtime
    monkeypatch.setattr("openprogram.execution.restart.window_seconds", lambda: -1)
    if not has_goal:
        goals.save_goal("goal-chat", {"version": goals.load_goal("goal-chat")["version"], "status": "cleared"})
    calls = []
    done = threading.Event()
    def run(*, request, cancel_event):
        calls.append(request)
        if has_goal:
            chat.update(request.session_id, "complete", expected=chat.current_identity())
        return SimpleNamespace(failed=False)
    real_activate = CanonicalAgentAdapter.activate
    async def activate(self, admission, **kwargs):
        try:
            return await real_activate(self, admission, **kwargs)
        finally:
            done.set()
    monkeypatch.setattr(CanonicalAgentAdapter, "activate", activate)
    monkeypatch.setattr("openprogram.agent.production_driver.CanonicalAgentAdapter",
                        lambda **kw: CanonicalAgentAdapter(turn_runner=run, **kw))
    admission, effect = interrupted_chat(store, graceful=fault == "shutdown_pause")
    real_admit = store.admit_execution
    failures = [fault in {"after_admission", "startup_after_admission"}]
    def admit(**kwargs):
        result = real_admit(**kwargs)
        if failures and failures.pop():
            raise RuntimeError("process stopped after durable admission")
        return result
    monkeypatch.setattr(store, "admit_execution", admit)
    real_publish = chat.publish
    publish_failures = [fault == "goal_publication" and has_goal]
    def publish(sid, goal):
        if goal.get("phase") == "queued" and publish_failures and publish_failures.pop():
            raise RuntimeError("Goal publication unavailable")
        return real_publish(sid, goal)
    monkeypatch.setattr(chat, "publish", publish)
    runner = SimpleNamespace(_execution_store=store, _execution_control=default_control_service())
    reconcile(runner)
    if fault == "startup_after_admission":
        monkeypatch.setattr("openprogram.execution.process_owner.process_owner_may_be_alive", lambda *a, **kw: False)
        service = default_control_service()
        service.recover_startup()
        # Production startup supplies this same canonical activation owner.
        service.activator = CanonicalAgentAdapter(store=store, turn_runner=run).driver.activate
    reconcile(runner)
    if fault == "startup_after_admission":
        from tests.support.waiting import wait_until
        assert wait_until(lambda: any(e.execution_id != admission.execution_id and e.status is ExecutionStatus.COMPLETED
                                     for e in store.list_for_session("goal-chat")), timeout=5)
    else:
        assert done.wait(5)
    reconcile(runner)
    assert len(calls) == 1
    assert len(store.list_for_session("goal-chat")) == 2
    previous = store.get_execution(admission.execution_id)
    assert previous.status is ExecutionStatus.INTERRUPTED
    assert EffectStore(store).get(effect.effect_id).status is EffectStatus.DISPATCHED
    latest = next(e for e in store.list_for_session("goal-chat") if e.execution_id != admission.execution_id)
    assert store.get_execution_input(latest.execution_id).trusted_actor == store.get_execution_input(admission.execution_id).trusted_actor
    assert calls[0].history_override is None
    assert "Inspect actual state" in calls[0].user_text


@pytest.mark.parametrize("change", ["pause", "cancel", "revision", "budget", "turn_budget", "disabled", "expired", "child"])
def test_restart_preserves_user_controls_limits_and_live_children(runtime, monkeypatch, change):
    from openprogram.execution import default_control_service
    from openprogram.execution.restart import reconcile
    goals, chat, store = runtime
    monkeypatch.setattr("openprogram.execution.restart.window_seconds", lambda: 10 if change == "expired" else -1)
    admission, _ = interrupted_chat(store)
    goal = goals.load_goal("goal-chat")
    if change == "pause":
        goal.update(status="paused", pause_reason="user")
    elif change == "cancel":
        goal.update(status="cancelled", stop_requested=True)
    elif change == "revision":
        goal["revision"] += 1
    elif change == "budget":
        goal["budget"]["max_tokens"] = 1
        goal["usage"]["total_tokens"] = 2
    elif change == "turn_budget":
        goal["budget"]["max_turns"] = 1
    elif change == "disabled":
        monkeypatch.setattr("openprogram.execution.restart.window_seconds", lambda: 0)
    elif change == "expired":
        event = next(e for e in store.list_events(admission.execution_id) if e.kind == "execution.restart.requested")
        monkeypatch.setattr("openprogram.execution.restart.time", lambda: event.payload["resume_before"] + 1)
    elif change == "child":
        old = store.get_execution(admission.execution_id)
        store.create_execution(session_id=old.session_id, revision_id=old.revision_id,
                               parent_execution_id=old.execution_id)
    goals.save_goal("goal-chat", goal)
    before = len(store.list_for_session("goal-chat"))
    reconcile(SimpleNamespace(_execution_store=store, _execution_control=default_control_service()))
    assert len(store.list_for_session("goal-chat")) == before


def test_durable_admission_key_rejects_changed_authority(runtime):
    from openprogram.execution.store import ExecutionConflict
    goals, chat, store = runtime
    adapter = CanonicalAgentAdapter(store=store)
    payload = adapter.payload_for(TurnRequest("goal-chat", "task", "main", "web"))
    kwargs = dict(session_id="goal-chat", payload=payload, trusted_actor={"principal_id": "original"},
                  user_message_id="user", assistant_message_id="reply", config_snapshot_ref="config",
                  admission_key="one-continuation")
    first = adapter.admit_payload(**kwargs)
    second = adapter.admit_payload(**kwargs)
    assert first.execution_id == second.execution_id
    with pytest.raises(ExecutionConflict, match="different immutable input"):
        adapter.admit_payload(**dict(kwargs, trusted_actor={"principal_id": "different"}))
    assert len(store.list_for_session("goal-chat")) == 1


@pytest.mark.parametrize("failure", ["continuation_contract_mismatch", "credentials_unavailable"])
def test_only_incompatible_checkpoint_falls_back_to_new_chat(runtime, monkeypatch, failure):
    from openprogram.agent.continuation import AgentCheckpointError
    from openprogram.execution import default_control_service
    from openprogram.execution.restart import reconcile
    goals, chat, store = runtime
    monkeypatch.setattr("openprogram.execution.restart.window_seconds", lambda: -1)
    admission, _ = interrupted_chat(store, kind="provider.before")
    service = default_control_service()
    async def incompatible(*args):
        raise AgentCheckpointError(failure, "saved runtime differs")
    service.activator = incompatible
    calls = []
    done = threading.Event()
    def run(*, request, cancel_event):
        calls.append(request)
        chat.update(request.session_id, "complete", expected=chat.current_identity())
        return SimpleNamespace(failed=False)
    real_activate = CanonicalAgentAdapter.activate
    async def activate(self, admitted, **kwargs):
        try:
            return await real_activate(self, admitted, **kwargs)
        finally:
            done.set()
    monkeypatch.setattr(CanonicalAgentAdapter, "activate", activate)
    monkeypatch.setattr("openprogram.agent.production_driver.CanonicalAgentAdapter",
                        lambda **kw: CanonicalAgentAdapter(turn_runner=run, **kw))
    runner = SimpleNamespace(_execution_store=store, _execution_control=service)
    for _ in range(3):
        reconcile(runner)
    if failure == "continuation_contract_mismatch":
        assert done.wait(5)
        assert len(calls) == 1
        assert len(store.list_for_session("goal-chat")) == 2
    else:
        assert not calls
        assert len(store.list_for_session("goal-chat")) == 1
        assert store.get_execution(admission.execution_id).status.value == "paused"
