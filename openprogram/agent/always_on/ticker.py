"""Worker thread that wakes always-on Agents when their next wake is due."""
from __future__ import annotations

import threading
import time

TICK_SECONDS = 30.0


def due_agents(now: float) -> list[str]:
    """Enabled always-on Agents whose next wake has passed or was never set."""
    from openprogram.agent.management import manager
    from . import store
    due = []
    for spec in manager.list_all():
        if not (spec.always_on or {}).get("enabled"):
            continue
        next_wake = store.load_state(spec.id).get("next_wake_at")
        if not isinstance(next_wake, (int, float)) or next_wake <= now:
            due.append(spec.id)
    return due


def tick(now: float | None = None) -> list[dict]:
    from .runtime import wake
    results = []
    for agent_id in due_agents(time.time() if now is None else now):
        try:
            results.append(wake(agent_id, reason="schedule"))
        except Exception as exc:  # noqa: BLE001 - one Agent never stops the others
            print(f"[always-on] wake {agent_id} failed: {type(exc).__name__}: {exc}")
    return results


def start_in_worker(interval: float = TICK_SECONDS) -> tuple[threading.Event, threading.Thread]:
    stop = threading.Event()

    def run():
        while not stop.wait(interval):
            try:
                tick()
            except Exception as exc:  # noqa: BLE001
                print(f"[always-on] tick failed: {type(exc).__name__}: {exc}")

    thread = threading.Thread(target=run, name="always-on-ticker", daemon=True)
    thread.start()
    return stop, thread
