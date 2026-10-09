"""Shared recovery allowance semantics."""
from __future__ import annotations

import asyncio

import pytest

from openprogram.providers.utils.errors import ExecInterrupt
from openprogram.providers.utils.recovery import (
    RecoveryState,
    current_recovery,
    recovery_limit_from_max_retries,
    reserve_recovery,
)
from openprogram.providers.utils.stream_retry import (
    ProviderStreamError,
    _sleep_unless_aborted,
    retry_stream,
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


def test_a_request_that_recovers_refunds_its_transport_retries():
    """One state spans a whole Agent loop; blips that retries rode over
    must not leave later requests in the loop without recovery."""
    state = RecoveryState(limit=2)
    token = current_recovery.set(state)

    def flaky(failures):
        calls = []

        async def attempt():
            calls.append(1)
            if len(calls) <= failures:
                raise ProviderStreamError("ConnectError: ", retryable=True)

        return attempt

    async def no_sleep(*_args, **_kwargs):
        return None

    async def run():
        import openprogram.providers.utils.stream_retry as module
        original = module._sleep_unless_aborted
        module._sleep_unless_aborted = no_sleep
        try:
            for _ in range(3):  # three requests, each recovering from two blips
                await retry_stream(flaky(2), is_committed_fn=lambda: False,
                                   max_attempts=5, label="test")
            assert state.used == 0 and state.phase == "active"
            # A request that never recovers still exhausts the allowance.
            with pytest.raises(ProviderStreamError):
                await retry_stream(flaky(9), is_committed_fn=lambda: False,
                                   max_attempts=5, label="test")
            assert state.used == 2 and state.phase == "paused"
        finally:
            module._sleep_unless_aborted = original

    try:
        asyncio.run(run())
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


def test_retry_aborts_before_second_attempt_when_cancelled():
    attempts = []

    async def attempt():
        attempts.append(1)
        raise ProviderStreamError("boom", retryable=True)

    async def run():
        with pytest.raises(ExecInterrupt):
            await retry_stream(
                attempt,
                is_committed_fn=lambda: False,
                max_attempts=5,
                label="test",
                # Cancel as soon as the first failure is observed — before
                # backoff sleep or a second network attempt.
                abort_check=lambda: len(attempts) >= 1,
            )

    asyncio.run(run())
    assert attempts == [1]


def test_sleep_unless_aborted_raises_before_waiting():
    async def run():
        with pytest.raises(ExecInterrupt):
            await _sleep_unless_aborted(10.0, lambda: True)

    asyncio.run(run())


def test_sleep_unless_aborted_respects_recovery_cancel():
    state = RecoveryState(limit=2)
    token = current_recovery.set(state)

    async def run():
        state.mark_cancelled()
        with pytest.raises(ExecInterrupt):
            await _sleep_unless_aborted(10.0, None)

    try:
        asyncio.run(run())
    finally:
        current_recovery.reset(token)
