"""Restrict new operations while previous external outcomes remain unknown."""
from __future__ import annotations

from contextlib import closing


def is_inspection_tool(tool) -> bool:
    """Recognize actual builtin implementations, not names or plugin flags.

    Permission wrappers pass the original resolved tool here. Copies retaining
    the builtin execute callable are fine; replacing that callable is not.
    Shell, MCP and custom tools are deliberately not classified as read-only.
    """
    from openprogram.programs.tools.files.read import read
    from openprogram.programs.tools.files.grep import grep
    from openprogram.programs.tools.files.glob import glob_tool
    from openprogram.programs.tools.files.list import list_dir

    return any(tool.name == builtin.name and getattr(tool, "execute", None) is builtin.execute
               for builtin in (read, grep, glob_tool, list_dir))


def uncertain_operations(request) -> list[dict[str, str]]:
    """Read canonical unresolved effects without resolving or replaying them.

    Only ownerless interrupted runs are recovery hazards. An active sibling's
    normal dispatched operation is not a failed restart. Include exact called
    Jobs/descendants, never unrelated work in their target session. Ancestor
    session hints only add restrictions; they cannot confer any permission.
    Exceptions deliberately propagate so callers can fail closed.
    """
    from openprogram.execution import default_store
    from openprogram.execution.conversation_scope import conversation_executions
    from openprogram.execution.effects import EffectStore

    store = default_store()
    effects = EffectStore(store)
    with closing(store._connect()) as connection:
        rows = connection.execute(
            "SELECT effects.* FROM effects JOIN executions USING (execution_id) "
            "WHERE effects.status IN ('dispatched', 'uncertain') "
            "AND executions.status IN ('reconciliation_required', 'interrupted') "
            "AND executions.current_attempt_id IS NULL ORDER BY effects.effect_id",
        ).fetchall()
    if not rows:
        return []
    candidates = [effects._record(row) for row in rows]
    candidates = [effect for effect in candidates if effect.metadata.get("kind") != "provider.before"]
    if not candidates:
        return []
    sessions = {getattr(request, key, None)
                for key in ("session_id", "spawned_from_session")}
    members = {execution.execution_id for sid in sessions if sid
               for execution in conversation_executions(store, sid)}
    result = []
    for effect in candidates:
        if effect.execution_id not in members:
            continue
        payload = effect.metadata.get("payload") or {}
        name = payload.get("tool_name") if isinstance(payload, dict) else None
        result.append({"effect_id": effect.effect_id, "execution_id": effect.execution_id,
                       "action_id": effect.action_id, "tool": name if isinstance(name, str) else "unknown"})
    return result


def approval_context(tool, request) -> list[dict[str, str]]:
    return [] if is_inspection_tool(tool) else uncertain_operations(request)
