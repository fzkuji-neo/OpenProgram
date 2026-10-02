"""Published Workflow discovery through a fresh public CLI process."""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys

import pytest


def _project(root: Path, name: str, *, approved: bool) -> Path:
    from openprogram.programs.workflow._project import catalog

    project = root / name
    project.mkdir(parents=True)
    (project / "pyproject.toml").write_text(catalog._project_pyproject(name, {
        "name": name, "summary": "Published CLI report", "tags": ["report"],
        "entrypoint": name,
    }), encoding="utf-8")
    import_marker = (
        "from pathlib import Path\n"
        "Path(__file__).with_name('imported.flag').touch()\n"
    )
    if approved:
        (project / "__init__.py").write_text(import_marker + f"from .workflow import {name}\n")
        (project / "workflow.py").write_text(
            "from openprogram.agentic_programming import agentic_function\n"
            "@agentic_function\n"
            f"def {name}(task: str):\n"
            '    """Published CLI report."""\n'
            "    raise AssertionError('listing must not execute the workflow')\n",
        )
    else:
        (project / "__init__.py").write_text(
            import_marker + "raise AssertionError('unrecorded workflow must not be imported')\n",
        )
    for command in (
        ["git", "init", "-b", "main"],
        ["git", "add", "--all"],
        ["git", "-c", "user.name=Test", "-c", "user.email=test@example.com",
         "commit", "-m", "Publish CLI fixture"],
    ):
        subprocess.run(command, cwd=project, check=True, capture_output=True)
    return project


@pytest.mark.parametrize("category", ["", "weekly_report"])
def test_programs_list_includes_authorized_published_workflow(tmp_path: Path, category: str):
    catalog_root = tmp_path / "catalog"
    catalog_root.mkdir()
    (catalog_root / "__init__.py").write_text("")
    workflow_root = catalog_root / "workflow"
    parent = workflow_root / category if category else workflow_root
    project = _project(parent, "cli_published_report", approved=True)
    unapproved = _project(parent, "cli_unapproved_report", approved=False)
    state = tmp_path / ".openprogram"
    state.mkdir()
    (state / "program-sources.json").write_text(json.dumps({
        "version": 2,
        "catalog_root": str(catalog_root),
        "workflow_projects_migrated": True,
        "programs": [{"scope": "programs", "path": project.relative_to(catalog_root).as_posix(),
                      "kind": "workflow-publish", "source": "workflow:cli_published_report"}],
    }))
    env = {**os.environ, "HOME": str(tmp_path), "USERPROFILE": str(tmp_path)}
    env.pop("OPENPROGRAM_PROFILE", None)
    result = subprocess.run(
        [sys.executable, "-m", "openprogram", "programs", "list"],
        env=env, capture_output=True, text=True, timeout=30,
    )
    assert result.returncode == 0, result.stderr
    assert (project / "imported.flag").is_file()
    assert not (unapproved / "imported.flag").exists()
    assert "cli_published_report" in result.stdout
    assert result.stdout.count("cli_published_report") == 1
    assert "Published CLI report." in result.stdout
    assert "cli_unapproved_report" not in result.stdout
    assert "auto_workflow" in result.stdout
    assert "Programs (3)" in result.stdout
