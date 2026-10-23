"""Transcript notices — system rows (``local_command`` envelope) for
goal events."""
from __future__ import annotations

import json
import logging
from typing import Callable, Optional

_log = logging.getLogger(__name__)


def _emit_goal_notice(session_id: str, content: str,
                      on_event: Optional[Callable] = None) -> None:
    """One system row in the transcript (``local_command`` envelope,
    webui broadcast; best-effort — absent server is a no-op). Callers
    inside a turn pass ``on_event`` so the row reaches that turn's own
    event stream as well as the broadcast."""
    payload = {
        "type": "local_command",
        "session_id": session_id,
        "content": content,
    }
    if on_event is not None:
        try:
            on_event({"type": "chat_response", "data": dict(payload)})
        except Exception:
            _log.debug("goal notice emit failed", exc_info=True)
    try:
        from openprogram.webui import server as _s
        _s._broadcast(json.dumps(
            {"type": "chat_response", "data": payload}, default=str))
    except Exception:
        pass


# Terminal statuses, and how each reads in the transcript.
_TERMINAL_LABELS = {
    "achieved": "已达成",
    "blocked": "已阻塞",
    "stalled": "已因无进展暂停",
    "budget_exhausted": "已达资源上限",
    "failed": "执行失败",
}

