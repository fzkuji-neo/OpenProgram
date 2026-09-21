from __future__ import annotations

import asyncio
import threading
from types import SimpleNamespace

import pytest


@pytest.fixture
def runtime(tmp_path, monkeypatch):
    from openprogram.agent.session_db import SessionDB
    from openprogram.execution import ExecutionStore, AttemptStore
    from openprogram.execution.driver import DriverRegistry
    from openprogram.execution.control import RuntimeControlService
    import openprogram.programs.workflow.goal as goals
    from openprogram.programs.workflow.goal import chat
    db = SessionDB(tmp_path / "sessions")
    db.create_session("goal-chat", "main")
    store = ExecutionStore(tmp_path / "executions.db")
    control = RuntimeControlService(store, AttemptStore(store), DriverRegistry())
    monkeypatch.setattr("openprogram.execution.default_store", lambda: store)
    monkeypatch.setattr("openprogram.execution.default_control_service", lambda: control)
    monkeypatch.setattr("openprogram.agent.session_db.default_db", lambda: db)
    monkeypatch.setattr(goals, "_db", lambda: db)
    monkeypatch.setattr(goals, "_emit_goal_update", lambda *a, **k: None)
    monkeypatch.setattr(goals, "goal_usage", lambda *a: {"total_tokens": 0, "cost_usd": 0, "cost_known": True})
    chat.create("goal-chat", "finish the task")
    yield goals, chat, store
    db.close()


@pytest.mark.parametrize("failure", [None, "notification", "admission", "checkpoint"])
@pytest.mark.parametrize("source", ["web", "tui"])
def test_completed_chat_continues_once_with_original_authority(runtime, monkeypatch, failure, source):
    from openprogram.agent.production_driver import CanonicalAgentAdapter
    from openprogram.agent.dispatcher.types import TurnRequest
    goals, chat, store = runtime
    # Disabling restart recovery must not disable live, same-process turns.
    monkeypatch.setattr("openprogram.execution.restart.window_seconds", lambda: 0)
    goal = goals.load_goal("goal-chat")
    goal["turns_used"] = 150
    goals.save_goal("goal-chat", goal)
    calls = []
    finished = threading.Event()
    real_notify = chat.after_terminal
    failures = [failure == "notification"]
    def notify(*args):
        if failures and failures.pop():
            raise goals.GoalConflictError("simulated concurrent Goal mutation")
        return real_notify(*args)
    monkeypatch.setattr(chat, "after_terminal", notify)
    real_admit = chat.admit
    admission_failures = [failure == "admission"]
    def admit(entry, **kwargs):
        if kwargs["turn_payload"].get("request", {}).get("goal_trigger") and admission_failures and admission_failures.pop():
            raise goals.GoalConflictError("simulated temporary admission lock contention")
        return real_admit(entry, **kwargs)
    monkeypatch.setattr(chat, "admit", admit)
    real_publish = chat.publish
    checkpoint_failures = [failure == "checkpoint"]
    def publish(sid, goal):
        if goal.get("phase") == "working" and goal.get("active_started_at") is None and checkpoint_failures and checkpoint_failures.pop():
            raise goals.GoalConflictError("simulated elapsed checkpoint failure")
        return real_publish(sid, goal)
    monkeypatch.setattr(chat, "publish", publish)

    def runner(*, request, cancel_event):
        calls.append(request)
        if len(calls) == 2:
            goals.apply_goal_action(request.session_id, "pause")
        return SimpleNamespace(failed=False)

    real_activate = CanonicalAgentAdapter.activate
    async def activate(self, admission, **kwargs):
        result = await real_activate(self, admission, **kwargs)
        goal = goals.load_goal("goal-chat")
        if goal["status"] == "paused" and goal.get("accounted_execution_id") == admission.execution_id == goal["execution_id"]:
            finished.set()
        return result
    monkeypatch.setattr(CanonicalAgentAdapter, "activate", activate)

    # Keep the real admission, driver, control and continuation; replace only
    # the provider-facing turn runner for the automatically admitted turn.
    monkeypatch.setattr("openprogram.agent.production_driver.CanonicalAgentAdapter",
                        lambda **kw: CanonicalAgentAdapter(turn_runner=runner, **kw))
    adapter = CanonicalAgentAdapter(turn_runner=runner)
    authority = {"speaker_kind": "owner", "speaker_id": "owner/local",
                 "principal_id": "owner/install/0123456789abcdef", "authority_tier": "owner",
                 "interaction": "interactive"}
    request = TurnRequest("goal-chat", "work", "main", source, permission_mode="ask",
                          tools_override=["read", "update_goal"], **authority)
    admission = adapter.admit(request, trusted_actor=authority, user_message_id="u1",
                              assistant_message_id="u1_reply", config_snapshot_ref="session:goal-chat")
    asyncio.run(adapter.activate(admission))
    assert finished.wait(5), goals.load_goal("goal-chat")
    assert len(calls) == 2
    assert calls[1].tools_override == ["read", "update_goal"]
    assert calls[1].principal_id == authority["principal_id"]
    assert calls[1].source == source
    assert calls[1].goal_trigger is True
    from openprogram.agent.run_control import current_token
    from openprogram.execution.model import ExecutionStatus
    assert store.get_execution(admission.execution_id).status == ExecutionStatus.COMPLETED
    assert current_token("goal-chat", execution_id=admission.execution_id) is None
    chat.after_terminal(store, store.get_execution(admission.execution_id))
    assert len(calls) == 2


@pytest.mark.parametrize("exhausted", [False, True])
def test_terminal_retry_settles_pending_usage_before_continuing(runtime, monkeypatch, exhausted):
    from openprogram.execution.model import ExecutionStatus
    goals, chat, store = runtime
    goal = goals.load_goal("goal-chat")
    goal["execution_id"] = "interrupted-ledger"
    goals.save_goal("goal-chat", goal)
    execution = SimpleNamespace(execution_id="interrupted-ledger", session_id="goal-chat",
                                status=ExecutionStatus.COMPLETED)
    monkeypatch.setattr(store, "get_agent_turn_input", lambda _: {"kind": "chat", "request": {"source": "web"}})
    continuations = []
    monkeypatch.setattr(chat, "start_next", lambda *a, **kw: continuations.append(a))
    monkeypatch.setattr(goals, "goal_usage", lambda *a, **kw: {"available": False})
    with pytest.raises(goals.GoalStateUnavailable):
        chat.after_terminal(store, execution)
    pending = goals.load_goal("goal-chat")["usage_pending_until"]
    assert not continuations
    reads = []
    def recovered(*args, **kwargs):
        reads.append(kwargs.get("until", args[2] if len(args) > 2 else None))
        return {"available": True, "total_tokens": 100, "cost_usd": 1, "cost_known": True}
    monkeypatch.setattr(goals, "goal_usage", recovered)
    monkeypatch.setattr(goals, "budget_exhausted", lambda goal: "cost budget exhausted" if exhausted else None)
    chat.after_terminal(store, execution)
    settled = goals.load_goal("goal-chat")
    assert reads == [pending]
    assert settled["usage"]["total_tokens"] == 100
    assert settled["usage"]["cost_usd"] == 1
    assert settled["turns_used"] == 1
    assert "usage_pending_until" not in settled
    assert len(continuations) == (0 if exhausted else 1)
    assert settled["status"] == ("budget_exhausted" if exhausted else "active")


def test_edit_keeps_terminal_usage_without_continuing_old_revision(runtime, monkeypatch):
    from openprogram.agent.production_driver import CanonicalAgentAdapter
    from openprogram.agent.dispatcher.types import TurnRequest
    goals, chat, store = runtime
    total = [0]
    monkeypatch.setattr(goals, "goal_usage", lambda *a: {"total_tokens": total[0], "cost_usd": 0, "cost_known": True})
    monkeypatch.setattr(goals, "request_goal_stop", lambda *a: None)
    continuations = []
    monkeypatch.setattr(chat, "start_next", lambda *a, **k: continuations.append(a))
    def runner(**kw):
        total[0] = 40
        goals.apply_goal_action("goal-chat", "edit", prompt="revised task")
        total[0] = 50
        return SimpleNamespace(failed=False)
    adapter = CanonicalAgentAdapter(turn_runner=runner)
    admission = adapter.admit(TurnRequest("goal-chat", "work", "main", "web"),
                              trusted_actor={}, user_message_id="u1", config_snapshot_ref="session:goal-chat")
    asyncio.run(adapter.activate(admission))
    goal = goals.load_goal("goal-chat")
    assert goal["usage"]["total_tokens"] == 50
    assert goal["status"] == "paused"
    assert not continuations
    assert chat.resume("goal-chat")["usage"]["total_tokens"] == 50


def test_failed_chat_stops_goal_without_continuation(runtime, monkeypatch):
    from openprogram.agent.production_driver import CanonicalAgentAdapter
    from openprogram.agent.dispatcher.types import TurnRequest
    goals, chat, store = runtime
    continuations = []
    monkeypatch.setattr(chat, "start_next", lambda *a, **k: continuations.append(a))
    adapter = CanonicalAgentAdapter(turn_runner=lambda **kw: SimpleNamespace(failed=True))
    admission = adapter.admit(TurnRequest("goal-chat", "work", "main", "web"),
                              trusted_actor={}, user_message_id="u1", config_snapshot_ref="session:goal-chat")
    asyncio.run(adapter.activate(admission))
    assert goals.load_goal("goal-chat")["status"] == "paused_recoverable"
    assert not continuations


@pytest.mark.parametrize("action", ["continue", "pause", "clear", "disabled", "expired"])
@pytest.mark.parametrize("abrupt", [False, True])
@pytest.mark.parametrize("creation", ["before_turn", "mid_turn", "legacy"])
def test_shutdown_completion_is_durable_and_replays_goal_once(runtime, monkeypatch, action, abrupt, creation):
    from openprogram.agent.production_driver import CanonicalAgentAdapter
    from openprogram.agent.dispatcher.types import TurnRequest
    from openprogram.execution import restart, AttemptStore
    from openprogram.execution.control import RuntimeControlService
    from openprogram.execution.driver import DriverRegistry

    goals, chat, store = runtime
    if creation == "mid_turn":
        goals.apply_goal_action("goal-chat", "clear")
    stopping = [False]
    restarted = [False]
    now = [restart.time()]
    monkeypatch.setattr("openprogram.agent.run_control.is_worker_stopping", lambda: stopping[0])
    monkeypatch.setattr(restart, "time", lambda: now[0])
    monkeypatch.setattr(restart, "window_seconds", lambda: 7200 if action == "expired" else -1)
    calls, durable_before_notification = [], []
    done = threading.Event()
    real_notify = chat.after_terminal

    def notify(executions, execution):
        durable_before_notification.append(bool(executions.list_finish_repairs()))
        if abrupt and not restarted[0]:
            raise RuntimeError("process disappeared after terminal commit, before Goal notification")
        result = real_notify(executions, execution)
        goal = goals.load_goal("goal-chat")
        if goal["status"] == "paused" and goal.get("accounted_execution_id") == execution.execution_id:
            done.set()
        return result

    monkeypatch.setattr(chat, "after_terminal", notify)

    def runner(*, request, cancel_event):
        calls.append(request)
        if len(calls) == 1:
            if creation == "mid_turn":
                chat.create(request.session_id, "finish the task")
            stopping[0] = not abrupt
        else:
            goals.apply_goal_action(request.session_id, "pause")
        return SimpleNamespace(failed=False)

    monkeypatch.setattr("openprogram.agent.production_driver.CanonicalAgentAdapter",
                        lambda **kw: CanonicalAgentAdapter(turn_runner=runner, **kw))
    adapter = CanonicalAgentAdapter(turn_runner=runner)
    # Simulate losing the process-local retry worker. Durable replay must suffice.
    monkeypatch.setattr(adapter.driver, "_schedule_finish_retry_worker", lambda: None)
    request = TurnRequest("goal-chat", "work", "main", "web", permission_mode="ask",
                          tools_override=["read", "update_goal"])
    admission = adapter.admit(request, trusted_actor={}, user_message_id="shutdown-u1",
                              config_snapshot_ref="session:goal-chat")
    asyncio.run(adapter.activate(admission))
    assert durable_before_notification[0] is True
    assert store.get_execution(admission.execution_id).status.value == "completed"
    assert goals.load_goal("goal-chat")["status"] == "active"
    assert store.list_finish_repairs()
    assert len(calls) == 1
    if creation == "legacy":
        saved = goals.load_goal("goal-chat")
        saved.pop("continuation_policy", None)
        saved.pop("continuation_restart", None)
        goals.save_goal("goal-chat", saved)

    stopping[0] = False
    restarted[0] = True
    now[0] = store.get_execution(admission.execution_id).terminal_at
    if abrupt:
        from openprogram.execution import process_owner
        new_process = dict(process_owner.current_process_owner(), start="restarted-test-process")
        monkeypatch.setattr(process_owner, "current_process_owner", lambda: dict(new_process))
    if action in {"pause", "clear"}:
        goals.apply_goal_action("goal-chat", action)
    elif action == "disabled":
        monkeypatch.setattr(restart, "window_seconds", lambda: 0)
    elif action == "expired":
        now[0] += 7201
    fresh = RuntimeControlService(store, AttemptStore(store), DriverRegistry())
    fresh.replay_finish_repairs()
    continued = action == "continue" and creation != "legacy"
    if continued:
        assert done.wait(5), goals.load_goal("goal-chat")
        assert len(calls) == 2
        assert calls[1].tools_override == request.tools_override
        assert calls[1].permission_mode == "ask"
    else:
        assert len(calls) == 1
        assert goals.load_goal("goal-chat")["status"] in {"paused", "paused_recoverable", "cancelled"}
    fresh.replay_finish_repairs()
    assert len(calls) == (2 if continued else 1)
    # User pause now ends the fixture's work instead of bypassing completion
    # verification. Its cancel receipt may settle after Goal notification.
    from tests.support.waiting import wait_until
    assert wait_until(lambda: not store.list_finish_repairs(), timeout=5)
    if creation == "legacy" and action == "continue":
        # An explicit owner resume upgrades old data and remains usable.
        resumed = chat.resume("goal-chat")
        chat.start_next(store, admission.execution_id, expected=chat.identity(resumed))
        assert done.wait(5), goals.load_goal("goal-chat")
        assert len(calls) == 2
