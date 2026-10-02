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
