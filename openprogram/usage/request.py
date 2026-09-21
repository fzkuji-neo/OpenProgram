"""Durable Goal request identity and replayable terminal usage receipts.

This is metering, not an execution journal: an unknown request is never replayed.
Only provider usage receipts are retried, with the same immutable event identity.
"""
from __future__ import annotations

import json
import math
import time
import uuid
from dataclasses import asdict

from .context import UsageContext, request_context
from .event import UsageEvent
from .recorder import build_message_event, run_usage_hooks


class RequestReceipt:
    def __init__(self, ledger, request_id: str, metadata: dict):
        self.ledger = ledger
        self.request_id = request_id
        self.metadata = metadata

    @classmethod
    def begin(cls, model, options):
        from . import ledger
        from openprogram.programs.workflow.goal import chat
        import openprogram.programs.workflow.goal as goals

        context = request_context(getattr(options, "session_id", None))
        if not context.goal_id:
            return None
        sid = context.goal_session_id
        if not sid:
            raise goals.GoalStateUnavailable("Goal request has no owning session")
        with chat.locked(sid):
            goal = goals.load_goal(sid)
            if (not goal or goal.get("goal_id") != context.goal_id
                    or goal.get("revision") != context.goal_revision or goal.get("run_id") != context.goal_run_id):
                raise goals.GoalConflictError("Goal changed before provider request")
            if goal.get("status") != "active" or goal.get("stop_requested"):
                raise goals.GoalConflictError("Goal no longer permits provider requests")
            if goal.get("usage_mode") != "requests":
                # Retain historical totals without assigning old receipts to a revision.
                goals.accumulate_goal_usage(sid, goal)
                if goal.get("usage_pending_until") is not None:
                    raise goals.GoalStateUnavailable("Legacy Goal usage is unavailable")
                goal["legacy_usage"] = dict(goal.get("usage") or {})
                goal["usage_mode"] = "requests"
                chat.publish(sid, goal)
            now = time.time()
            metadata = {"context": asdict(context), "created_at": now,
                        "provider": model.provider, "api": model.api, "model_id": model.id,
                        "price": model.cost.model_dump(exclude_unset=True), "service_tier": getattr(options, "service_tier", None)}
            request_id = uuid.uuid4().hex
            with ledger.default_ledger.immediate() as conn:
                conn.execute("""INSERT INTO usage_requests
                    (request_id, goal_session_id, goal_id, goal_revision, state, metadata_json, created_at)
                    VALUES (?, ?, ?, ?, 'prepared', ?, ?)""",
                    (request_id, sid, context.goal_id, context.goal_revision, json.dumps(metadata), now))
        return cls(ledger.default_ledger, request_id, metadata)

    @classmethod
    def load(cls, ledger, request_id: str):
        with ledger.read() as conn:
            row = conn.execute("SELECT metadata_json FROM usage_requests WHERE request_id = ?", (request_id,)).fetchone()
        if row is None:
            raise KeyError(request_id)
        return cls(ledger, request_id, json.loads(row[0]))

    def start(self):
        from openprogram.programs.workflow.goal import chat
        import openprogram.programs.workflow.goal as goals
        context = self.metadata["context"]
        with chat.locked(context["goal_session_id"]):
            goal = goals.load_goal(context["goal_session_id"])
            if (not goal or goal.get("status") != "active" or goal.get("stop_requested")
                    or goal.get("goal_id") != context["goal_id"] or goal.get("revision") != context["goal_revision"]
                    or goal.get("run_id") != context["goal_run_id"]):
                raise goals.GoalConflictError("Goal changed before provider dispatch")
            with self.ledger.immediate() as conn:
                if conn.execute("UPDATE usage_requests SET state = 'started' WHERE request_id = ? AND state = 'prepared'",
                                (self.request_id,)).rowcount != 1:
                    raise RuntimeError("A provider request may only start once")
        self.refresh()

    def refresh(self):
        from openprogram.programs.workflow.goal.chat import refresh_usage
        try:
            refresh_usage(self.metadata["context"]["goal_session_id"])
        except Exception:
            # Durable state remains authoritative if the optional projection fails.
            pass

    def release(self):
        with self.ledger.immediate() as conn:
            conn.execute("UPDATE usage_requests SET state = 'released' WHERE request_id = ? AND state = 'prepared'",
                         (self.request_id,))

    def event(self, message):
        from openprogram.providers.types import Model, ModelCost
        data = self.metadata
        model = Model(id=data["model_id"], name=data["model_id"], api=data["api"], provider=data["provider"],
                      base_url="", cost=ModelCost(**data["price"]))
        # Pricing uses the request's tier, even if a provider omitted it in usage.
        message = message.model_copy(deep=True)
        if message.usage.requested_service_tier is None:
            message.usage.requested_service_tier = data["service_tier"]
        event = build_message_event(model, message, context=UsageContext(**data["context"]),
                                    request_id=self.request_id, timestamp=data["created_at"])
        if event is None or (not event.tokens_known and event.cost_source == "unknown"):
            return None
        if any(not math.isfinite(value) or value < 0 for value in (
                event.cost_total, event.cost_input, event.cost_output, event.cost_cache_read, event.cost_cache_write)):
            raise ValueError("Provider reported invalid cost")
        return event

    def settle(self, message):
        event = self.event(message)
        if event is None:
            self.refresh()
            return None
        # Store the receipt before projecting aggregates. A later process can
        # replay this outbox even if the event append fails or the Goal ended.
        with self.ledger.immediate() as conn:
            row = conn.execute("SELECT state, receipt_json FROM usage_requests WHERE request_id = ?",
                               (self.request_id,)).fetchone()
            if row is None or row["state"] not in {"started", "settled"}:
                raise RuntimeError("Cannot settle a provider request that never started")
            if row["receipt_json"]:
                previous = UsageEvent.model_validate_json(row["receipt_json"])
                # The delivery process is not part of the provider's receipt.
                if previous.model_dump(exclude={"origin_pid"}) != event.model_dump(exclude={"origin_pid"}):
                    raise ValueError("Conflicting terminal usage receipt")
            else:
                conn.execute("UPDATE usage_requests SET receipt_json = ? WHERE request_id = ?",
                             (event.model_dump_json(), self.request_id))
        return self.flush()

    def flush(self):
        with self.ledger.immediate() as conn:
            row = conn.execute("SELECT receipt_json FROM usage_requests WHERE request_id = ? AND state IN ('started','settled')",
                               (self.request_id,)).fetchone()
            if row is None or not row[0]:
                return None
            event = UsageEvent.model_validate_json(row[0])
            self.ledger.append_in_transaction(conn, event)
            conn.execute("UPDATE usage_requests SET state = 'settled' WHERE request_id = ?", (self.request_id,))
        run_usage_hooks(event)
        return event


def project(session_id: str, goal: dict) -> None:
    """Rebuild a Goal subtotal; status/revision changes do not discard receipts."""
    from .ledger import default_ledger
    current = default_ledger.goal_usage(session_id, goal["goal_id"])
    legacy = goal.get("legacy_usage") or {}
    usage = dict(goal.get("usage") or {})
    usage.update(current)
    for key in ("total_tokens", "cost_usd"):
        usage[key] += legacy.get(key) or 0
    for key in ("tokens_known", "cost_known"):
        usage[key] = current[key] and legacy.get(key, True)
    usage.pop("accounting_pending", None)
    goal.update(usage=usage, usage_accounted_at=time.time())
    goal.pop("usage_pending_until", None)
