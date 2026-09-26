"""Invocation-local failure allowance shared by semantic and transport recovery.

One logical model invocation owns one ``RecoveryState``. Runtime structured
repair, provider transport retries, and agent_loop validation repairs all
``reserve()`` against that same object. Successful tool rounds do not call
``reserve`` and therefore do not consume the allowance.

Compatibility:
- ``max_validation_retries`` / Runtime ``max_retries`` map to ``limit`` as
  "extra failure recoveries after the initial attempt". Explicit ``0`` means
  no automatic recovery. Default is ``2``.
- ``requests`` counts provider dispatches that called ``started()`` (best-effort
  diagnostics). It is NOT a guaranteed HTTP request counter — some adapters
  record before the socket write.
"""
from __future__ import annotations

from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any


@dataclass
class RecoveryState:
    """Shared failure-recovery budget for one logical invocation."""

    limit: int = 2
    used: int = 0
    requests: int = 0
    parent_id: str | None = None
    invocation_id: str | None = None
    phase: str = "active"  # active | retrying | paused | cancelled
    attempts: list[dict[str, Any]] = field(default_factory=list)

    def reserve(self, reason: str) -> bool:
        if self.phase == "cancelled":
            return False
        if self.used >= self.limit:
            self.phase = "paused"
            return False
        self.used += 1
        self.phase = "retrying"
        self.attempts.append({"kind": "reserve", "reason": reason, "used": self.used})
        del self.attempts[:-32]
        return True

    def started(self, **metadata: Any) -> dict[str, Any]:
        self.requests += 1
        attempt = {"kind": "dispatch", "attempt": self.requests, **metadata}
        self.attempts.append(attempt)
        del self.attempts[:-32]
        return attempt

    def mark_cancelled(self) -> None:
        self.phase = "cancelled"

    def mark_paused(self) -> None:
        self.phase = "paused"

    def snapshot(self) -> dict[str, Any]:
        return {
            "used": self.used,
            "limit": self.limit,
            "requests": self.requests,
            "phase": self.phase,
            "parent_id": self.parent_id,
            "invocation_id": self.invocation_id,
            "attempts": list(self.attempts),
        }


current_recovery: ContextVar[RecoveryState | None] = ContextVar(
    "provider_recovery", default=None
)


def reserve_recovery(reason: str) -> bool:
    """Consume one failure recovery when a shared state is installed.

    When no state is installed (legacy callers), return True so existing
    provider-local retry loops keep their own caps.
    """
    state = current_recovery.get()
    if state is None:
        return True
    return state.reserve(reason)


def recovery_limit_from_max_retries(max_retries: int | None) -> int:
    """Map Runtime ``max_retries`` (total attempts) to failure-recovery limit.

    ``max_retries`` counts the initial attempt plus recoveries. Explicit 0 or
    1 -> zero recoveries. None -> default 2 recoveries.
    """
    if max_retries is None:
        return 2
    return max(0, int(max_retries) - 1)
