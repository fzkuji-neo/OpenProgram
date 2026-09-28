"""Small Activity rows for tool calls that have started but have not returned."""
from __future__ import annotations

from collections.abc import Mapping


def active_tool_calls(store, executions):
    from .effects import EffectStore, EffectStatus

    effects = EffectStore(store)
    rows = []
    for execution in executions:
        if execution.status.value not in {'running', 'pausing', 'cancelling', 'reconciliation_required'}:
            continue
        for effect in effects.list_unresolved(execution.execution_id):
            if effect.metadata.get('kind') != 'tool.before':
                continue
            payload = effect.metadata.get('payload')
            if not isinstance(payload, Mapping):
                continue
            arguments = payload.get('arguments')
            arguments = arguments if isinstance(arguments, Mapping) else {}
            running = (effect.status is EffectStatus.DISPATCHED
                       and execution.current_attempt_id == effect.attempt_id
                       and execution.status.value in {'running', 'pausing', 'cancelling'})
            rows.append({
                'id': effect.effect_id, 'execution_id': execution.execution_id,
                'session_id': execution.session_id,
                'tool_call_id': payload.get('tool_call_id'),
                'name': str(payload.get('tool_name') or 'function'),
                'description': str(arguments.get('description') or '')[:300],
                'command': str(arguments.get('command') or '')[:4000],
                'started_at': effect.dispatched_at or effect.created_at,
                'status': 'running' if running else 'unknown',
            })
    return sorted(rows, key=lambda row: row['started_at'])
