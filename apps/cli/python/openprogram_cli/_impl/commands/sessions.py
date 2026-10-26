"""``openprogram sessions`` handlers (list / resume / export / archive)."""
from __future__ import annotations

import json
import sys
from pathlib import Path


def _cmd_session_archive(session_id: str, archived: bool) -> None:
    """Set or clear a chat session's archive flag.

    Archiving hides the session from the default list without deleting
    anything — ``unarchive`` puts it straight back, and the session's
    last-activity time is untouched either way. A running worker does the
    write, so its live session list and every open window update too;
    without one the flag is set in the store.
    """
    from openprogram.agent.session_db import default_db
    from openprogram.backend_endpoint import OwnerAuthError, resolve_backend_endpoint
    verb = "Archived" if archived else "Unarchived"
    try:
        resolve_backend_endpoint()
    except OwnerAuthError:
        found = default_db().set_archived(session_id, archived)
    else:
        from .execution import _worker_request
        status, payload = _worker_request(
            "POST", "/api/sessions/archive" if archived else "/api/sessions/unarchive",
            {"session_id": session_id},
        )
        if status not in (200, 404):
            print(f"[error] worker refused: {payload}")
            sys.exit(1)
        found = status == 200
    if not found:
        print(f"[error] no session {session_id!r} found.")
        sys.exit(1)
    print(f"{verb} session {session_id}")


def _cmd_chat_sessions(scope: str = "active") -> None:
    """List chat sessions. ``scope`` is active | archived | all."""
    from openprogram.agent.session_db import default_db
    kwargs: dict = {"limit": 10_000}
    if scope == "archived":
        kwargs["archived"] = True
    elif scope == "all":
        kwargs["include_archived"] = True
    rows = default_db().list_sessions(**kwargs)
    if not rows:
        print(f"No {scope} chat sessions.")
        return
    print(f"Chat sessions ({scope}, {len(rows)}):\n")
    for r in rows:
        sid = r.get("id", "?")
        title = (r.get("title") or r.get("preview") or "").strip()
        flag = " [archived]" if r.get("archived") else ""
        print(f"  {sid}{flag}  {title[:70]}")


def _cmd_resume(session_id, answer):
    """Resume a waiting follow-up session."""
    from openprogram.agentic_programming.session import Session
    session = Session(session_id)
    if not session.exists():
        print(json.dumps({"type": "error", "message": f"Session not found: {session_id}"}))
        sys.exit(1)
    meta = session.read_meta()
    if not meta:
        print(json.dumps({"type": "error", "message": f"Session metadata unreadable: {session_id}"}))
        sys.exit(1)
    session.send_answer(answer)
    print(json.dumps({"type": "ok", "message": f"Answer sent to session {session_id}"}))


def _cmd_sessions():
    """List active follow-up sessions."""
    from openprogram.agentic_programming.session import list_sessions
    sessions = list_sessions()
    if not sessions:
        print("No active sessions.")
        return
    print(f"Active sessions ({len(sessions)}):\n")
    for s in sessions:
        sid = s.get("session_id", "?")
        q = s.get("question", "?")
        status = s.get("status", "?")
        print(f"  {sid}  [{status}]  {q[:80]}")
    print(f"\nResume with: agentic resume <session_id> \"your answer\"")


def _cmd_sessions_export(session_id, export_format="md", output=None):
    """Write a session out as a shareable Markdown or HTML file."""
    from openprogram.agent.session_db import default_db
    from openprogram.store.session.export import export_session

    store = default_db()
    if store.get_session(session_id) is None:
        print(f"[error] no session {session_id!r} found.", file=sys.stderr)
        sys.exit(1)

    document = export_session(session_id, export_format, store=store)
    target = Path(output) if output else Path(f"{session_id}.{export_format}")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(document, encoding="utf-8")
    print(f"Exported session {session_id} → {target}")
