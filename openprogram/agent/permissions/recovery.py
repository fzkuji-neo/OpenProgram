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


def _admitted_owner_runtime(request, store, execution_id: str) -> bool:
    """Prove the current activation's origin without granting owner authority."""
    from openprogram.agent.authority import normalize_authority

    if request.speaker_kind != "runtime" or request.interaction != "non-interactive":
        return False
    admitted = store.get_execution_input(execution_id)
    payload = store.get_agent_turn_input(execution_id)
    actor = normalize_authority(admitted.trusted_actor) if admitted else {}
    return bool(
        admitted and payload and payload.get("kind") == "chat"
        and admitted.session_id == request.session_id
        and actor.get("speaker_kind") == "owner"
        and actor.get("authority_tier") == "owner"
        and actor.get("interaction") == "interactive"
        and actor.get("principal_id") == request.principal_id
        and payload["request"].get("source") == request.source
    )


def approval_context(tool, request) -> list[dict[str, str]]:
    if is_inspection_tool(tool):
        return []
    operations = uncertain_operations(request)
    # An abandoned turn is not an approval policy for every future turn.
    # Keep its uncertain receipts intact; same-execution replay is still
    # fenced by the effect store. Only a real owner activation can use this
    # distinction, never a caller-supplied execution id.
    if (operations and request.permission_mode in {"auto", "bypass"}
            and request.authority_tier == "owner"
            and request.source in {"web", "tui", "acp"}):
        from openprogram.agent.run_control import get_current_execution_id
        from openprogram.execution import default_store
        from openprogram.execution.conversation_scope import conversation_execution_scope
        current_id = get_current_execution_id()
        store = default_store()
        current = store.get_execution(current_id) if current_id else None
        if (current is not None and current.session_id == request.session_id
                and (request.interaction == "interactive"
                     or _admitted_owner_runtime(request, store, current_id))):
            _, parents = conversation_execution_scope(store, request.session_id)
            def belongs_to_current(execution_id):
                seen = set()
                while execution_id and execution_id not in seen:
                    if execution_id == current_id:
                        return True
                    seen.add(execution_id)
                    execution_id = parents.get(execution_id)
                return False
            operations = [item for item in operations if belongs_to_current(item["execution_id"])]
    return operations
