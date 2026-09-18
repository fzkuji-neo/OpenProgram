"""Shared recovery allowance semantics."""
from openprogram.providers.utils.recovery import (
    RecoveryState,
    current_recovery,
    recovery_limit_from_max_retries,
    reserve_recovery,
)


def test_default_two_recoveries_and_pause():
    assert recovery_limit_from_max_retries(None) == 2
    assert recovery_limit_from_max_retries(0) == 0
    assert recovery_limit_from_max_retries(1) == 0
    assert recovery_limit_from_max_retries(3) == 2
    state = RecoveryState(limit=2)
    token = current_recovery.set(state)
    try:
        assert reserve_recovery("length")
        assert reserve_recovery("invalid_json")
        assert not reserve_recovery("transport")
        assert state.phase == "paused"
        assert state.used == 2
    finally:
        current_recovery.reset(token)


def test_cancel_blocks_further_reserves():
    state = RecoveryState(limit=2)
    token = current_recovery.set(state)
    try:
        state.mark_cancelled()
        assert not reserve_recovery("transport")
        assert state.used == 0
    finally:
        current_recovery.reset(token)


def test_legacy_without_state_allows_provider_local_retry():
    assert current_recovery.get() is None
    assert reserve_recovery("transport") is True
