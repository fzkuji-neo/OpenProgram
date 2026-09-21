"""Unknown prior effects require new, exact approval even in bypass mode."""
import asyncio

import pytest

from openprogram.agent.authority import local_owner_authority
from openprogram.agent.dispatcher.types import TurnRequest
from openprogram.agent.permissions.approval import wrap_with_approval
from openprogram.agent.types import AgentTool, AgentToolResult
from openprogram.execution.attempts import AttemptStore
from openprogram.execution.control import RuntimeControlService
from openprogram.execution.driver import DriverRegistry
from openprogram.execution.effects import EffectClassification, EffectStatus, EffectStore
from openprogram.execution.store import ExecutionStore


@pytest.fixture
def recovery(tmp_path, monkeypatch):
    store = ExecutionStore(tmp_path / "executions.sqlite3")
    monkeypatch.setattr("openprogram.execution.default_store", lambda: store)
    monkeypatch.setattr("openprogram.programs.permission_rule.load_merged_rules", lambda _: None)
    return store


def orphan(store, *, session="recovery", name="bash", parent=None, kind="tool.before", caller=None):
    revision = store.create_revision(manifest={"entrypoint": "chat"})
    if caller:
        import hashlib
        import json
        from openprogram.agent.job.input import JobAgentInputV1
        from openprogram.agent.job.types import Job

        job = Job(id="called-job", parent_session_id=session, prompt="inspect", agent_id="main",
                  caller_session_id=caller, caller_msg_id="caller-message")
        payload = JobAgentInputV1.from_job(job).to_dict()
        serialized = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        execution = store.admit_execution(session_id=session, revision_id=revision.revision_id,
            input_ref="job-input-v1:" + serialized,
            input_hash=hashlib.sha256(serialized.encode()).hexdigest(),
            entrypoint="openprogram.agent.production_driver:AgentProductionDriver",
            trusted_actor=local_owner_authority(), config_snapshot_ref="config:test",
            job_agent_payload=payload)
    else:
        execution = store.create_execution(
            session_id=session, revision_id=revision.revision_id,
            parent_execution_id=parent,
        )
    attempts = AttemptStore(store)
    leased, reserved = attempts.lease(
        execution.execution_id, expected_version=execution.status_version,
        owner_id="old-worker", ttl_seconds=30,
    )
    active, running = attempts.activate(
        leased.attempt_id, generation=leased.generation,
        expected_execution_version=reserved.status_version,
    )
    effects = EffectStore(store)
    effect = effects.register(
        effect_id=f"effect:{execution.execution_id}", execution_id=execution.execution_id,
        attempt_id=active.attempt_id, action_id="old-call",
        classification=EffectClassification.NONREPEATABLE, idempotency_key=None,
        metadata={"kind": kind, "payload": {"tool_name": name, "tool_call_id": "old-call"}},
    )
    effects.mark_dispatched(effect.effect_id, expected_status=EffectStatus.PLANNED)
    RuntimeControlService(store, attempts, DriverRegistry()).recover_owner_loss(execution.execution_id)
    return execution, effect


def operation(name="bash", *, mode="bypass", source="web", session="recovery"):
    calls = []

    async def execute(*args):
        calls.append(args)
        return AgentToolResult(content=[], details={})

    tool = AgentTool(name=name, label=name, description="test", parameters={}, execute=execute)
    req = TurnRequest(session_id=session, user_text="continue", agent_id="main",
                      source=source, permission_mode=mode, **local_owner_authority())
    return tool, req, calls


@pytest.mark.parametrize("name", ["bash", "read", "memory_update"])
@pytest.mark.parametrize("mode", ["bypass", "auto", "acceptEdits"])
def test_unknown_effect_overrides_automatic_permissions(recovery, name, mode):
    _, effect = orphan(recovery)
    tool, req, calls = operation(name, mode=mode)
    tool._accept_edits_safe = True
    wrapped = wrap_with_approval(tool, req, lambda _: None)
    manifest = wrapped._interaction_manifest("new-call", {})
    assert manifest is not None
    assert manifest["request_metadata"]["approval_reason"] == "RECOVERY_EFFECT_UNCERTAIN"
    assert manifest["policy_snapshot"]["allowed_scopes"] == ["once"]
    assert effect.effect_id in str(manifest["request_metadata"]["recovery_effects"])
    assert "unknown" in manifest["detail"].lower()
    assert calls == []


def test_real_builtin_inspection_not_name_or_copied_flags(recovery, tmp_path):
    import copy
    from openprogram.programs.tools.files.read import read
    from openprogram.agent.permissions.policy import permission_decision

    orphan(recovery)
    _, req, _ = operation()
    assert permission_decision(read, req, {})[0] == "allow"
    copied = copy.copy(read)
    assert permission_decision(copied, req, {})[0] == "allow"
    fake, _, _ = operation("read")
    copied.execute = fake.execute
    assert permission_decision(copied, req, {})[:2] == ("ask", "RECOVERY_EFFECT_UNCERTAIN")
    target = tmp_path / "inspect.txt"
    target.write_text("saved result", encoding="utf-8")
    wrapped = wrap_with_approval(read, req, lambda _: None)
    result = asyncio.run(wrapped.execute("inspect", {"file_path": str(target)}, None, None))
    assert not result.is_error
    assert "saved result" in str(result.content)


def test_denies_and_noninteractive_authority_remain_stronger(recovery):
    from openprogram.agent.permissions.policy import permission_decision
    from openprogram.agent.session_config import PermissionRules

    orphan(recovery)
    tool, req, _ = operation()
    req.permission_rules = PermissionRules(deny=["bash"])
    assert permission_decision(tool, req, {})[:2] == ("deny", "PERMISSION_RULE_DENY")
    req.permission_rules = PermissionRules(allow=["bash"])
    assert permission_decision(tool, req, {})[:2] == ("ask", "RECOVERY_EFFECT_UNCERTAIN")
    req.source = "agent_spawn"
    assert permission_decision(tool, req, {})[:2] == ("deny", "APPROVAL_UNAVAILABLE_NON_INTERACTIVE")


def test_conversation_descendants_but_not_unrelated_session(recovery):
    from openprogram.agent.permissions.policy import permission_decision

    revision = recovery.create_revision(manifest={})
    parent = recovery.create_execution(session_id="recovery", revision_id=revision.revision_id)
    orphan(recovery, parent=parent.execution_id)
    tool, req, _ = operation()
    assert permission_decision(tool, req, {})[0] == "ask"
    req.session_id = "unrelated"
    assert permission_decision(tool, req, {})[0] == "allow"
    req.spawned_from_session = "recovery"
    assert permission_decision(tool, req, {})[0] == "ask"


def test_provider_only_and_resolved_effects_do_not_restrict_new_operations(recovery):
    from openprogram.agent.permissions.policy import permission_decision

    orphan(recovery, kind="provider.before")
    tool, req, _ = operation()
    assert permission_decision(tool, req, {})[0] == "allow"
    _, effect = orphan(recovery)
    effects = EffectStore(recovery)
    effects.resolve(effect.effect_id, expected_status=EffectStatus.DISPATCHED,
                    outcome=EffectStatus.COMMITTED, receipt={"result": "verified"})
    assert permission_decision(tool, req, {})[0] == "allow"


def test_exact_called_job_not_its_entire_target_session(recovery):
    _, called = orphan(recovery, session="target", caller="recovery")
    _, unrelated = orphan(recovery, session="target")
    raw, req, _ = operation()
    manifest = wrap_with_approval(raw, req, lambda _: None)._interaction_manifest("new-call", {})
    ids = {item["effect_id"] for item in manifest["request_metadata"]["recovery_effects"]}
    assert ids == {called.effect_id}
    assert unrelated.effect_id not in str(manifest)


def test_unavailable_recovery_state_fails_closed(recovery, monkeypatch):
    def unavailable():
        raise OSError("unavailable")

    monkeypatch.setattr("openprogram.execution.default_store", unavailable)
    tool, req, calls = operation()
    result = asyncio.run(wrap_with_approval(tool, req, lambda _: None).execute("new", {}, None, None))
    assert result.details["reason_code"] == "RECOVERY_STATE_UNAVAILABLE"
    assert calls == []


def approve(store, manifest, *, scope="once"):
    import time
    from openprogram.execution.waits import DurableWaitStore

    revision = store.create_revision(manifest={})
    execution = store.create_execution(session_id="recovery", revision_id=revision.revision_id)
    attempts = AttemptStore(store)
    leased, reserved = attempts.lease(execution.execution_id, expected_version=execution.status_version,
                                      owner_id="new-worker", ttl_seconds=30)
    active, _ = attempts.activate(leased.attempt_id, generation=leased.generation,
                                  expected_execution_version=reserved.status_version)
    wait = DurableWaitStore(store).open_wait(execution_id=execution.execution_id,
        attempt_id=active.attempt_id, generation=active.generation, kind="approval",
        request={"prompt": manifest["prompt"], "options": manifest["options"], "multi": False,
                 "allow_custom": False, "detail": manifest["detail"], "schema": {}, "questions": [],
                 **manifest["request_metadata"]}, policy_snapshot=manifest["policy_snapshot"],
        expires_at=time.time() + 60)
    service = RuntimeControlService(store, attempts, DriverRegistry())
    asyncio.run(service.request_wait_answer(command_id="answer", execution_id=execution.execution_id,
        expected_version=store.get_execution(execution.execution_id).status_version,
        actor=local_owner_authority(), wait_id=wait.wait_id, generation=wait.claim_generation,
        answer={"answer": "approve", "scope": scope}))
    return wait


@pytest.mark.parametrize("change", [None, "extra_effect", "arguments", "old_approval"])
def test_durable_approval_binds_exact_uncertainty_and_operation(recovery, change):
    from openprogram.agent.run_control import set_preapproved_wait_id, reset_preapproved_wait_id

    _, effect = orphan(recovery)
    raw, req, calls = operation()
    wrapped = wrap_with_approval(raw, req, lambda _: None)
    args = {"command": "perform explicitly approved work"}
    manifest = wrapped._interaction_manifest("new-call", args)
    if change == "old_approval":
        manifest["request_metadata"].pop("recovery_effects")
        manifest["request_metadata"]["approval_reason"] = "MODE_APPROVAL"
    wait = approve(recovery, manifest)
    if change == "extra_effect":
        orphan(recovery)
    if change == "arguments":
        args = {"command": "different work"}
    # A rebuilt wrapper consumes the persisted receipt, as after restart.
    restored = wrap_with_approval(raw, req, lambda _: None)
    token = set_preapproved_wait_id(wait.wait_id)
    try:
        result = asyncio.run(restored.execute("new-call", args, None, None))
    finally:
        reset_preapproved_wait_id(token)
    assert bool(calls) is (change is None), result
    assert result.is_error is (change is not None)
    assert EffectStore(recovery).get(effect.effect_id).status is EffectStatus.DISPATCHED


def test_always_scope_cannot_waive_uncertainty(recovery):
    from openprogram.execution.waits import DurableWaitStore
    from openprogram.execution.store import ExecutionConflict

    orphan(recovery)
    raw, req, _ = operation()
    manifest = wrap_with_approval(raw, req, lambda _: None)._interaction_manifest("new-call", {})
    with pytest.raises(ExecutionConflict, match="scope"):
        approve(recovery, manifest, scope="always")
    assert len(DurableWaitStore(recovery).list_open()) == 1
