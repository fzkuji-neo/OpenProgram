"""Model-free agentic Programs execute in a real spawned child."""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys

import pytest


@pytest.mark.parametrize("use_model", [False, True])
@pytest.mark.parametrize("selection", ["missing", "without_credentials"])
def test_no_model_workflow_reaches_child_without_default_provider(tmp_path, use_model, selection):
    from openprogram.programs.workflow._project import catalog

    root = tmp_path / "catalog"
    project = root / "workflow" / "no_model_probe"
    project.mkdir(parents=True)
    (root / "__init__.py").write_text("")
    (project / "pyproject.toml").write_text(catalog._project_pyproject("no_model_probe", {
        "name": "no_model_probe", "summary": "No-model execution", "tags": [],
        "entrypoint": "no_model_probe",
    }))
    (project / "__init__.py").write_text("from .workflow import no_model_probe\n")
    (project / "workflow.py").write_text('''from pathlib import Path
from openprogram.agentic_programming import agentic_function
@agentic_function
def no_model_probe(use_model: bool, runtime=None):
    Path(__file__).with_name("entered.flag").touch()
    assert runtime.api_model is None
    assert runtime.api_key is None
    if use_model:
        return runtime.exec("No configured model", tools=[])
    return "plain result"
''')
    for command in (["git", "init", "-b", "main"], ["git", "add", "--all"],
                    ["git", "-c", "user.name=Test", "-c", "user.email=test@example.com",
                     "commit", "-m", "Fixture"]):
        subprocess.run(command, cwd=project, check=True, capture_output=True)
    state = tmp_path / ".openprogram"
    state.mkdir()
    if selection == "without_credentials":
        (state / "config.json").write_text(json.dumps({"providers": {"openai": {
            "enabled": True, "models": [{"id": "fake-model", "name": "Fake"}],
        }}}))
    (state / "program-sources.json").write_text(json.dumps({
        "version": 2, "catalog_root": str(root), "workflow_projects_migrated": True,
        "programs": [{"scope": "programs", "path": "workflow/no_model_probe",
                      "kind": "workflow-publish", "source": "workflow:no_model_probe"}],
    }))
    script = '''import asyncio, json, sys
from openprogram.agent.session_db import default_db
from openprogram.agent.dispatcher import TurnRequest, _wrap_agentic_runtime_block
from openprogram.programs import get_agent_tool
db=default_db()
db.create_session("no-model", "main", source="test")
profile={} if sys.argv[2]=="missing" else {"model":"openai/fake-model"}
req=TurnRequest(session_id="no-model",user_text="",agent_id="main",source="test",profile_snapshot=profile)
tool=get_agent_tool("no_model_probe")
assert tool is not None
wrapped=_wrap_agentic_runtime_block(tool,req,lambda event: None,"anchor")
result=asyncio.run(wrapped.execute("call", {"use_model":sys.argv[1]=="True"},None,None))
print(json.dumps({"failed":result.is_error,"text":"".join(c.text for c in result.content)}))
'''
    env = {**os.environ, "HOME": str(tmp_path), "USERPROFILE": str(tmp_path),
           "CODEX_HOME": str(tmp_path / ".codex"), "OPENPROGRAM_CONFIG_DIR": str(state)}
    env.pop("OPENPROGRAM_PROFILE", None)
    result = subprocess.run([sys.executable, "-c", script, str(use_model), selection], env=env,
                            capture_output=True, text=True, timeout=45)
    assert result.returncode == 0, result.stderr
    assert (project / "entered.flag").is_file(), result.stdout
    outcome = json.loads(result.stdout.splitlines()[-1])
    assert outcome["failed"] is use_model
    if use_model:
        assert ("No model is configured" if selection == "missing" else "API key") in outcome["text"]
    else:
        assert "plain result" in outcome["text"]


@pytest.mark.parametrize("use_model", [False, True])
@pytest.mark.parametrize("selection", ["missing", "provider_only", "model_only", "auto", "explicit"])
def test_forced_workflow_never_detects_an_unselected_provider(tmp_path, use_model, selection):
    from openprogram.programs.workflow._project import catalog

    root = tmp_path / "catalog"
    project = root / "workflow" / "forced_probe"
    project.mkdir(parents=True)
    (root / "__init__.py").write_text("")
    (project / "pyproject.toml").write_text(catalog._project_pyproject("forced_probe", {
        "name": "forced_probe", "summary": "Forced model selection", "tags": [],
        "entrypoint": "forced_probe",
    }))
    (project / "__init__.py").write_text("from .workflow import forced_probe\n")
    (project / "workflow.py").write_text('''from pathlib import Path
from openprogram.agentic_programming import agentic_function
from openprogram.agentic_programming.runtime import Runtime
from openprogram.providers import registry

def detect():
    Path(__file__).with_name("auto-detect.flag").touch()
    return "unselected-fixture", "fixture-model"

def fake_call(*args, **kwargs):
    Path(__file__).with_name("model-call.flag").touch()
    return "selected model result"

def fake_runtime(provider, model, **kwargs):
    Path(__file__).with_name("selected.txt").write_text(f"{provider}/{model}")
    return Runtime(call=fake_call, model="fixture")

registry.detect_provider = detect
registry._api_routed_runtime = fake_runtime

@agentic_function
def forced_probe(use_model: bool, runtime=None):
    Path(__file__).with_name("entered.flag").touch()
    return runtime.exec("fixture", tools=[]) if use_model else "plain result"
''')
    for command in (["git", "init", "-b", "main"], ["git", "add", "--all"],
                    ["git", "-c", "user.name=Test", "-c", "user.email=test@example.com",
                     "commit", "-m", "Fixture"]):
        subprocess.run(command, cwd=project, check=True, capture_output=True)
    state = tmp_path / ".openprogram"
    state.mkdir()
    (state / "program-sources.json").write_text(json.dumps({
        "version": 2, "catalog_root": str(root), "workflow_projects_migrated": True,
        "programs": [{"scope": "programs", "path": "workflow/forced_probe",
                      "kind": "workflow-publish", "source": "workflow:forced_probe"}],
    }))
    script = '''import json, sys
from openprogram.agent.session_db import default_db
from openprogram.agent.dispatcher import dispatch_forced_tool_call
from openprogram.programs import get_agent_tool
db=default_db()
db.create_session("forced-model", "main", source="test")
assert get_agent_tool("forced_probe") is not None
selected={
    "missing": {},
    "provider_only": {"provider":"selected-fixture"},
    "model_only": {"model":"fixture-model"},
    "auto": {"provider":"auto", "model":"fixture-model"},
    "explicit": {"provider":"selected-fixture", "model":"fixture-model"},
}[sys.argv[2]]
result=dispatch_forced_tool_call("forced-model", "anchor", "forced_probe",
    {"use_model":sys.argv[1]=="True"}, **selected)
print(json.dumps(result, default=str))
'''
    env = {**os.environ, "HOME": str(tmp_path), "USERPROFILE": str(tmp_path),
           "CODEX_HOME": str(tmp_path / ".codex"), "OPENPROGRAM_CONFIG_DIR": str(state)}
    env.pop("OPENPROGRAM_PROFILE", None)
    result = subprocess.run([sys.executable, "-c", script, str(use_model), selection], env=env,
                            capture_output=True, text=True, timeout=45)
    assert result.returncode == 0, result.stderr
    assert (project / "entered.flag").is_file(), result.stdout
    outcome = json.loads(result.stdout.splitlines()[-1])
    assert not (project / "auto-detect.flag").exists(), outcome
    assert outcome["ok"] is (selection == "explicit" or not use_model)
    assert (project / "model-call.flag").exists() is (selection == "explicit" and use_model)
    if selection == "explicit":
        assert (project / "selected.txt").read_text() == "selected-fixture/fixture-model"
    else:
        assert not (project / "selected.txt").exists()
        if use_model:
            assert "No model is configured" in json.dumps(outcome)
