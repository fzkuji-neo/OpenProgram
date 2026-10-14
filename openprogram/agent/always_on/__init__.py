"""Always-on Agents: a saved Agent that wakes on a schedule.

An always-on Agent keeps a standing goal, works on it as an ordinary chat
Goal in one home conversation, does read-only check-ins while it has no
unfinished Goal, and reports findings with ``always_on_report``.

Design: docs/reference/design/runtime/always-on-agents.md
"""
from .runtime import (
    WakeRefused,
    agent_for_session,
    home_session,
    report,
    reports,
    status,
    wake,
)

__all__ = [
    "WakeRefused", "agent_for_session", "home_session", "report",
    "reports", "status", "wake",
]
