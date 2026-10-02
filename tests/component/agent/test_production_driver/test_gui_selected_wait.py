"""Selected desktop waits preserve a real function and Agent continuation cursor."""
from __future__ import annotations

import asyncio
import sys
import threading
from types import ModuleType, SimpleNamespace

import pytest

from ._support import _admitted


def _gui(monkeypatch):
    from openprogram.programs.gui_harness_bridge import install_gui_harness_web_use
    effects, plans = [], []
    def plan(**kwargs):
        count = len(kwargs["history"])
        plans.append(count)
        if count < 2:
            return {"call": "browser_use" if count == 0 else "computer_use", "args": {"task": "bounded action"}}
        return {"call": "terminal", "args": {"status": "succeeded", "reason": "Verified"}}
    def effect(call, *args, **kwargs):
        effects.append(call)
        return {"status": "succeeded", "success": True, "completion_verified": True, "summary": call}
    package, tasks, result = ModuleType("gui_harness"), ModuleType("gui_harness.tasks"), ModuleType("gui_harness.tasks.result")
    package.__path__ = []
    tasks.__path__ = []
    tasks.capability_loop = SimpleNamespace(
        CAPABILITIES=("browser_use", "computer_use", "vm_use"),
        capability_status=lambda **kwargs: {name: {"available": True} for name in ("browser_use", "computer_use")},
        plan_next_capability=plan, call_capability=effect,
        validate_terminal_decision=lambda decision, history: {"accepted": bool(history[-1]["output"]["completion_verified"]), **decision["args"]},
    )
    result.conclusion = lambda **kwargs: {"summary": "Verified"}
    result.save_workflow_record = lambda *args: None
    for name, module in (("gui_harness", package), ("gui_harness.tasks", tasks), ("gui_harness.tasks.result", result)):
        monkeypatch.setitem(sys.modules, name, module)
    return install_gui_harness_web_use(lambda **kwargs: {"status": "failed"}), plans, effects


@pytest.mark.parametrize("parent_ready", [False, True])
def test_selected_wait_preserves_agent_cursor_without_auto_resume_window(tmp_path, monkeypatch, parent_ready):
    from openprogram import system_access
    from openprogram.agent.continuation import runtime_contract_snapshot
    from openprogram.agent.dispatcher.types import TurnRequest
    from openprogram.agent.production_driver import AgentProductionDriver
    from openprogram.agentic_programming.continuation import FunctionSystemAccessRequired, function_execution
    from openprogram.execution import AttemptStore, RuntimeControlService
    from openprogram.execution.driver import DriverRegistry
    from openprogram.execution.effects import EffectStore
    from openprogram.execution.model import ExecutionStatus
    from openprogram.execution.waits import DurableWaitStore, WaitStatus
    from openprogram.providers.types import Model
    public, plans, effects = _gui(monkeypatch)
    granted = False
    monkeypatch.setattr(system_access, "report", lambda: {"platform": "Darwin", "capabilities": [
        {"id": name, "status": "granted" if granted else "not_granted", "can_request": True}
        for name in ("accessibility", "screen_recording")]})
    monkeypatch.setattr("openprogram.execution.restart.window_seconds", lambda: 0)
    store, execution = _admitted(tmp_path)
    attempts = AttemptStore(store)
    leased, reserved = attempts.lease(execution.execution_id, expected_version=execution.status_version, owner_id="worker", ttl_seconds=30)
    active, running = attempts.activate(leased.attempt_id, generation=leased.generation, expected_execution_version=reserved.status_version)
    resumed = []
    async def activate(attempt, activation):
        resumed.append((attempt, activation))
    control = RuntimeControlService(store, attempts, DriverRegistry(), activator=activate)
    driver = AgentProductionDriver(store, control_service=control)
    frames = []
    monkeypatch.setattr("openprogram.events.emit_ws_frame", frames.append)
    request = TurnRequest(session_id=running.session_id, user_text="GUI", agent_id="main", source="test", user_msg_id="user")
    request._execution_revision_id = running.revision_id
    hook = driver._safe_point_hook(active, request, threading.Event())
    snapshot = runtime_contract_snapshot(model=Model(id="fake", name="fake", api="openai-completions", provider="openai", base_url="https://example.invalid/v1"),
        system_prompt="system", tools=[], request=request)
    assistant = {"role": "assistant", "content": [{"type": "toolCall", "id": "gui-call", "name": "gui_agent", "arguments": {"task": "browser then desktop"}}],
        "api": "fake", "provider": "fake", "model": "fake", "timestamp": 1}
    assert hook("provider.before", {"resolved_snapshot": snapshot, "context": {"messages": []}, "supports_idempotency_key": True}) is False
    assert hook("provider.after", {"message": assistant, "provider_request_id": "request", "usage": {}}) is False
    assert hook("tool.before", {"tool_call_id": "gui-call", "tool_name": "gui_agent", "arguments": {"task": "browser then desktop"}, "next_tool_index": 0}) is False
    assert hook("tool.started", {"tool_call_id": "gui-call"}) is False
    with pytest.raises(FunctionSystemAccessRequired):
        with function_execution(store, attempt_id=active.attempt_id, generation=active.generation, call_key="gui-call", checkpoint_root=False, publish_pause=False):
            public(task="browser then desktop", runtime=SimpleNamespace(live=object()))
    assert effects == ["browser_use"]
    granted = parent_ready
    assert hook("tool.suspended", {"tool_call_id": "gui-call", "tool_name": "gui_agent", "next_tool_index": 0,
        "tool_call_ids": ["gui-call"], "system_access_required": True, "call_key": "gui-call"}) is True
    paused = store.get_execution(execution.execution_id)
    assert paused.status is ExecutionStatus.PAUSED
    wait = DurableWaitStore(store).list_outcomes()[0] if parent_ready else DurableWaitStore(store).list_open()[0]
    assert set(wait.request["required_capabilities"]) == {"screen_recording", "accessibility"}
    assert wait.status is (WaitStatus.RESOLVED if parent_ready else WaitStatus.OPEN)
    assert bool(frames) is (not parent_ready)
    assert not EffectStore(store).list_unresolved(execution.execution_id)
    assert wait.request.get('silent_selected_gui_ready', False) is parent_ready
    from openprogram.agent.continuation import AgentContinuation
    from openprogram.execution.checkpoints import ExecutionCheckpointStore
    continuation = AgentContinuation.from_checkpoint(store=store, checkpoint=ExecutionCheckpointStore(store).get(paused.checkpoint_head_id), request=request)
    assert continuation.state.payload["next_tool_index"] == 0
    assert continuation.assistant_message.content[0].id == "gui-call"
    # Release-time recovery is scoped to the silent, already-resolved outcome;
    # it must not probe or resolve open permission waits in any execution.
    async def reject_global_reconciliation():
        pytest.fail('Release-time recovery must not reconcile all waits')
    with monkeypatch.context() as scoped:
        scoped.setattr(control, 'recover_wait_outcomes', reject_global_reconciliation)
        asyncio.run(driver._recover_selected_gui_ready_wait(active))
    assert len(resumed) == (1 if parent_ready else 0)
    granted = True
    asyncio.run(control.recover_wait_outcomes())
    assert len(resumed) == 1
    next_attempt = attempts.get(resumed[0][0].attempt_id)
    assert next_attempt.generation > active.generation
    with function_execution(store, attempt_id=next_attempt.attempt_id, generation=next_attempt.generation, call_key="gui-call", checkpoint_root=False, publish_pause=False):
        result = public(task="browser then desktop", runtime=SimpleNamespace(live=object()))
    assert result["status"] == "succeeded"
    assert effects == ["browser_use", "computer_use"]
    assert plans == [0, 1, 2]
