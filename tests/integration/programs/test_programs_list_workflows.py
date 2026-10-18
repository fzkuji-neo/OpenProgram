"""User Workflow discovery through a fresh public CLI process."""

from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys


def _workflow(root: Path, name: str, *, commit: bool) -> Path:
    package = root / name
    package.mkdir(parents=True)
    (package / "__init__.py").write_text(
        "from pathlib import Path\n"
        "Path(__file__).with_name('imported.flag').touch()\n"
        f"from .workflow import {name}\n"
        f"PROGRAM_ENTRIES = [{name}]\n",
        encoding="utf-8",
    )
    (package / "workflow.py").write_text(
        f"def {name}(task: str) -> str:\n"
        '    """Prepare a CLI report."""\n'
        "    raise AssertionError('listing must not execute the workflow')\n",
        encoding="utf-8",
    )
    subprocess.run(["git", "init", "-q", "-b", "main"], cwd=package, check=True)
    if commit:
        subprocess.run(["git", "add", "--all"], cwd=package, check=True)
        subprocess.run(
            ["git", "-c", "user.name=Test", "-c", "user.email=test@example.com",
             "commit", "-qm", "First version"],
            cwd=package, check=True,
        )
    return package


def test_programs_list_includes_committed_user_workflows_only(tmp_path: Path):
    root = tmp_path / ".openprogram" / "workflows"
    committed = _workflow(root, "cli_report", commit=True)
    pending = _workflow(root, "cli_pending_report", commit=False)
    env = {**os.environ, "HOME": str(tmp_path), "USERPROFILE": str(tmp_path)}
    env.pop("OPENPROGRAM_PROFILE", None)
    result = subprocess.run(
        [sys.executable, "-m", "openprogram", "programs", "list"],
        env=env, capture_output=True, text=True, timeout=60,
    )
    assert result.returncode == 0, result.stderr
    assert (committed / "imported.flag").is_file()
    assert not (pending / "imported.flag").exists()
    assert result.stdout.count("cli_report") == 1
    assert "Prepare a CLI report." in result.stdout
    assert "cli_pending_report" not in result.stdout
    assert "auto_workflow" not in result.stdout

    listed = subprocess.run(
        [sys.executable, "-m", "openprogram", "workflows", "list"],
        env=env, capture_output=True, text=True, timeout=60,
    )
    assert listed.returncode == 0, listed.stderr
    assert "cli_report" in listed.stdout and "cli_pending_report" in listed.stdout
