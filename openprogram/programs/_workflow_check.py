"""``openprogram workflows check``: validate, test and commit a workflow.

The package is imported in a separate process, its ``PROGRAM_ENTRIES`` are
checked against the entry contract, and its ``tests/`` run under pytest,
inside the OS sandbox when one is available (no network, no writes to the
package). When everything passes, the change is committed to the
workflow's own Git repository, which makes it callable.
"""
from __future__ import annotations

import json
import os
import shlex
import subprocess
import sys
import tempfile
from pathlib import Path

import openprogram

_TEST_TIMEOUT = 600
_SOURCE_ROOT = str(Path(openprogram.__file__).resolve().parent.parent)

_PROBE = r'''
import json, sys
sys.path[:0] = [sys.argv[1], sys.argv[2]]
from openprogram.agentic_programming.workflow_site import add_workflow_root
add_workflow_root(sys.argv[1])
report = {"entries": [], "problems": []}
try:
    import importlib
    module = importlib.import_module(sys.argv[3])
    from openprogram.programs._workflow_packages import entry_problems
    report["problems"] = entry_problems(module)
    import inspect
    report["entries"] = [inspect.unwrap(entry).__name__ for entry in getattr(module, "PROGRAM_ENTRIES", []) or []
                         if callable(entry)]
except BaseException as exc:
    import traceback
    report["problems"].append("Import failed: " + "".join(traceback.format_exception_only(type(exc), exc)).strip())
    report["traceback"] = traceback.format_exc()[-4000:]
print("\n@@CHECK@@" + json.dumps(report))
'''

_RUNNER = r'''
import importlib, os, sys
sys.path[:0] = [sys.argv[1], sys.argv[2]]
from openprogram.agentic_programming.workflow_site import add_workflow_root
add_workflow_root(sys.argv[1])
# Register the entries as tools, as the worker does, so tests can call them
# through the tool registry.
from openprogram.programs._workflow_packages import register_workflow_entries
_name = os.path.basename(sys.argv[3].rstrip(os.sep))
register_workflow_entries(importlib.import_module(_name), owner=_name)
import pytest
raise SystemExit(pytest.main(["-q", "--tb=short", "-p", "no:cacheprovider",
                              "--rootdir", sys.argv[3], sys.argv[4]]))
'''


class CheckFailed(Exception):
    def __init__(self, message: str, report: dict):
        super().__init__(message)
        self.report = report


def _probe(directory: Path) -> dict:
    with tempfile.TemporaryDirectory(prefix="openprogram-workflow-probe-") as raw:
        script = Path(raw) / "probe.py"
        script.write_text(_PROBE, encoding="utf-8")
        completed = subprocess.run(
            [sys.executable, "-I", "-B", str(script), str(directory.parent), _SOURCE_ROOT, directory.name],
            capture_output=True, text=True, timeout=300, cwd=raw,
        )
    marker = completed.stdout.rfind("@@CHECK@@")
    if marker < 0:
        return {"entries": [], "problems": ["Import process failed:\n" + (completed.stderr or completed.stdout)[-4000:]]}
    return json.loads(completed.stdout[marker + len("@@CHECK@@"):])


def _test_files(directory: Path) -> list[Path]:
    tests = directory / "tests"
    if not tests.is_dir():
        return []
    return sorted(path for path in tests.rglob("test_*.py") if "__pycache__" not in path.parts)


def _run_tests(directory: Path) -> dict:
    from openprogram import sandbox

    with tempfile.TemporaryDirectory(prefix="openprogram-workflow-check-") as raw:
        instance = Path(raw)
        runner = instance / "run_tests.py"
        runner.write_text(_RUNNER, encoding="utf-8")
        (instance / "home").mkdir()
        (instance / "tmp").mkdir()
        command = shlex.join([
            sys.executable, "-I", "-B", str(runner),
            str(directory.parent), _SOURCE_ROOT, str(directory), str(directory / "tests"),
        ])
        env = dict(os.environ)
        sandboxed = sys.platform in {"darwin", "linux"} and not sandbox.unavailable_reason()
        if sandboxed:
            policy = sandbox._with_hard_floor(sandbox.SandboxPolicy(
                deny_write=(*sandbox.DEFAULT_DENY_WRITE, str(directory), str(directory / "**")),
                network=False,
            ))
            argv, shell = sandbox.wrap_command(
                command, str(instance), policy, private_tmp=True, allow_subprocesses=True,
                read_only_roots=(_SOURCE_ROOT, str(directory.parent), sys.prefix, sys.base_prefix),
            )
            env = sandbox.child_env(policy)
        else:
            argv, shell = command, True
        env.update({"HOME": str(instance / "home"), "TMPDIR": str(instance / "tmp"),
                    "PYTEST_DISABLE_PLUGIN_AUTOLOAD": "1"})
        try:
            completed = subprocess.run(argv, shell=shell, cwd=instance, env=env, capture_output=True,
                                       text=True, timeout=_TEST_TIMEOUT)
        except subprocess.TimeoutExpired:
            return {"ran": True, "passed": False, "sandboxed": sandboxed,
                    "output": f"Tests exceeded {_TEST_TIMEOUT} seconds."}
    output = (completed.stdout + completed.stderr)[-8000:]
    return {"ran": True, "passed": completed.returncode == 0, "sandboxed": sandboxed, "output": output}


def _git(directory: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(directory), *args], capture_output=True, text=True, timeout=60)


def _commit(directory: Path, message: str) -> tuple[str, bool]:
    if not (directory / ".git").exists():
        _git(directory, "init", "-q")
    ignore = directory / ".gitignore"
    if not ignore.exists():
        ignore.write_text("__pycache__/\n.pytest_cache/\n*.pyc\n", encoding="utf-8")
    _git(directory, "add", "-A")
    staged = _git(directory, "diff", "--cached", "--quiet").returncode != 0
    has_head = _git(directory, "rev-parse", "--verify", "-q", "HEAD").returncode == 0
    committed = False
    if staged or not has_head:
        identity = []
        if not _git(directory, "config", "user.email").stdout.strip():
            identity = ["-c", "user.name=OpenProgram", "-c", "user.email=workflows@openprogram.local"]
        result = subprocess.run(["git", "-C", str(directory), *identity, "commit", "-q",
                                 "--allow-empty", "-m", message],
                                capture_output=True, text=True, timeout=60)
        if result.returncode != 0:
            raise RuntimeError("git commit failed: " + (result.stderr or result.stdout).strip())
        committed = True
    head = _git(directory, "rev-parse", "HEAD").stdout.strip()
    return head, committed


def check_workflow(directory: str | os.PathLike, *, message: str = "", commit: bool = True) -> dict:
    """Validate, test and (on success) commit one workflow package."""
    from openprogram.programs._workflow_packages import name_problem

    path = Path(directory).expanduser().resolve()
    report: dict = {"ok": False, "workflow": path.name, "path": str(path)}
    if not (path / "__init__.py").is_file():
        report["problems"] = [f"{path} is not a Python package (no __init__.py)."]
        raise CheckFailed(report["problems"][0], report)
    problem = name_problem(path.name, path)
    if problem:
        report["problems"] = [problem]
        raise CheckFailed(problem, report)
    probe = _probe(path)
    report["entries"] = probe.get("entries", [])
    report["problems"] = probe.get("problems", [])
    if report["problems"]:
        if probe.get("traceback"):
            report["traceback"] = probe["traceback"]
        raise CheckFailed("; ".join(report["problems"]), report)
    if _test_files(path):
        report["tests"] = _run_tests(path)
        if not report["tests"]["passed"]:
            raise CheckFailed("Tests failed.", report)
    else:
        report["tests"] = {"ran": False, "passed": True, "output": "No tests in tests/."}
    if commit:
        report["revision"], report["committed"] = _commit(path, message or "Update workflow")
    report["ok"] = True
    return report


__all__ = ["CheckFailed", "check_workflow"]
