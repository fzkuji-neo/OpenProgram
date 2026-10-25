"""Wake an always-on Agent: start its standing Goal or a read-only check-in.

Design: docs/reference/design/runtime/always-on-agents.md
"""
from __future__ import annotations

import time
import uuid
from typing import Any

from . import store

# The home conversation's session source. Turns themselves are ordinary
# owner chat turns (source "web"), so Goal continuation, verification and
# approval cards treat them like any chat the owner started.
SOURCE = "always_on"
TURN_SOURCE = "web"

# Goals the runtime may replace. ``goal.chat.create`` refuses any other status.
GOAL_ENDED = {"achieved", "cancelled", "cleared", "impossible"}

CHECK_IN_TOOLS = (
    "read", "grep", "glob", "list", "web_search", "web_fetch",
    "read_conversation", "memory_search", "memory_get",
    "todo_list", "get_goal", "always_on_report",
)
ACT_TOOLS = ("create_goal", "todo_create", "todo_update")


class WakeRefused(ValueError):
    """The Agent cannot be woken (unknown, or always-on is off)."""


def _spec(agent_id: str):
    from openprogram.agent.management import manager
    spec = manager.get(agent_id)
    if spec is None:
        raise WakeRefused(f"Unknown Agent {agent_id!r}")
    return spec


def _db():
    from openprogram.agent.session_db import default_db
    return default_db()


def _broadcast(frame: dict[str, Any]) -> None:
    try:
        import json
        from openprogram.webui import server as _s
        _s._broadcast(json.dumps(frame, ensure_ascii=False, default=str))
    except Exception:
        pass


def home_session(agent_id: str, *, create: bool = True) -> str | None:
    """The Agent's one home conversation, recreated if it was deleted."""
    spec = _spec(agent_id)
    with store.lock(agent_id):
        sid = store.load_state(agent_id).get("home_session_id")
        if sid and _db().get_session(sid):
            return sid
        if not create:
            return None
        sid = uuid.uuid4().hex
        name = spec.name or spec.id
        _db().create_session(sid, spec.id, title=f"{name} · Always-on", source=SOURCE)
        store.update_state(agent_id, home_session_id=sid, applied_goal=None)
    try:
        from openprogram.webui.ws_actions.session import broadcast_sessions_list
        broadcast_sessions_list()
    except Exception:
        pass
    return sid


def agent_for_session(session_id: str) -> str | None:
    """The always-on Agent whose home conversation this is, if any."""
    try:
        session = _db().get_session(session_id) or {}
    except Exception:
        return None
    agent_id = session.get("agent_id")
    if not agent_id or session.get("source") != SOURCE:
        return None
    return agent_id if store.load_state(agent_id).get("home_session_id") == session_id else None


def _goal(session_id: str) -> dict | None:
    import openprogram.programs.workflow.goal as goals
    return goals.load_goal(session_id)


def _turn_running(session_id: str) -> bool:
    from openprogram.agent.run_control import is_turn_running
    return is_turn_running(session_id)


def _start_turn(session_id: str, agent_id: str, text: str, tools: list[str]) -> str:
    """One owner chat turn in the home conversation, under its own permissions."""
    from openprogram.agent.owner_turn import start_owner_turn
    return start_owner_turn(session_id, agent_id, text, tools=tools, name="always-on",
                            reason_code="always_on_activation_failed")


def check_in_prompt(config: dict, last_check_in: float | None, now: float) -> str:
    if last_check_in:
        minutes = max(1, int((now - last_check_in) // 60))
        since = f"Your previous check-in was {minutes} minutes ago."
    else:
        since = "This is your first check-in."
    goal = config.get("goal") or ""
    lines = [
        "Always-on check-in. " + since,
        f"Standing goal: {goal}" if goal else "You have no standing goal; watch for what matters to the user.",
        "Review your memory and this conversation for open threads, then look for anything new "
        "that matters, using only the read-only tools you have now.",
        "If you found something the user should see, call always_on_report once with a short "
        "title, the essentials and any links. If nothing is worth reporting, say so in one line "
        "and do not report.",
    ]
    if config.get("autonomy") == "act":
        lines.append(
            "If a finding needs real work, you may create a Goal for it with create_goal and plan it "
            "with the todo tools; it runs next under your normal permissions. Report what you started."
        )
    else:
        lines.append("Do not start work yourself; propose it in a report instead.")
    return "\n".join(lines)


def wake(agent_id: str, reason: str = "manual") -> dict[str, Any]:
    """Run one wake decision. Always records the outcome and the next wake."""
    spec = _spec(agent_id)
    config = dict(spec.always_on or {})
    now = time.time()
    if not config.get("enabled"):
        if reason == "manual":
            raise WakeRefused("Always-on is off for this Agent")
        return _record(agent_id, config, now, reason, "disabled")
    with store.lock(agent_id):
        state = store.load_state(agent_id)
        sid = state.get("home_session_id")
        if sid and not _db().get_session(sid):
            sid = None
        if sid and _turn_running(sid):
            return _record(agent_id, config, now, reason, "busy")
        goal = _goal(sid) if sid else None
        standing = (config.get("goal") or "").strip()
        applied = (state.get("applied_goal") or {}).get("text")
        unfinished = goal is not None and goal.get("status") not in GOAL_ENDED
        if standing and standing != applied and not unfinished:
            from openprogram.programs.workflow.goal import chat
            sid = sid or home_session(agent_id)
            created = chat.create(sid, standing)
            store.update_state(agent_id, applied_goal={"text": standing, "goal_id": created.get("goal_id")})
            chat.start_from_controls(sid, source=TURN_SOURCE)
            return _record(agent_id, config, now, reason, "goal_started", session_id=sid)
        if unfinished:
            status = str(goal.get("status") or "")
            outcome = "goal_paused" if status.startswith("paused") or goal.get("stop_requested") else "goal_in_progress"
            return _record(agent_id, config, now, reason, outcome, session_id=sid)
        if not config.get("research", True):
            return _record(agent_id, config, now, reason, "idle", session_id=sid)
        sid = sid or home_session(agent_id)
        tools = list(CHECK_IN_TOOLS) + (list(ACT_TOOLS) if config.get("autonomy") == "act" else [])
        last = state.get("last_check_in_at")
        _start_turn(sid, spec.id, check_in_prompt(config, last, now), tools)
        store.update_state(agent_id, last_check_in_at=now)
        return _record(agent_id, config, now, reason, "check_in", session_id=sid)


def _record(agent_id: str, config: dict, now: float, reason: str, outcome: str,
            session_id: str | None = None) -> dict[str, Any]:
    minutes = int(config.get("wake_minutes") or 60)
    wake_info = {"at": now, "reason": reason, "outcome": outcome}
    state = store.update_state(
        agent_id, last_wake=wake_info,
        next_wake_at=now + minutes * 60 if config.get("enabled") else None,
    )
    result = {"agent_id": agent_id, "outcome": outcome, "session_id": session_id or state.get("home_session_id"),
              "next_wake_at": state.get("next_wake_at")}
    _broadcast({"type": "always_on_update", "data": status(agent_id)})
    return result


def status(agent_id: str) -> dict[str, Any]:
    spec = _spec(agent_id)
    state = store.load_state(agent_id)
    sid = state.get("home_session_id")
    if sid and not _db().get_session(sid):
        sid = None
    goal = _goal(sid) if sid else None
    return {
        "agent_id": agent_id,
        "config": dict(spec.always_on or {}),
        "home_session_id": sid,
        "running": bool(sid and _turn_running(sid)),
        "goal": {"text": goal.get("text"), "status": goal.get("status")} if goal else None,
        "last_wake": state.get("last_wake"),
        "next_wake_at": state.get("next_wake_at"),
        "memory_mode": (spec.memory or {}).get("mode"),
    }


def reports(agent_id: str, limit: int = 20) -> list[dict[str, Any]]:
    _spec(agent_id)
    return store.load_reports(agent_id, limit)


def report(session_id: str, title: str, body: str, links: Any = None) -> dict[str, Any]:
    """Record a report from the home conversation, tell every client, and
    send it to the Agent's chosen channel conversations in the background."""
    from . import delivery

    agent_id = agent_for_session(session_id)
    if agent_id is None:
        raise ValueError("always_on_report works only in an always-on Agent's home conversation")
    spec = _spec(agent_id)
    name = spec.name or spec.id
    targets = list((spec.always_on or {}).get("channels") or [])
    row = store.add_report(agent_id, title=title, body=body, links=links, session_id=session_id,
                           deliveries=delivery.pending(targets))
    _broadcast({"type": "always_on_report", "data": {
        "agent_id": agent_id, "agent_name": name, "report": row,
    }})
    delivery.deliver(agent_id, name, row, on_done=lambda _row: _broadcast({
        "type": "always_on_update", "data": {"agent_id": agent_id},
    }))
    return row
