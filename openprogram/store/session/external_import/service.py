"""Find importable transcripts and import them as OpenProgram sessions.

``list_candidates`` reports every Claude Code / Codex transcript on this
machine with its import state; ``import_transcripts`` brings a chosen set
in. Re-running an import is safe: an unchanged source is skipped, a
source that only grew gets its new turns appended to the same session,
and one that was rewound (or whose imported session was continued here)
becomes a new session, so nothing already in OpenProgram is rewritten.

A conversation joins the registered project whose folder holds its
working directory. Unregistered folders are not registered on the fly —
importing old history must not scatter project markers across the disk —
so those conversations land in the default project, with the original
directory kept in ``imported_from.cwd``.
"""
from __future__ import annotations

import logging
import time
import uuid
from pathlib import Path
from typing import Any, Iterable, Optional

from . import claude_code, codex
from .ledger import load_scans, locked, save_scans
from .model import AGENT_LABELS, AGENTS, CLAUDE_CODE, CODEX, Candidate, ExternalSession
from .writer import node_prefix, reply_id, write_turns

_log = logging.getLogger(__name__)


def _homes(homes: Optional[dict[str, Path]]) -> dict[str, Path]:
    homes = homes or {}
    return {
        CLAUDE_CODE: Path(homes.get(CLAUDE_CODE) or claude_code.default_home()),
        CODEX: Path(homes.get(CODEX) or codex.default_home()),
    }


def _summaries(agent: str, home: Path, ledger_root: Optional[Path] = None) -> list[Candidate]:
    if agent == CLAUDE_CODE:
        # Claude Code titles can sit anywhere in a transcript; resume each
        # file's scan where the last listing stopped instead of rereading it.
        cached = load_scans(ledger_root)
        scans = {}
        found = []
        for path in claude_code.discover(home):
            scans[str(path)] = cached.get(str(path)) or {}
            found.append(claude_code.summarize(path, scans[str(path)]))
        save_scans(scans, ledger_root)
    else:
        titles = codex.thread_titles(home)
        found = (codex.summarize(p, titles) for p in codex.discover(home))
    return [c for c in found if c is not None]


def _parse(candidate: Candidate, home: Path) -> ExternalSession:
    if candidate.agent == CLAUDE_CODE:
        return claude_code.parse(candidate.path)
    return codex.parse(candidate.path, codex.thread_titles(home))


def _changed(candidate: Candidate, entry: dict[str, Any]) -> bool:
    """Whether a message was added since the import.

    Compared on the last message's time, not the file's size or mtime:
    a running agent keeps appending bookkeeping records to a transcript
    whose conversation has not moved.
    """
    seen = entry.get("last_message_at")
    return seen is None or candidate.updated_at > float(seen) + 0.5


def _state(candidate: Candidate, entry: Optional[dict[str, Any]], store) -> str:
    if entry and entry.get("empty"):
        return "new" if _changed(candidate, entry) else "empty"
    if not entry or store.get_session(entry.get("session_id") or "") is None:
        return "new"
    return "updated" if _changed(candidate, entry) else "imported"


def list_candidates(
    agents: Iterable[str] = AGENTS,
    *,
    since: Optional[float] = None,
    homes: Optional[dict[str, Path]] = None,
    store=None,
    ledger_root: Optional[Path] = None,
) -> list[dict[str, Any]]:
    """Every transcript found, newest first, with ``state`` and ``session_id``.

    ``state`` is ``new`` (never imported, or its session was deleted),
    ``imported`` (up to date), ``updated`` (the source changed since) or
    ``empty`` (nothing was ever answered in it; skipped until it changes).
    """
    store = store or _default_store()
    roots = _homes(homes)
    from .ledger import Ledger
    ledger = Ledger(ledger_root).load()
    rows = []
    for agent in agents:
        for candidate in _summaries(agent, roots[agent], ledger_root):
            if since is not None and candidate.updated_at < since:
                continue
            entry = ledger.get(agent, candidate.source_id)
            row = candidate.to_dict()
            row["agent_label"] = AGENT_LABELS[agent]
            row["state"] = _state(candidate, entry, store)
            row["session_id"] = entry.get("session_id") if row["state"] in ("imported", "updated") else None
            rows.append(row)
    rows.sort(key=lambda r: r["updated_at"], reverse=True)
    return rows


def _project_for(cwd: Optional[str]) -> Optional[str]:
    """The registered project whose folder is, or encloses, ``cwd``."""
    if not cwd:
        return None
    try:
        from openprogram.store.project.project_store import list_projects
        target = Path(cwd).expanduser().resolve()
        best, depth = None, -1
        for project in list_projects():
            if project.is_default or not project.path:
                continue
            root = Path(project.path).expanduser().resolve()
            if (target == root or root in target.parents) and len(root.parts) > depth:
                best, depth = project.id, len(root.parts)
        return best
    except Exception:  # noqa: BLE001 — placement falls back to the default project
        _log.warning("project lookup failed for %s", cwd, exc_info=True)
        return None


def _default_agent_id() -> str:
    try:
        from openprogram.agent.management import manager
        spec = manager.get_default()
        if spec is not None:
            return spec.id
    except Exception:  # noqa: BLE001
        pass
    return "main"


def _default_store():
    from openprogram.agent.session_db import default_db
    return default_db()


def _create(store, session: ExternalSession, agent_id: str) -> str:
    session_id = f"local_{uuid.uuid4()}"
    fields: dict[str, Any] = {
        "imported_from": {
            "agent": session.agent,
            "source_id": session.source_id,
            "path": str(session.path),
            "cwd": session.cwd,
            "imported_at": time.time(),
        },
    }
    project_id = _project_for(session.cwd)
    if project_id:
        fields["project_id"] = project_id
    store.create_session(
        session_id, agent_id,
        title=session.title or AGENT_LABELS[session.agent],
        source="import",
        created_at=session.started_at or time.time(),
        **fields,
    )
    return session_id


def _import_one(store, candidate: Candidate, home: Path, ledger, agent_id: str) -> dict[str, Any]:
    result: dict[str, Any] = {
        "agent": candidate.agent, "source_id": candidate.source_id,
        "path": str(candidate.path), "title": candidate.title,
        "session_id": None, "turns_added": 0,
    }
    entry = ledger.get(candidate.agent, candidate.source_id)
    state = _state(candidate, entry, store)
    if state == "imported":
        return {**result, "status": "unchanged", "session_id": entry["session_id"]}
    if state == "empty":
        return {**result, "status": "empty"}

    session = _parse(candidate, home)
    result["title"] = session.title or candidate.title
    if not any(t.blocks for t in session.turns):
        if not (entry and entry.get("session_id")):
            ledger.put(candidate.agent, candidate.source_id, {
                "empty": True, "path": str(candidate.path),
                "last_message_at": candidate.updated_at,
            })
        return {**result, "status": "empty"}

    start, predecessor, session_id, status = 0, "ROOT", None, "created"
    if entry and store.get_session(entry.get("session_id") or ""):
        done = int(entry.get("turns") or 0)
        same_prefix = (0 < done <= len(session.turns)
                       and session.turns[done - 1].fingerprint() == entry.get("last_fingerprint"))
        head = (store.get_session(entry["session_id"]) or {}).get("head_id")
        if same_prefix and head == entry.get("last_node_id"):
            session_id = entry["session_id"]
            if done == len(session.turns) and session.turns[-1].digest() == entry.get("last_digest"):
                status, start = "unchanged", done
            else:
                # Rewrite the last imported turn as well: it may still have
                # been running in the other agent when it was imported.
                status, start = "appended", done - 1
                prefix = node_prefix(session.agent, session.source_id)
                predecessor = reply_id(prefix, done - 2) if done >= 2 else "ROOT"

    if session_id is None:
        session_id = _create(store, session, agent_id)
    last = (entry or {}).get("last_node_id")
    if status != "unchanged":
        last = write_turns(store, session_id, session, start=start, predecessor=predecessor) or last
        if last:
            store.set_head(session_id, last)
        store.update_session(session_id, updated_at=session.updated_at or time.time())
        store.commit_turn(session_id, f"import from {AGENT_LABELS[session.agent]}")

    ledger.put(candidate.agent, candidate.source_id, {
        "session_id": session_id,
        "path": str(candidate.path),
        "turns": len(session.turns),
        "last_fingerprint": session.turns[-1].fingerprint(),
        "last_digest": session.turns[-1].digest(),
        "last_node_id": last,
        "last_message_at": candidate.updated_at,
        "imported_at": time.time(),
    })
    done_before = 0 if status == "created" else int(entry.get("turns") or 0)
    return {**result, "status": status, "session_id": session_id,
            "turns_added": len(session.turns) - done_before}


def import_transcripts(
    agents: Iterable[str] = AGENTS,
    *,
    paths: Optional[Iterable[str]] = None,
    since: Optional[float] = None,
    homes: Optional[dict[str, Path]] = None,
    store=None,
    ledger_root: Optional[Path] = None,
    agent_id: Optional[str] = None,
) -> list[dict[str, Any]]:
    """Import transcripts; one result row per source.

    ``paths`` limits the run to those transcript files; otherwise every
    transcript of ``agents`` (newer than ``since``) is imported. Each
    row's ``status`` is ``created``, ``appended``, ``unchanged``,
    ``empty`` (no reply to import) or ``failed`` (with ``error``).
    """
    store = store or _default_store()
    roots = _homes(homes)
    wanted = {str(Path(p).expanduser().resolve()) for p in paths} if paths else None
    agent_id = agent_id or _default_agent_id()
    results: list[dict[str, Any]] = []
    with locked(ledger_root) as ledger:
        for agent in agents:
            for candidate in _summaries(agent, roots[agent], ledger_root):
                if wanted is not None and str(candidate.path.resolve()) not in wanted:
                    continue
                if since is not None and candidate.updated_at < since:
                    continue
                try:
                    results.append(_import_one(store, candidate, roots[agent], ledger, agent_id))
                except Exception as exc:  # noqa: BLE001 — one bad transcript must not stop the rest
                    _log.warning("import of %s failed", candidate.path, exc_info=True)
                    results.append({
                        "agent": agent, "source_id": candidate.source_id,
                        "path": str(candidate.path), "title": candidate.title,
                        "session_id": None, "turns_added": 0,
                        "status": "failed", "error": str(exc),
                    })
    return results
