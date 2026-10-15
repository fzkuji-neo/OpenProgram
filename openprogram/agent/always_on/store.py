"""Runtime state and reports of always-on Agents.

Kept apart from ``agent.json`` so wakes never bump the configuration
revision or conflict with an open editor draft. Both files live in
``<agent dir>/always_on/`` and are written atomically under a per-Agent
lock.
"""
from __future__ import annotations

import json
import os
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Any

MAX_REPORTS = 200
TITLE_MAX = 200
BODY_MAX = 8000
LINKS_MAX = 10

_locks: dict[str, threading.RLock] = {}
_locks_master = threading.Lock()


def lock(agent_id: str) -> threading.RLock:
    with _locks_master:
        return _locks.setdefault(agent_id, threading.RLock())


def directory(agent_id: str) -> Path:
    from openprogram.agent.management.manager import agent_dir
    return agent_dir(agent_id) / "always_on"


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=path.name + ".", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def load_state(agent_id: str) -> dict[str, Any]:
    try:
        data = json.loads((directory(agent_id) / "state.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def update_state(agent_id: str, **changes: Any) -> dict[str, Any]:
    with lock(agent_id):
        state = load_state(agent_id)
        state.update(changes)
        _write_json(directory(agent_id) / "state.json", state)
        return state


def load_reports(agent_id: str, limit: int = MAX_REPORTS) -> list[dict[str, Any]]:
    """Newest first."""
    try:
        lines = (directory(agent_id) / "reports.jsonl").read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    rows = []
    for line in reversed(lines):
        try:
            row = json.loads(line)
        except ValueError:
            continue
        if isinstance(row, dict):
            rows.append(row)
        if len(rows) >= limit:
            break
    return rows


def _clean_links(links: Any) -> list[str]:
    if not isinstance(links, list):
        return []
    return [str(link).strip()[:2000] for link in links if str(link).strip()][:LINKS_MAX]


def add_report(agent_id: str, *, title: str, body: str, links: Any = None,
               session_id: str | None = None,
               deliveries: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    title = str(title or "").strip()
    if not title:
        raise ValueError("A report needs a title")
    report = {
        "id": uuid.uuid4().hex,
        "at": time.time(),
        "title": title[:TITLE_MAX],
        "body": str(body or "").strip()[:BODY_MAX],
        "links": _clean_links(links),
        "session_id": session_id,
    }
    if deliveries:
        report["deliveries"] = deliveries
    with lock(agent_id):
        _write_reports(agent_id, [*reversed(load_reports(agent_id, MAX_REPORTS - 1)), report])
    return report


def update_report(agent_id: str, report_id: str, **changes: Any) -> dict[str, Any] | None:
    """Merge ``changes`` into one stored report; None when it was trimmed away."""
    with lock(agent_id):
        rows = list(reversed(load_reports(agent_id, MAX_REPORTS)))
        for row in rows:
            if row.get("id") == report_id:
                row.update(changes)
                _write_reports(agent_id, rows)
                return row
    return None


def _write_reports(agent_id: str, rows: list[dict[str, Any]]) -> None:
    """Oldest first, one JSON object per line."""
    path = directory(agent_id) / "reports.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix="reports.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows))
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
