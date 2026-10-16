"""One-time move of conversations and memory into their project folders.

Older installs kept three parallel trees:

* ``<state>/sessions/<id>/`` and ``<state>/sessions/projects/<pid>/<id>/``
  for conversations, with the store's index, location map, locks and
  tombstones beside them;
* ``<state>/memory/`` for the personal memory;
* ``<project>/.openprogram/memory/`` inside each project's own folder for
  that project's memory.

:func:`ensure_layout` moves all of it under ``<state>/projects/`` (see
:mod:`.layout`) the first time any process asks for the store root, after
copying the old trees to ``<state>/backups/layout-<time>/``. Absolute paths
that conversations recorded into their own files (tool calls, attachments,
meta) are rewritten to the new places, so a continued conversation finds
what it wrote before. A file lock keeps two processes from running it
together.

A process started from an older install can still write the old trees
after the move. Every first use per process therefore checks for them
again and merges what they gained: new conversations move in, while empty
conversation shells and freshly initialised memory workspaces that
duplicate what already moved are dropped.
"""
from __future__ import annotations

import json
import logging
import os
import re
import shutil
import threading
import time
from pathlib import Path

from openprogram import _compat as fcntl

from .layout import CHATS, DEFAULT_PROJECT_ID, MEMORY, SETTINGS, projects_root

_log = logging.getLogger(__name__)

MARKER = ".layout"
LAYOUT_VERSION = 1

_done: set[str] = set()
_lock = threading.Lock()

# Store bookkeeping that moves from the old sessions root to the new one.
_HIDDEN = (".deleted", ".locks", ".goal-locks", ".migration",
           ".quarantine", ".session-locks")
_RENAMED = {"index.json": ".chats-index.json",
            "locations.json": ".chats-locations.json"}
# Session files that may record absolute paths; larger ones are skipped.
_TEXT_SUFFIXES = {".json", ".jsonl", ".md", ".txt"}
_MAX_REWRITE_BYTES = 32 * 1024 * 1024


def ensure_layout(state: Path | str | None = None) -> Path:
    """The store root ``<state>/projects``, migrated if this is the first use."""
    if state is None:
        from openprogram.paths import get_state_dir

        state = get_state_dir()
    state = Path(state)
    root = projects_root(state)
    key = str(state)
    if key in _done:
        return root
    with _lock:
        if key in _done:
            return root
        root.mkdir(parents=True, exist_ok=True)
        if not (root / MARKER).is_file() or _legacy_present(state):
            with _file_lock(root / ".layout.lock"):
                if not (root / MARKER).is_file() or _legacy_present(state):
                    migrate(state)
                    (root / MARKER).write_text(
                        json.dumps({"version": LAYOUT_VERSION}) + "\n",
                        encoding="utf-8",
                    )
        _done.add(key)
    return root


def _legacy_present(state: Path) -> bool:
    """Whether an old tree exists (again) beside the project folders."""
    return _old_sessions_root(state) is not None or (state / MEMORY).is_dir()


class _file_lock:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.handle = None

    def __enter__(self):
        self.handle = self.path.open("a+")
        fcntl.flock(self.handle.fileno(), fcntl.LOCK_EX)
        return self

    def __exit__(self, *_exc):
        try:
            fcntl.flock(self.handle.fileno(), fcntl.LOCK_UN)
        finally:
            self.handle.close()


# ---------------------------------------------------------------------------
# The move
# ---------------------------------------------------------------------------

def migrate(state: Path) -> dict[str, int]:
    """Move every legacy tree under ``<state>/projects``. Idempotent."""
    state = Path(state)
    root = projects_root(state)
    old_sessions = _old_sessions_root(state)
    registry = _read_registry(root)
    project_memories = _project_memories(registry)
    old_memory = state / MEMORY
    if old_sessions is None and not old_memory.is_dir() and not project_memories \
            and not (root / "default-settings.json").is_file():
        return {}

    _backup(state, old_sessions, old_memory, project_memories)
    counts = {"chats": 0, "memories": 0}
    moves: dict[str, str] = {}
    if old_sessions is not None:
        counts["chats"] = _move_sessions(state, old_sessions, root, registry, moves)
    if old_memory.is_dir():
        if _move_dir(old_memory, root / DEFAULT_PROJECT_ID / MEMORY):
            counts["memories"] += 1
        elif old_memory.is_dir():
            _retire_memory(old_memory, state)
    for project_id, source in project_memories.items():
        if _move_dir(source, root / project_id / MEMORY):
            counts["memories"] += 1
    legacy_settings = root / "default-settings.json"
    target_settings = root / DEFAULT_PROJECT_ID / SETTINGS
    if legacy_settings.is_file() and not target_settings.exists():
        target_settings.parent.mkdir(parents=True, exist_ok=True)
        legacy_settings.rename(target_settings)
    if moves:
        _rewrite_paths(root, state, moves)
    _log.info("moved %(chats)d conversations and %(memories)d memory "
              "workspaces into project folders", counts)
    return counts


def _old_sessions_root(state: Path) -> Path | None:
    for name in ("sessions", "sessions-git"):
        candidate = state / name
        if candidate.is_dir() and not candidate.is_symlink():
            return candidate
    return None


def _read_registry(root: Path) -> dict[str, dict]:
    try:
        data = json.loads((root / "projects.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _project_memories(registry: dict[str, dict]) -> dict[str, Path]:
    found: dict[str, Path] = {}
    for project_id, record in registry.items():
        if not isinstance(record, dict) or record.get("is_default"):
            continue
        path = record.get("path")
        if not path:
            continue
        source = Path(path).expanduser() / ".openprogram" / MEMORY
        try:
            if source.is_dir() and not source.is_symlink():
                found[str(project_id)] = source
        except OSError:
            continue
    return found


def _backup(state: Path, sessions: Path | None, memory: Path,
            project_memories: dict[str, Path]) -> None:
    """Copy every tree the move touches. A failed copy stops the move."""
    base = state / "backups" / f"layout-{time.strftime('%Y%m%d-%H%M%S')}"
    target, n = base, 1
    while target.exists():
        n += 1
        target = base.with_name(f"{base.name}-{n}")
    target.mkdir(parents=True)
    ignore = shutil.ignore_patterns("*.lock", ".locks", ".session-locks")
    if sessions is not None:
        shutil.copytree(sessions, target / "sessions", symlinks=True, ignore=ignore)
    if memory.is_dir():
        shutil.copytree(memory, target / "memory", symlinks=True, ignore=ignore)
    for project_id, source in project_memories.items():
        shutil.copytree(source, target / "project-memory" / project_id,
                        symlinks=True, ignore=ignore)
    _log.info("backed up the pre-migration state to %s", target)


def _project_for(session_id: str, session_dir: Path, registry: dict[str, dict],
                 bound: dict[str, str]) -> str:
    project_id = bound.get(session_id)
    if project_id is None:
        try:
            meta = json.loads((session_dir / "meta.json").read_text(encoding="utf-8"))
            project_id = meta.get("project_id") if isinstance(meta, dict) else None
        except (OSError, json.JSONDecodeError):
            project_id = None
    record = registry.get(project_id or "")
    if not isinstance(record, dict) or record.get("is_default"):
        return DEFAULT_PROJECT_ID
    return str(project_id)


def _looks_like_session(path: Path) -> bool:
    return (path / "history").is_dir() or (path / "meta.json").is_file()


def _move_sessions(state: Path, old: Path, root: Path,
                   registry: dict[str, dict], moves: dict[str, str]) -> int:
    bound: dict[str, str] = {}
    for project_id, record in registry.items():
        if isinstance(record, dict) and not record.get("is_default"):
            for sid in record.get("session_ids") or []:
                bound.setdefault(str(sid), str(project_id))
    moved = 0
    homes: dict[str, str] = {}

    def place(session_id: str, source: Path, project_id: str) -> None:
        nonlocal moved
        dest = root / project_id / CHATS / session_id
        homes[session_id] = project_id
        if dest.exists():
            if not _has_entries(source / "history"):
                # An older process re-created an empty shell of a moved chat.
                shutil.rmtree(source, ignore_errors=True)
                return
            _log.warning("conversation %s already at %s; left %s in place",
                         session_id, dest, source)
            return
        dest.parent.mkdir(parents=True, exist_ok=True)
        os.rename(source, dest)
        moves[str(source)] = str(dest)
        moved += 1

    nested = old / "projects"
    if nested.is_dir():
        for project_dir in sorted(nested.iterdir()):
            if not project_dir.is_dir() or project_dir.name.startswith("."):
                continue
            for child in sorted(project_dir.iterdir()):
                if child.is_dir() and not child.name.startswith(".") \
                        and _looks_like_session(child):
                    place(child.name, child, project_dir.name)
            recovery = project_dir / ".file-recovery"
            if recovery.is_dir():
                _merge_dir(recovery, root / project_dir.name / CHATS / ".file-recovery")
    placed = _placed(root)
    for child in sorted(old.iterdir()):
        if child.name.startswith(".") or child.name == "projects" \
                or not child.is_dir() or not _looks_like_session(child):
            continue
        project_id = placed.get(child.name) \
            or _project_for(child.name, child, registry, bound)
        place(child.name, child, project_id)

    recovery = old / ".file-recovery"
    if recovery.is_dir():
        for entry in sorted(recovery.iterdir()):
            project_id = homes.get(entry.name, DEFAULT_PROJECT_ID)
            _move_into(entry, root / project_id / CHATS / ".file-recovery")
    for name in _HIDDEN:
        if (old / name).is_dir():
            _merge_dir(old / name, root / name)
    for name, renamed in _RENAMED.items():
        source = old / name
        if not source.is_file():
            continue
        if (root / renamed).exists():
            if name == "index.json":
                source.unlink()  # a cache; the store rebuilds what it lacks
            continue
        source.rename(root / renamed)
    _retire(old, state)
    return moved


def _placed(root: Path) -> dict[str, str]:
    """Conversations already in a project folder, by id."""
    found: dict[str, str] = {}
    for project_dir in root.iterdir() if root.is_dir() else ():
        chats = project_dir / CHATS
        if project_dir.name.startswith(".") or not chats.is_dir():
            continue
        for child in chats.iterdir():
            if not child.name.startswith("."):
                found.setdefault(child.name, project_dir.name)
    return found


def _has_entries(path: Path) -> bool:
    try:
        return any(path.iterdir())
    except OSError:
        return False


def _move_into(entry: Path, directory: Path) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    dest = directory / entry.name
    if dest.exists():
        if entry.is_file() and entry.name.endswith(".lock"):
            entry.unlink()  # the target already has this lock file
            return
        _log.warning("%s already exists; left %s in place", dest, entry)
        return
    os.rename(entry, dest)


def _merge_dir(source: Path, dest: Path) -> None:
    if not dest.exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        os.rename(source, dest)
        return
    for entry in sorted(source.iterdir()):
        if entry.is_dir() and (dest / entry.name).is_dir():
            _merge_dir(entry, dest / entry.name)
        else:
            _move_into(entry, dest)
    _remove_if_empty(source)


def _move_dir(source: Path, dest: Path) -> bool:
    """Move one workspace; leaves the source when the target already has one.

    A source holding no notes of its own (an older process initialised an
    empty workspace after the move) is dropped instead.
    """
    if dest.exists() and any(dest.iterdir()):
        if not _has_notes(source):
            shutil.rmtree(source, ignore_errors=True)
            return False
        _log.warning("%s already holds a workspace; left %s in place", dest, source)
        return False
    if dest.exists():
        dest.rmdir()
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(source), str(dest))
    return True


def _has_notes(workspace: Path) -> bool:
    """Whether a memory workspace holds files beyond its Git and runtime dirs."""
    for path in workspace.rglob("*"):
        parts = path.relative_to(workspace).parts
        if parts[0] in (".git", ".scriptorium"):
            continue
        if path.is_file():
            return True
    return False


def _remove_if_empty(path: Path) -> None:
    try:
        for entry in path.iterdir():
            if entry.is_dir() and not entry.is_symlink():
                _remove_if_empty(entry)
        path.rmdir()
    except OSError:
        pass


def _retire(old: Path, state: Path) -> None:
    """Drop the old root once only empty folders and lock files remain."""
    leftovers = [p for p in old.rglob("*")
                 if p.is_file() and not p.name.endswith(".lock")]
    if leftovers:
        dest = state / f"{old.name}.legacy"
        if dest.exists():
            dest = state / f"{old.name}.legacy-{time.strftime('%Y%m%d-%H%M%S')}"
        if not dest.exists():
            old.rename(dest)
            _log.warning("%d unrecognised files kept at %s", len(leftovers), dest)
        return
    shutil.rmtree(old, ignore_errors=True)


def _retire_memory(old: Path, state: Path) -> None:
    """Set aside a personal workspace that could not merge, so it stays found."""
    dest = state / f"{old.name}.legacy"
    if dest.exists():
        dest = state / f"{old.name}.legacy-{time.strftime('%Y%m%d-%H%M%S')}"
    old.rename(dest)
    _log.warning("a second personal memory workspace was kept at %s", dest)


# ---------------------------------------------------------------------------
# Recorded paths
# ---------------------------------------------------------------------------

def _rewrite_paths(root: Path, state: Path, moves: dict[str, str]) -> None:
    """Point recorded absolute paths at the moved conversations."""
    old_root = _old_prefixes(state)
    pattern = re.compile(
        "(" + "|".join(re.escape(p) for p in old_root) + r")/sessions(?:-git)?/"
        r"(?:projects/([A-Za-z0-9_.\-]+)/)?([A-Za-z0-9_.\-]+)"
    )
    by_session = {Path(src).name: Path(dest) for src, dest in moves.items()}
    home = str(Path.home())

    def replace(match: re.Match) -> str:
        dest = by_session.get(match.group(3))
        if dest is None:
            return match.group(0)
        prefix = match.group(1)
        new = str(dest)
        if prefix.startswith("~") and new.startswith(home):
            new = "~" + new[len(home):]
        return new

    def rewrite(path: Path) -> None:
        try:
            if path.stat().st_size > _MAX_REWRITE_BYTES:
                return
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            return
        if "/sessions" not in text:
            return
        updated = pattern.sub(replace, text)
        if updated != text:
            tmp = path.with_name(f".{path.name}.layout-tmp")
            tmp.write_text(updated, encoding="utf-8")
            os.replace(tmp, path)

    for dest in moves.values():
        for path in Path(dest).rglob("*"):
            if path.suffix in _TEXT_SUFFIXES and path.is_file() and not path.is_symlink() \
                    and "workdir" not in path.relative_to(dest).parts[:1]:
                rewrite(path)
    for name in (".chats-locations.json",):
        if (root / name).is_file():
            rewrite(root / name)
    journal = root / ".migration" / "journal.json"
    if journal.is_file():
        rewrite(journal)


def _old_prefixes(state: Path) -> list[str]:
    state = Path(state)
    prefixes = {str(state)}
    try:
        prefixes.add(str(state.resolve()))
    except OSError:
        pass
    home = Path.home()
    for prefix in list(prefixes):
        if prefix.startswith(str(home) + os.sep):
            prefixes.add("~" + prefix[len(str(home)):])
    return sorted(prefixes, key=len, reverse=True)


__all__ = ["ensure_layout", "migrate", "MARKER"]
