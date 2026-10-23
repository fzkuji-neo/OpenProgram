"""Start an owner chat turn in a conversation without a client sending it.

Always-on check-ins and reminders that wake the agent both need a turn the
owner sees in the conversation, under that conversation's own permission
settings, as if the owner had typed ``text``. The turn runs on a daemon
thread; ``on_done`` receives its result (``None`` when it never ran).
"""
from __future__ import annotations

import uuid
from typing import Any, Callable


def start_owner_turn(
    session_id: str, agent_id: str, text: str, *,
    tools: list[str] | None = None,
    name: str = "owner-turn",
    reason_code: str = "owner_turn_activation_failed",
    on_done: Callable[[Any], None] | None = None,
) -> str:
    """Admit the turn now and run it in the background; return its execution id."""
    import asyncio
    import threading
    from openprogram.agent.authority import local_owner_authority
    from openprogram.agent.dispatcher.types import TurnRequest
    from openprogram.agent.production_driver import CanonicalAgentAdapter
    from openprogram.agent.session_config import load_session_run_config, permission_from_config
    from openprogram.events import emit_ws_frame
    from openprogram.programs.permission_rule import load_merged_rules
    config = load_session_run_config(session_id)
    authority = local_owner_authority()
    msg_id = uuid.uuid4().hex
    request = TurnRequest(
        session_id=session_id, user_text=text, agent_id=agent_id, source="web",
        user_msg_id=msg_id, permission_mode=permission_from_config(config),
        tools_override=tools, thinking_effort=config.thinking_effort,
        permission_rules=load_merged_rules(session_id),
        additional_working_dirs=config.additional_working_dirs,
        **authority,
    )
    adapter = CanonicalAgentAdapter(event_sink=emit_ws_frame)
    admission = adapter.admit(request, trusted_actor=authority, user_message_id=msg_id,
                              assistant_message_id=f"{msg_id}_reply",
                              config_snapshot_ref=f"session:{session_id}")

    def activate():
        result = None
        try:
            _active, result = asyncio.run(adapter.activate(admission))
        except Exception:
            adapter.fail_admission(admission, reason_code=reason_code)
        if on_done is not None:
            on_done(result)
    try:
        threading.Thread(target=activate, name=name, daemon=True).start()
    except Exception:
        adapter.fail_admission(admission, reason_code=reason_code)
        raise
    return admission.execution_id


__all__ = ["start_owner_turn"]
