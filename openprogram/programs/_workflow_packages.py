"""Workflow packages: loading, registration and checks.

A workflow is a Python package. User workflows live in
``~/.openprogram/workflows/<name>/`` and import under their own top-level
name; built-in workflows import as ``openprogram.programs.workflow.<name>``.
``PROGRAM_ENTRIES`` lists the functions exposed as tools. An optional
``ENTRY_OPTIONS`` dict maps an entry name to tool options (timeout,
toolset, ..., ``run_in_worker`` for a tool that must run in the
worker process instead of a forked subprocess, and ``resumable`` for an
entry whose ``continuation.step`` results survive a restart).

Each user workflow is its own Git repository. ``openprogram workflows
check`` validates the package, runs its tests and commits; only a clean,
committed package loads, so a passing check is what makes a change
callable. A package with uncommitted edits keeps serving the version that
loaded last.
"""
from __future__ import annotations

import functools
import hashlib
import importlib
import importlib.machinery
import importlib.util
import inspect
import logging
import os
import subprocess
import sys
import threading
import traceback
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_IGNORED_DIRS = {".git", "__pycache__", ".pytest_cache", ".venv", "venv", "node_modules"}
_lock = threading.RLock()


@dataclass
class WorkflowStatus:
    """What the Programs page shows for one user workflow."""

    name: str
    path: str
    state: str = "pending"          # loaded | error | pending
    error: str = ""
    entries: list[str] = field(default_factory=list)
    revision: str = ""
    note: str = ""

    def to_dict(self) -> dict:
        return {
            "name": self.name, "path": self.path, "state": self.state,
            "error": self.error, "entries": list(self.entries),
            "revision": self.revision, "note": self.note,
        }


_status: dict[str, WorkflowStatus] = {}
_fingerprints: dict[str, tuple] = {}
_tools: dict[str, list[str]] = {}


def workflows_root() -> Path:
    from openprogram.agentic_programming.workflow_site import user_workflow_root
    return Path(user_workflow_root())


# ---------------------------------------------------------------------------
# Entry registration (built-in and user workflows)
# ---------------------------------------------------------------------------


def _bound_entry(entry, fn):
    """Call ``entry`` (decorators included) with ``fn`` bound as the running entry."""
    from openprogram.agentic_programming.workflow_site import bind_entry
    if inspect.iscoroutinefunction(fn):
        @functools.wraps(fn)
        async def bound(*args, **kwargs):
            with bind_entry(fn):
                return await entry(*args, **kwargs)
    else:
        @functools.wraps(fn)
        def bound(*args, **kwargs):
            with bind_entry(fn):
                return entry(*args, **kwargs)
    return bound


def _revision(owner: str, fn) -> str:
    """The code identity a resumable entry is admitted and resumed under.

    A user workflow is its loaded Git commit. A built-in workflow is the
    content of its package's Python files.
    """
    status = _status.get(owner)
    if status is not None and status.revision:
        return f"{owner}@{status.revision}"
    module = sys.modules.get(fn.__module__)
    package = Path(getattr(module, "__file__", "") or ".").resolve().parent
    digest = hashlib.sha256()
    for path in sorted(package.rglob("*.py")):
        if "__pycache__" not in path.parts and "tests" not in path.relative_to(package).parts:
            digest.update(str(path.relative_to(package)).encode() + b"\0" + path.read_bytes())
    return f"{owner}#{digest.hexdigest()}"


def entry_problems(module) -> list[str]:
    """Contract problems in a workflow module's ``PROGRAM_ENTRIES``."""
    entries = getattr(module, "PROGRAM_ENTRIES", None)
    if not isinstance(entries, (list, tuple)) or not entries:
        return ["PROGRAM_ENTRIES must be a non-empty list of functions."]
    problems = []
    options = getattr(module, "ENTRY_OPTIONS", {}) or {}
    if not isinstance(options, dict):
        problems.append("ENTRY_OPTIONS must be a dict keyed by entry name.")
    for entry in entries:
        fn = inspect.unwrap(entry)
        if not inspect.isfunction(fn):
            problems.append(f"{entry!r} in PROGRAM_ENTRIES is not a function.")
            continue
        if inspect.isgeneratorfunction(fn) or inspect.isasyncgenfunction(fn):
            problems.append(f"{fn.__name__}: entries cannot be generators.")
        if not (inspect.getdoc(fn) or "").strip():
            problems.append(f"{fn.__name__}: an entry needs a docstring; it is the tool description.")
        entry_options = options.get(fn.__name__, {}) if isinstance(options, dict) else {}
        if entry_options.get("resumable"):
            if inspect.iscoroutinefunction(fn):
                problems.append(f"{fn.__name__}: a resumable entry must be synchronous.")
            if entry_options.get("run_in_worker"):
                problems.append(f"{fn.__name__}: a resumable entry cannot run in the worker.")
        for parameter in inspect.signature(fn).parameters.values():
            if parameter.kind in (parameter.VAR_POSITIONAL, parameter.VAR_KEYWORD):
                problems.append(f"{fn.__name__}: *{parameter.name} cannot be a tool parameter.")
            elif parameter.annotation is inspect.Parameter.empty and parameter.name not in ("runtime",):
                problems.append(f"{fn.__name__}: parameter {parameter.name!r} needs a type annotation.")
    return problems


def register_workflow_entries(module, *, owner: str = "") -> list[str]:
    """Register ``PROGRAM_ENTRIES`` as tools. Returns the tool names."""
    from openprogram.agentic_programming.agent_method import register_agent_method, wrap_agent_method
    problems = entry_problems(module)
    if problems:
        raise ImportError("; ".join(problems))
    options_by_name = dict(getattr(module, "ENTRY_OPTIONS", {}) or {})
    from openprogram.programs._runtime import get
    taken = []
    for entry in module.PROGRAM_ENTRIES:
        fn = inspect.unwrap(entry)
        name = options_by_name.get(fn.__name__, {}).get("name") or fn.__name__
        existing = get(name)
        if existing is not None and getattr(existing, "_workflow_owner", None) != owner:
            taken.append(name)
    if taken:
        raise ImportError("Tool names already in use: " + ", ".join(taken))
    registered = []
    replacements = {}
    for entry in module.PROGRAM_ENTRIES:
        if getattr(entry, "_workflow_entry", False):
            registered.append(entry._agent_tool.name)
            continue
        fn = inspect.unwrap(entry)
        options = {"tool": True, "name": fn.__name__, **options_by_name.get(fn.__name__, {})}
        # Runs in the worker process instead of a forked subprocess, for
        # tools that use worker-owned registries.
        run_in_worker = bool(options.pop("run_in_worker", False))
        bound = _bound_entry(entry, fn)
        if options.get("resumable"):
            bound._workflow_revision = functools.partial(_revision, owner, fn)
        wrapper = wrap_agent_method(bound, options)
        tool = register_agent_method(wrapper, options)
        wrapper._workflow_entry = True
        wrapper._workflow_owner = owner
        if tool is not None:
            tool._python_callable = wrapper
            tool._workflow_owner = owner
            if run_in_worker:
                tool._run_in_worker = True
            wrapper._agent_tool = tool
            registered.append(tool.name)
        replacements[id(entry)] = wrapper
        defining = sys.modules.get(fn.__module__)
        if defining is not None and getattr(defining, fn.__name__, None) in (entry, fn):
            setattr(defining, fn.__name__, wrapper)
    for name, value in list(vars(module).items()):
        if id(value) in replacements:
            setattr(module, name, replacements[id(value)])
    module.PROGRAM_ENTRIES = [replacements.get(id(entry), entry) for entry in module.PROGRAM_ENTRIES]
    return registered


# ---------------------------------------------------------------------------
# User workflow packages
# ---------------------------------------------------------------------------


class _WorkflowFinder:
    """Resolve top-level names of loadable user workflow packages."""

    def __init__(self):
        self.packages: dict[str, Path] = {}

    def find_spec(self, fullname, path=None, target=None):
        if path is not None or "." in fullname:
            return None
        directory = self.packages.get(fullname)
        if directory is None:
            return None
        return importlib.util.spec_from_file_location(
            fullname, directory / "__init__.py",
            submodule_search_locations=[str(directory)],
        )


_finder = _WorkflowFinder()


def _install_finder() -> None:
    if _finder not in sys.meta_path:
        sys.meta_path.insert(0, _finder)


def _candidates(root: Path) -> dict[str, Path]:
    found = {}
    if not root.is_dir():
        return found
    for child in sorted(root.iterdir()):
        if (child.name.startswith((".", "_")) or not child.is_dir()
                or child.is_symlink() or not (child / "__init__.py").is_file()):
            continue
        found[child.name] = child
    return found


def name_problem(name: str, directory: Path | None = None) -> str:
    """Why ``name`` cannot be a workflow package name, or ``""``."""
    if not name.isidentifier() or name.startswith("_"):
        return f"{name!r} is not a valid Python package name."
    if name in sys.builtin_module_names or name in getattr(sys, "stdlib_module_names", ()):
        return f"{name!r} is a Python standard library module."
    root = os.path.realpath(directory.parent) if directory is not None else os.path.realpath(workflows_root())
    loaded = sys.modules.get(name)
    origin = getattr(loaded, "__file__", None) if loaded is not None else None
    if origin and not os.path.realpath(origin).startswith(root + os.sep):
        return f"{name!r} is already an imported module ({origin})."
    try:
        spec = importlib.machinery.PathFinder.find_spec(name)
    except (ImportError, ValueError):
        spec = None
    origin = getattr(spec, "origin", None) or (list(spec.submodule_search_locations or [""])[0] if spec else "")
    if spec is not None and origin and not os.path.realpath(origin).startswith(root + os.sep):
        return f"{name!r} is already an importable module ({origin})."
    return ""


def fingerprint(directory: Path) -> tuple:
    """A cheap signature of a package's files and Git state."""
    rows = []
    for base, names, files in os.walk(directory):
        names[:] = sorted(n for n in names if n not in _IGNORED_DIRS and not n.startswith("."))
        for file in sorted(files):
            if file.endswith((".pyc", ".pyo")):
                continue
            path = Path(base) / file
            try:
                stat = path.stat()
            except OSError:
                continue
            rows.append((str(path.relative_to(directory)), stat.st_mtime_ns, stat.st_size))
            if len(rows) > 2000:
                break
    git = directory / ".git"
    for name in ("HEAD", "index"):
        try:
            rows.append((f".git/{name}", (git / name).stat().st_mtime_ns, 0))
        except OSError:
            pass
    return tuple(rows)


def git_state(directory: Path) -> tuple[str, bool]:
    """``(HEAD commit, has uncommitted changes)``; ``("", True)`` without a commit."""
    if not (directory / ".git").exists():
        return "", True
    try:
        head = subprocess.run(["git", "-C", str(directory), "rev-parse", "--verify", "-q", "HEAD"],
                              capture_output=True, text=True, timeout=10).stdout.strip()
        status = subprocess.run(["git", "-C", str(directory), "status", "--porcelain"],
                                capture_output=True, text=True, timeout=10).stdout
    except (OSError, subprocess.SubprocessError):
        return "", True
    return head, bool(status.strip())


def _evict(name: str) -> None:
    for module_name in [m for m in sys.modules if m == name or m.startswith(name + ".")]:
        del sys.modules[module_name]
    importlib.invalidate_caches()


def _unregister(name: str) -> None:
    from openprogram.programs._runtime import unregister
    for tool_name in _tools.pop(name, []):
        unregister(tool_name)


def _error_text(exc: BaseException) -> str:
    frames = traceback.extract_tb(exc.__traceback__)
    where = next((f"{frame.filename}:{frame.lineno}" for frame in reversed(frames)
                  if str(workflows_root()) in frame.filename), "")
    message = f"{type(exc).__name__}: {exc}"
    return f"{message} ({where})" if where else message


def _load_one(name: str, directory: Path) -> None:
    status = _status.setdefault(name, WorkflowStatus(name, str(directory)))
    status.path = str(directory)
    problem = name_problem(name, directory)
    if problem:
        _unregister(name)
        status.state, status.error, status.entries, status.note = "error", problem, [], ""
        return
    head, dirty = git_state(directory)
    loaded = bool(_tools.get(name))
    if not head or dirty:
        note = (f"Run `openprogram workflows check {directory}` to make it callable."
                if not head else "Uncommitted changes. Run `openprogram workflows check` to load them.")
        if loaded:
            status.note = note
            return
        status.state, status.error, status.note = "pending", "", note
        return
    if loaded and status.revision == head and status.state == "loaded":
        status.note = ""
        return
    _unregister(name)
    _evict(name)
    _finder.packages[name] = directory
    try:
        module = importlib.import_module(name)
        tools = register_workflow_entries(module, owner=name)
    except BaseException as exc:  # a broken package must not stop the others
        if isinstance(exc, (KeyboardInterrupt, SystemExit)):
            raise
        _evict(name)
        status.state, status.error, status.entries, status.note = "error", _error_text(exc), [], ""
        logger.warning("Cannot load workflow %s: %s", name, status.error)
        return
    _tools[name] = list(tools)
    status.state, status.error, status.revision, status.note = "loaded", "", head, ""
    status.entries = list(tools)


def load_user_workflows(root: Path | None = None) -> dict[str, WorkflowStatus]:
    """Load, reload or drop user workflows to match the directory."""
    from openprogram.agentic_programming.workflow_site import add_workflow_root
    root = root or workflows_root()
    with _lock:
        add_workflow_root(root)
        _install_finder()
        found = _candidates(root)
        for name in list(_status):
            if name not in found:
                _unregister(name)
                _evict(name)
                _finder.packages.pop(name, None)
                _status.pop(name, None)
                _fingerprints.pop(name, None)
        for name, directory in found.items():
            if not name_problem(name, directory):
                _finder.packages[name] = directory
        for name, directory in found.items():
            current = fingerprint(directory)
            if _fingerprints.get(name) == current and name in _status:
                continue
            _fingerprints[name] = current
            _load_one(name, directory)
        return dict(_status)


def workflow_statuses() -> list[dict]:
    with _lock:
        return [status.to_dict() for status in sorted(_status.values(), key=lambda s: s.name)]


def root_fingerprint() -> tuple:
    root = workflows_root()
    return tuple((name, fingerprint(directory)) for name, directory in _candidates(root).items())


__all__ = [
    "WorkflowStatus", "entry_problems", "fingerprint", "git_state",
    "load_user_workflows", "name_problem", "register_workflow_entries",
    "root_fingerprint", "workflow_statuses", "workflows_root",
]
