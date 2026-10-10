"""Selected GUI access resumes through real canonical subprocess admission."""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys

import pytest


_FIXTURE = '''import json, os
from pathlib import Path
from gui_harness.main import gui_agent as original
from gui_harness.tasks import capability_loop, result
from openprogram import system_access
from openprogram.programs.gui_harness_bridge import install_gui_harness_web_use

folder = Path(os.environ["GUI_SELECTED_TEST_WORK"])

def record(kind, **values):
    with (folder / "trace.jsonl").open("a") as stream:
        stream.write(json.dumps({"kind": kind, "pid": os.getpid(), **values}) + "\\n")

def report():
    granted = (folder / "grant").exists()
    child = os.getpid() != int(os.environ["GUI_SELECTED_TEST_PARENT"])
    if not granted and child and (folder / "grant-after-child-probe").exists():
        (folder / "grant").touch()
        record("grant_race")
    if (folder / "revoke-child").exists() and child:
        (folder / "grant").unlink(missing_ok=True)
        granted = False
    return {"platform": "Darwin", "capabilities": [
        {"id": spec.id, "status": "granted" if granted else "not_granted", "can_request": True}
        for spec in system_access.capability_registry() if "gui_agent:desktop" in spec.operations]}

def plan(**kwargs):
    history = kwargs["history"]
    record("plan", history=len(history))
    if not history:
        return {"call": "browser_use", "args": {"task": "Read fixture page"}}
    if len(history) == 1 and kwargs["task"] != "browser only":
        return {"call": "computer_use", "args": {"task": "Inspect fixture app"}}
    return {"call": "terminal", "args": {"status": "succeeded", "reason": "Fixture verified"}}

def capability(call, args, **kwargs):
    from openprogram.agentic_programming.call_state import _current_runtime
    runtime = _current_runtime.get(None)
    assert runtime is not None and not isinstance(runtime, dict)
    assert callable(runtime.exec)
    record("effect", capability=call)
    return {"status": "succeeded", "success": True, "completion_verified": True, "summary": call}

system_access.report = report
def availability(**kwargs):
    granted = (folder / "grant").exists()
    return {"browser_use": {"available": True}, "computer_use": {
        "available": granted, "missing_dependencies": [], "system_access": [
            {"id": spec.id, "status": "granted" if granted else "not_granted"}
            for spec in system_access.capability_registry() if "gui_agent:desktop" in spec.operations]},
        "vm_use": {"available": False}}
capability_loop.capability_status = availability
capability_loop.plan_next_capability = plan
capability_loop.call_capability = capability
result.conclusion = lambda **kwargs: {"summary": "Fixture verified"}
result.save_workflow_record = lambda *args: None
gui_agent = install_gui_harness_web_use(original)
'''


_PROGRAM = '''import asyncio, json, os, sys, time
from pathlib import Path
if __name__ == "__main__":
    os.environ["GUI_SELECTED_TEST_PARENT"] = str(os.getpid())
import gui_selected_fixture
from openprogram.agent.production_driver import CanonicalAgentAdapter
from openprogram.agent.session_db import default_db
from openprogram.agent.authority import local_owner_authority
from openprogram.execution import default_store, default_control_service
from openprogram.execution.effects import EffectStore
from openprogram.execution.waits import DurableWaitStore

async def main():
    mode, task, folder_arg = sys.argv[1:]
    folder = Path(folder_arg)
    store, control = default_store(), default_control_service()
    if mode == "start":
        default_db().create_session("gui-selected", "main", work_dir=str(folder))
        adapter = CanonicalAgentAdapter()
        admission = adapter.admit_payload(session_id="gui-selected", payload={
            "version": 1, "kind": "forced_tool", "tool_name": "gui_agent",
            "tool_input": {"task": task}, "anchor_msg_id": "pred:ROOT|node:gui-node",
            "work_dir": str(folder), "source": "fn-form"},
            trusted_actor=local_owner_authority(), user_message_id="user", assistant_message_id="gui-node",
            config_snapshot_ref="isolated-selected-gui")
        execution_id = admission.execution_id
        (folder / "execution-id").write_text(execution_id)
        await adapter.activate(admission)
    else:
        execution_id = (folder / "execution-id").read_text()
        current = store.get_execution(execution_id)
        if mode == "cancel":
            await control.request_cancel(command_id="cancel-fixture", execution_id=execution_id,
                expected_version=current.status_version, actor={"surface": "test"}, reason_code="test_cancel")
        await control.recover_wait_outcomes()
    deadline = time.monotonic() + 25
    while True:
        execution = store.get_execution(execution_id)
        pending = execution.status.value in {"queued", "running", "pausing", "cancelling"}
        # A silent granted wait is observable between its durable commit and
        # the old driver's done callback releasing its handle for activation.
        grant_race = (execution.status.value == "paused" and
                      execution.reason_code == "system_access_required" and
                      (folder / "grant").exists())
        if not pending and not grant_race:
            break
        if time.monotonic() > deadline:
            raise TimeoutError(str(execution.to_dict()))
        await asyncio.sleep(0.01)
    waits = DurableWaitStore(store)
    opened = waits.list_open(execution_id=execution_id)
    outcomes = [wait for wait in waits.list_outcomes() if wait.execution_id == execution_id]
    with store._connect() as connection:
        generations = [row[0] for row in connection.execute(
            "SELECT generation FROM attempts WHERE execution_id = ? ORDER BY generation", (execution_id,))]
    nodes = [node.id for node in default_db().get_nodes("gui-selected") if node.is_code()]
    print(json.dumps({"status": execution.status.value, "reason": execution.reason_code,
        "checkpoint": execution.checkpoint_head_id, "generations": generations, "nodes": nodes,
        "open_waits": [wait.wait_id for wait in opened],
        "wait_checkpoints": [wait.checkpoint_id for wait in opened],
        "outcomes": [{"id": wait.wait_id, "outcome": wait.outcome} for wait in outcomes],
        "unresolved": [effect.effect_id for effect in EffectStore(store).list_unresolved(execution_id)]}))

if __name__ == "__main__":
    asyncio.run(main())
'''


@pytest.fixture
def selected_gui_process(tmp_path):
    from openprogram.programs.workflow._project import catalog

    repo = Path(__file__).resolve().parents[3]
    harness = repo / "openprogram/programs/applications/gui_harness"
    if not (harness / "gui_harness/main.py").is_file():
        pytest.skip("Pinned GUI harness checkout is not installed")
    root = tmp_path / "catalog"
    project = root / "workflow/gui_selected_fixture"
    project.mkdir(parents=True)
    (root / "__init__.py").write_text("")
    (project / "__init__.py").write_text("from .workflow import gui_agent\n")
    (project / "workflow.py").write_text(_FIXTURE)
    (project / "pyproject.toml").write_text(catalog._project_pyproject("gui_selected_fixture", {
        "name": "gui_selected_fixture", "summary": "Isolated selected GUI fixture", "tags": [],
        "entrypoint": "gui_agent"}))
    for command in (["git", "init", "-b", "main"], ["git", "add", "--all"],
                    ["git", "-c", "user.name=Test", "-c", "user.email=test@example.com",
                     "commit", "-m", "Fixture"]):
        subprocess.run(command, cwd=project, check=True, capture_output=True)
    home, work = tmp_path / "home", tmp_path / "work"
    state = home / ".openprogram"
    state.mkdir(parents=True)
    work.mkdir()
    (state / "config.json").write_text(json.dumps({"execution": {"auto_resume_window_seconds": 0}}))
    (state / "program-sources.json").write_text(json.dumps({
        "version": 2, "catalog_root": str(root), "workflow_projects_migrated": True,
        "programs": [{"scope": "programs", "path": "workflow/gui_selected_fixture",
                      "kind": "workflow-publish", "source": "workflow:gui_selected_fixture"}]}))
    program = tmp_path / "program.py"
    program.write_text(_PROGRAM)
    env = {**os.environ, "HOME": str(home), "USERPROFILE": str(home),
           "CODEX_HOME": str(home / ".codex"), "OPENPROGRAM_CONFIG_DIR": str(state),
           "GUI_SELECTED_TEST_WORK": str(work),
           "PYTHONPATH": os.pathsep.join((str(repo), str(harness), str(root / "workflow")))}
    env.pop("OPENPROGRAM_PROFILE", None)

    def run(mode, task="browser then desktop"):
        process = subprocess.run([sys.executable, str(program), mode, task, str(work)],
                                 env=env, text=True, capture_output=True, timeout=40)
        assert process.returncode == 0, process.stdout + process.stderr
        return json.loads(process.stdout.strip().splitlines()[-1])

    return work, run


def _trace(work, kind):
    return [row for line in (work / "trace.jsonl").read_text().splitlines()
            if (row := json.loads(line))["kind"] == kind]


def test_task_only_browser_subprocess_needs_no_desktop_access(selected_gui_process):
    work, run = selected_gui_process
    outcome = run("start", "browser only")
    assert outcome["status"] == "completed", outcome
    assert outcome["generations"] == [1]
    assert not outcome["open_waits"] and not outcome["outcomes"] and not outcome["unresolved"]
    assert [row["history"] for row in _trace(work, "plan")] == [0, 1]
    assert [row["capability"] for row in _trace(work, "effect")] == ["browser_use"]


def test_selected_desktop_wait_resumes_after_new_parent_process_without_replay(selected_gui_process):
    work, run = selected_gui_process
    paused = run("start")
    assert paused["status"] == "paused" and paused["reason"] == "system_access_required", paused
    assert paused["wait_checkpoints"] == [paused["checkpoint"]]
    assert len(paused["open_waits"]) == 1 and not paused["unresolved"]
    assert [row["history"] for row in _trace(work, "plan")] == [0, 1]
    first_effects = _trace(work, "effect")
    assert [row["capability"] for row in first_effects] == ["browser_use"]
    (work / "grant").touch()
    resumed = run("recover")
    assert resumed["status"] == "completed", resumed
    assert resumed["generations"] == [1, 2] and resumed["nodes"] == paused["nodes"] == ["gui-node"]
    assert not resumed["open_waits"] and not resumed["unresolved"]
    assert resumed["outcomes"] == [{"id": paused["open_waits"][0], "outcome": "granted"}]
    assert [row["history"] for row in _trace(work, "plan")] == [0, 1, 2]
    effects = _trace(work, "effect")
    assert [row["capability"] for row in effects] == ["browser_use", "computer_use"]
    assert effects[0]["pid"] != effects[1]["pid"]


def test_cancelled_selected_desktop_wait_never_dispatches_after_grant(selected_gui_process):
    work, run = selected_gui_process
    paused = run("start")
    assert paused["status"] == "paused", paused
    cancelled = run("cancel")
    assert cancelled["status"] == "cancelled", cancelled
    (work / "grant").touch()
    recovered = run("recover")
    assert recovered["status"] == "cancelled" and recovered["generations"] == [1], recovered
    assert [row["capability"] for row in _trace(work, "effect")] == ["browser_use"]
    assert [row["history"] for row in _trace(work, "plan")] == [0, 1]


def test_child_missing_parent_ready_race_resumes_after_old_handle_release(selected_gui_process):
    work, run = selected_gui_process
    (work / "grant-after-child-probe").touch()
    outcome = run("start")
    assert outcome["status"] == "completed" and outcome["generations"] == [1, 2], outcome
    assert not outcome["open_waits"] and not outcome["unresolved"]
    assert len(outcome["outcomes"]) == 1 and outcome["outcomes"][0]["outcome"] == "granted"
    assert len(_trace(work, "grant_race")) == 1
    assert [row["history"] for row in _trace(work, "plan")] == [0, 1, 2]
    assert [row["capability"] for row in _trace(work, "effect")] == ["browser_use", "computer_use"]


def test_grant_then_child_revocation_reopens_wait_without_replay(selected_gui_process):
    work, run = selected_gui_process
    paused = run("start")
    assert paused["status"] == "paused", paused
    (work / "grant").touch()
    (work / "revoke-child").touch()
    revoked = run("recover")
    assert revoked["status"] == "paused" and revoked["reason"] == "system_access_required", revoked
    assert revoked["generations"] == [1, 2], revoked
    assert len(revoked["open_waits"]) == 1 and revoked["open_waits"] != paused["open_waits"]
    assert not revoked["unresolved"]
    assert [row["capability"] for row in _trace(work, "effect")] == ["browser_use"]
    assert [row["history"] for row in _trace(work, "plan")] == [0, 1]
    (work / "revoke-child").unlink()
    (work / "grant").touch()
    finished = run("recover")
    assert finished["status"] == "completed" and finished["generations"] == [1, 2, 3], finished
    assert [row["capability"] for row in _trace(work, "effect")] == ["browser_use", "computer_use"]
    assert [row["history"] for row in _trace(work, "plan")] == [0, 1, 2]
