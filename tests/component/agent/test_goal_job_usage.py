"""Goal attribution survives canonical Job admission and real activation."""
from __future__ import annotations

import asyncio
import pytest

from tests.component.agent.async_job_support import store_fixture as store_fixture
from tests.component.agent.test_goal_request_budget import transport as transport, consume, bounded_model


@pytest.mark.parametrize("mode", ["normal", "receipt_failure", "descendant", "cross_session", "mid_turn", "budgeted", "priority", "queued", "unowned"])
def test_canonical_child_job_inherits_goal_and_settles_once(tmp_path, monkeypatch, store_fixture, transport, mode):
    import openprogram.programs.workflow.goal as goals
    from openprogram.programs.workflow.goal import chat
    from openprogram.agent.production_driver import AgentProductionDriver, CanonicalAgentAdapter
    from openprogram.agent.dispatcher.types import TurnRequest
    from openprogram.agent.sub_agent_run import AgentTurnResult
    from openprogram.agent.job.runner import JobRunner
    from openprogram.agent.resource_governance import ResourceGovernor
    from openprogram.usage import ledger, recorder
    from openprogram.usage.context import request_context, usage_scope
    from openprogram.usage.ledger import UsageLedger

    monkeypatch.setattr("openprogram.paths.get_execution_db_path", lambda: tmp_path / "executions.db")
    monkeypatch.setattr(goals, "_db", lambda: store_fixture)
    monkeypatch.setattr(goals, "_emit_goal_update", lambda *a, **k: None)
    meter = UsageLedger(tmp_path / "usage.db")
    monkeypatch.setattr(ledger, "default_ledger", meter)
    monkeypatch.setattr(recorder, "default_ledger", meter)
    goal = chat.create("p1", "work with a child") if mode != "mid_turn" else None
    if mode == "budgeted":
        goal = goals.apply_goal_action("p1", "budget", max_tokens=110)
    if mode == "cross_session":
        store_fixture.create_session("p2", "main")
        other_goal = chat.create("p2", "unrelated target goal")
    append = meter.append_in_transaction
    fail = {"enabled": mode == "receipt_failure"}
    def append_receipt(conn, event):
        if fail["enabled"] and event.goal_id:
            raise OSError("event append unavailable")
        return append(conn, event)
    monkeypatch.setattr(meter, "append_in_transaction", append_receipt)
    seen = []
    provider, calls, _ = transport

    def child(*, request, cancel_event):
        with usage_scope(session_id=request.session_id, call_kind="sub_agent"):
            seen.append(request_context())
            if mode == "priority":
                from openprogram.providers.types import SimpleStreamOptions
                from openprogram.providers.budget import QuotaExceeded
                with pytest.raises(QuotaExceeded, match="quota.cost_unavailable"):
                    asyncio.run(consume(provider, bounded_model(), options=SimpleStreamOptions(
                        max_tokens=20, api_key="test", service_tier="priority")))
                return AgentTurnResult(head_id="a1", final_text="request refused", failed=False)
            asyncio.run(consume(provider, bounded_model()))
            if mode == "descendant" and request.user_text == "child task":
                grandchild = jobs.spawn_job(session_id="p1", prompt="grandchild", agent_id="main",
                                            caller_session_id="p1", caller_msg_id="a1")
                child_ids.append(grandchild)
                jobs.await_job(grandchild, timeout=10)
        return AgentTurnResult(head_id="a1", final_text="child finished", failed=False)

    from openprogram.agent.resource_governance import ResourceLimits, resolve_resource_limits
    limits = resolve_resource_limits(ResourceLimits(max_cost_usd="1"), scheduler_capacity=2)
    governor = ResourceGovernor(meter, limit_resolver=lambda _sid, _job: limits,
                                session_limit_resolver=lambda _sid: limits) if mode == "priority" else ResourceGovernor(meter)
    jobs = JobRunner(max_workers=2, governor=governor,
                     agent_driver_factory=lambda store, control: AgentProductionDriver(
                         store, control_service=control, turn_runner=child))
    child_ids = []

    def parent(*, request, cancel_event):
        nonlocal goal
        if mode == "mid_turn":
            goal = chat.create("p1", "created during parent")
        child_id = jobs.spawn_job(session_id="p2" if mode == "cross_session" else "p1", prompt="child task", agent_id="main",
                                  caller_session_id="p1", caller_msg_id="a1", defer_dispatch=mode == "queued")
        child_ids.append(child_id)
        if mode == "queued":
            from openprogram.usage.context import bind_goal
            from openprogram.execution import ExecutionStore
            # A fresh store reader and cleared ambient Goal must not change
            # attribution already captured in the immutable admission.
            jobs._execution_store = ExecutionStore(tmp_path / "executions.db")
            meter.close()
            with bind_goal(None, session_id="p1"):
                assert request_context().goal_id is None
                assert jobs.spawn_job(session_id="p1", prompt="child task", agent_id="main",
                                      job_id=child_id, parent_msg_id="a1", resume_deferred=True) == child_id
        jobs.await_job(child_id, timeout=10)
        goals.apply_goal_action("p1", "pause")
        return AgentTurnResult(head_id="a1", final_text="parent finished", failed=False)

    try:
        if mode == "unowned":
            from openprogram.usage.context import bind_goal
            with bind_goal({"goal_id": goal["goal_id"], "goal_revision": goal["revision"],
                            "goal_run_id": goal["run_id"], "goal_session_id": "p1"}, session_id="p1"):
                child_id = jobs.spawn_job(session_id="p1", prompt="child task", agent_id="main")
                jobs.await_job(child_id, timeout=10)
            assert len(calls) == 1
            assert seen[0].goal_id is None
            assert goals.load_goal("p1")["usage"]["requests"] == 0
            assert "usage_goal" not in jobs._execution_store.get_job_agent_input(child_id)["job_context"]
            with meter.read() as conn:
                assert conn.execute("SELECT goal_id FROM usage_events").fetchone()[0] is None
            return
        adapter = CanonicalAgentAdapter(store=jobs._execution_store, turn_runner=parent)
        admission = adapter.admit(TurnRequest("p1", "run parent", "main", "web"),
                                  trusted_actor={}, user_message_id="goal-parent", config_snapshot_ref="session:p1")
        asyncio.run(adapter.activate(admission))
        if mode == "priority":
            assert calls == []
            assert goals.load_goal("p1")["usage"]["requests"] == 0
            return
        count = 2 if mode == "descendant" else 1
        assert len(calls) == count
        assert seen[0].goal_id == goal["goal_id"]
        payload = jobs._execution_store.get_job_agent_input(child_ids[0])
        assert payload["job_context"]["usage_goal"]["goal_id"] == goal["goal_id"]
        if mode == "receipt_failure":
            with meter.read() as conn:
                assert conn.execute("SELECT state FROM usage_requests").fetchone()[0] == "started"
                assert {row[0] for row in conn.execute("SELECT state FROM usage_reservations")} == {"started"}
                assert conn.execute("SELECT COUNT(*) FROM usage_events").fetchone()[0] == 0
            fail["enabled"] = False
        meter.close()
        usage = goals.load_goal("p1")["usage"]
        assert usage["total_tokens"] == (40 if mode == "budgeted" else 50 * count)
        assert usage["requests"] == count
        if mode == "budgeted":
            assert calls[0]["max_tokens"] == 10
        if mode == "cross_session":
            assert goals.load_goal("p2")["goal_id"] == other_goal["goal_id"]
            assert goals.load_goal("p2")["usage"]["requests"] == 0
        with meter.read() as conn:
            rows = conn.execute("SELECT goal_id, job_id, execution_id FROM usage_events").fetchall()
            assert {tuple(row) for row in rows} == {(goal["goal_id"], child_id, child_id) for child_id in child_ids}
            assert {row[0] for row in conn.execute("SELECT state FROM usage_reservations")} == {"settled"}
    finally:
        jobs.shutdown()
        meter.close()
