"""
Helpers for locating research artifacts.

Previously this module mirrored project artifacts into <repo>/deliverables/
when project_dir pointed outside the workspace — a workaround for a codex
sandbox that could not write arbitrary paths. That is no longer needed:
entry agentic functions now accept an explicit `work_dir` parameter and
set runtime.workdir so codex --cd runs where the user asked.

The API is kept so `stages/idea.py` still compiles, but every helper now
operates on the original project_dir — no mirror.
"""

from __future__ import annotations

import os
from pathlib import Path


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[4]


def expanded_project_dir(project_dir: str) -> Path:
    from openprogram.worktree.path_resolve import resolve_path
    resolved, _warning = resolve_path(os.path.expanduser(project_dir))
    return Path(resolved).absolute()


def project_artifact_roots(project_dir: str) -> list[Path]:
    return [expanded_project_dir(project_dir)]


def find_project_artifact(project_dir: str, *relative_paths: str) -> Path | None:
    root = expanded_project_dir(project_dir)
    for rel_path in relative_paths:
        candidate = root / rel_path
        if candidate.exists():
            return candidate
    return None


def writable_project_dir(project_dir: str) -> Path:
    return expanded_project_dir(project_dir)


def read_artifact(path: str | Path) -> str:
    """Read complete text with sandbox, cancellation and approval checks."""
    from openprogram.agent.permissions.file_state import check_current
    from openprogram.agentic_programming.function import check_cancelled
    from openprogram.sandbox import validate_read_path
    from openprogram.store.snapshot import read_tracking

    target = str(Path(path).absolute())
    check_cancelled()
    violation = validate_read_path(target)
    if violation:
        raise ValueError(f"sandbox policy: {violation}")
    check_current(target)
    text = Path(target).read_text(encoding="utf-8")
    check_current(target)
    read_tracking.mark_seen(target)
    return text


def write_artifact(path: str | Path, content: str) -> None:
    """Publish through the normal checkpointed writer and surface refusals."""
    from openprogram.agentic_programming.function import check_cancelled
    from openprogram.programs.tools.files.write import execute as write

    target = Path(path).absolute()
    if not isinstance(content, str) or not content.strip():
        raise ValueError("artifact content must be nonempty text")
    check_cancelled()
    if target.exists():
        read_artifact(target)
    result = write(str(target), content)
    if not isinstance(result, str) or not any(line.startswith("Wrote ") for line in result.splitlines()):
        raise RuntimeError(f"Could not write research artifact: {result}")
