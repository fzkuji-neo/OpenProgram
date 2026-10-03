"""The TurnRequest in force for the current execution context.

An ``@agentic_function`` body running ``runtime.exec()`` builds its own
inner ``AgentSession``. That session's tools used to be handed to the
agent loop raw — no approval wrapper, no authority, no hard constraints —
so an agent spawned from inside a program was effectively unsupervised
while the identical tool on the outer loop was gated.

The outer request is what carries the non-downgradable part of the
execution context (source, permission mode, authority tier, principal),
so the dispatcher binds it here and the runtime reads it back to derive
an inner request via ``runtime_authority``. Nothing bound (a library-only
``Runtime()`` with no dispatcher above it) means no inner gating, which
is the same position as before for that path.
"""
from __future__ import annotations

import contextvars
from dataclasses import dataclass
from typing import Any, Optional

current_turn_request: contextvars.ContextVar[Optional[Any]] = (
    contextvars.ContextVar("openprogram_current_turn_request", default=None)
)


@dataclass(frozen=True)
class OriginalOwnerInput:
    """Source data from an admitted human turn, never execution authority."""

    session_id: str
    user_msg_id: str
    user_text: str
    principal_id: str
    session_dir: str
    execution_id: str
    execution_store: str
    speaker_kind: str
    speaker_id: str
    speaker_display: str
    authority_tier: str
    interaction: str


_original_owner_input: contextvars.ContextVar[Optional[OriginalOwnerInput]] = (
    contextvars.ContextVar("openprogram_original_owner_input", default=None)
)


def set_original_owner_input(value: Optional[OriginalOwnerInput]):
    return _original_owner_input.set(value)


def reset_original_owner_input(token) -> None:
    _original_owner_input.reset(token)


def _valid_original_input(value: OriginalOwnerInput, request: Any) -> bool:
    from openprogram.agent.authority import normalize_authority
    from openprogram.agent.run_control import get_current_execution_id
    from openprogram.agent.session_db import default_db
    from openprogram.execution import default_store

    authority = normalize_authority(request)
    source_authority = normalize_authority(value)
    if (not isinstance(value, OriginalOwnerInput)
            or source_authority.get("speaker_kind") != "owner"
            or source_authority.get("authority_tier") != "owner"
            or authority.get("authority_tier") != "owner"
            or (authority.get("speaker_kind"), authority.get("interaction"))
                not in {("owner", "interactive"), ("runtime", "non-interactive")}
            or value.session_id != getattr(request, "session_id", None)
            or value.principal_id != getattr(request, "principal_id", None)
            or value.execution_id != get_current_execution_id()):
        return False
    try:
        db, store = default_db(), default_store()
        if (str(db._session_dir(value.session_id).resolve()) != value.session_dir
                or str(store.path.resolve()) != value.execution_store):
            return False
        admitted = store.get_execution_input(value.execution_id)
        payload = store.get_agent_turn_input(value.execution_id)
    except Exception:
        # Missing durable input cannot become original evidence.
        return False
    actor = normalize_authority(admitted.trusted_actor) if admitted else {}
    return bool(admitted and payload and payload.get("kind") == "chat"
                and admitted.session_id == value.session_id
                and admitted.user_message_id == value.user_msg_id
                and actor == source_authority
                and payload.get("request", {}).get("user_text") == value.user_text)


def original_owner_request() -> Optional[Any]:
    """Resolve only the current admitted input; leave runtime authority intact."""
    from openprogram.agent.authority import normalize_authority

    request = get_turn_request()
    authority = normalize_authority(request)
    if authority.get("speaker_kind") == "owner" and authority.get("authority_tier") == "owner":
        return request
    value = _original_owner_input.get()
    return value if value is not None and _valid_original_input(value, request) else None


def capture_original_owner_input(request: Any) -> Optional[OriginalOwnerInput]:
    """Freeze trusted parent context before dispatching to another process."""
    from openprogram.agent.authority import normalize_authority
    from openprogram.agent.run_control import get_current_execution_id
    from openprogram.agent.session_db import default_db
    from openprogram.execution import default_store
    from openprogram.programs.workflow._reports.sources import original_owner
    from openprogram.store.session.transcript import MAX_TEXT_CHARS

    authority = normalize_authority(request)
    if authority.get("speaker_kind") != "owner" or authority.get("authority_tier") != "owner":
        value = _original_owner_input.get()
        return value if value is not None and _valid_original_input(value, request) else None
    sid, mid = getattr(request, "session_id", ""), getattr(request, "user_msg_id", "")
    eid = get_current_execution_id()
    if not sid or not mid or not eid:
        return None
    db, store = default_db(), default_store()
    node = next((m for m in db.get_messages(sid) if m.get("id") == mid), None)
    if (not node or not original_owner(node)
            or not isinstance(node.get("content"), str)
            or len(node["content"]) > MAX_TEXT_CHARS
            or node.get("content") != getattr(request, "user_text", None)
            or node.get("principal_id") != authority["principal_id"]):
        return None
    value = OriginalOwnerInput(session_id=sid, user_msg_id=mid, user_text=node["content"],
        session_dir=str(db._session_dir(sid).resolve()), execution_id=eid,
        execution_store=str(store.path.resolve()), **authority)
    return value if _valid_original_input(value, request) else None


def set_turn_request(req: Any):
    return current_turn_request.set(req)


def get_turn_request() -> Optional[Any]:
    return current_turn_request.get(None)


def reset_turn_request(token) -> None:
    try:
        current_turn_request.reset(token)
    except ValueError:
        pass


def inner_turn_request(source: str) -> Optional[Any]:
    """Derive the request an inner AgentSession's tools are gated by.

    Inherits the outer request's authority through ``runtime_authority``
    (which pins ``interaction="non-interactive"`` and the runtime speaker),
    and keeps source/permission_mode/permission_rules so neither the hard
    constraints nor a deny rule can be dropped by descending a level.
    """
    outer = get_turn_request()
    if outer is None:
        return None
    from openprogram.agent.authority import runtime_authority
    from openprogram.agent.dispatcher import TurnRequest

    authority = runtime_authority(outer, source)
    if not authority:
        return None
    return TurnRequest(
        session_id=getattr(outer, "session_id", "") or "",
        user_text="",
        agent_id=getattr(outer, "agent_id", "main") or "main",
        # A nested program cannot widen the outer source. agent_spawn and
        # cron stay themselves so their hard-constraint sets keep applying.
        source=getattr(outer, "source", "web") or "web",
        permission_mode=getattr(outer, "permission_mode", None),
        permission_rules=getattr(outer, "permission_rules", None),
        surface_context=getattr(outer, "surface_context", None),
        additional_working_dirs=list(
            getattr(outer, "additional_working_dirs", None) or ()
        ),
        **authority,
    )


__all__ = [
    "current_turn_request", "set_turn_request", "get_turn_request",
    "reset_turn_request", "inner_turn_request",
]
