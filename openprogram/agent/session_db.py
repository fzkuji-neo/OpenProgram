"""session_db — git-backed SessionStore facade.

``SessionDB`` is now an alias for :class:`SessionStore` (see
``openprogram.store.session.session_store``). The old SQLite-backed
``DagSessionDB`` is retired; all session memory lives in
``~/.openprogram/sessions/<session_id>/`` git repos (or, for a
project-bound session, inside the project's ``.openprogram/sessions/``).

The public method surface used by ``dispatcher``, channels, and the
WebUI is preserved by ``SessionStore`` — same 22 methods, same
semantics. See ``docs/design/memory/git-as-entity-memory.md``.
"""
from __future__ import annotations

from openprogram.store import SessionStore, default_store


SessionDB = SessionStore


def default_db() -> SessionStore:
    """Use the active Context store, or the process-wide conversation store."""
    from openprogram.context.model import Context
    context = Context.current()
    if context is not None and context.store is not None:
        return context.store.store
    return default_store()


__all__ = ["SessionDB", "default_db"]
