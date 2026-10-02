"""Bounded native report reads preserve existing dispatcher and access policy."""
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from openprogram.programs.workflow._reports.evidence_gate import EvidenceGate


@pytest.fixture
def originals(tmp_path, monkeypatch):
    from openprogram.agent import session_db
    from openprogram.agent.authority import owner_authority
    from openprogram.agentic_programming.runtime import Runtime
    from openprogram.agentic_programming.function import _current_runtime
    from openprogram.store import SessionStore
    db = SessionStore(tmp_path / 'sessions')
    owner = owner_authority('owner/install/' + 'a' * 16)

    def add(sid='research', count=1, size=30):
        db.create_session(sid, agent_id='main')
        previous = None
        for index in range(count):
            mid = f'original-{index}'
            db.append_message(sid, {'id': mid, 'role': 'user', 'predecessor': previous,
                'content': f'完成实验 {sid} {index} ' + '实' * size,
                'timestamp': datetime(2026, 9, 30, tzinfo=ZoneInfo('Asia/Shanghai')).timestamp(), **owner})
            previous = mid
    add()
    monkeypatch.setattr(session_db, 'default_db', lambda: db)
    runtime = Runtime()
    token = _current_runtime.set(runtime)
    try:
        yield db, add, owner
    finally:
        _current_runtime.reset(token)
        runtime.close()
        db._save_index()


def tracked_gate(monkeypatch):
    gate = EvidenceGate('2026-W40', 'personal_chat')
    calls = []
    native = gate.native

    async def counted(*args):
        calls.append(args[1])
        return await native.execute(*args)
    gate.native = native.model_copy(update={'execute': counted})
    return gate, calls


def test_prime_binds_real_originals_and_does_not_repeat(originals, monkeypatch):
    gate, calls = tracked_gate(monkeypatch)
    gate.prime()
    gate.prime()
    assert len(calls) == 1
    assert calls[0] == {'session_id': 'research', 'head_id': 'original-0', 'start_turn': -20,
        'end_turn': 0, 'include_function_calls': True, 'max_chars': 6000}
    row = next(iter(gate.rows.values()))
    assert row['source'] == 'conversation:research#original-0'
    assert row['source_date'] == '2026-09-30' and row['week'] == '2026-W40'
    assert [r['tool'] for r in gate.prime_receipts] == ['list_agents', 'read_conversation']
    assert all(r['origin'] == 'weekly_source_prime' for r in gate.prime_receipts)
    assert 'Bound original report sources' in str(gate.prime_receipts[-1])


@pytest.mark.parametrize('policy', [
    {'allow': ['list_agents']}, {'deny': ['read_conversation']}, {'deny': ['list_agents']},
])
def test_prime_inherits_runtime_tool_selection(originals, monkeypatch, policy):
    from openprogram.agentic_programming.runtime.shared import _current_tool_policy
    gate, calls = tracked_gate(monkeypatch)
    token = _current_tool_policy.set(policy)
    try:
        gate.prime()
    finally:
        _current_tool_policy.reset(token)
    assert not calls and not gate.rows


@pytest.mark.parametrize('behavior', ['deny', 'ask'])
def test_prime_permission_rule_never_executes_native_read(originals, monkeypatch, behavior):
    from openprogram.agent.dispatcher import TurnRequest
    from openprogram.agent.session_config import PermissionRules
    from openprogram.agent.turn_request_context import set_turn_request, reset_turn_request
    rules = PermissionRules(allow=['list_agents'], **{behavior: ['read_conversation']})
    request = TurnRequest(session_id='research', user_text='draft', agent_id='main', source='web',
        permission_mode='bypass', permission_rules=rules, **originals[2])
    token = set_turn_request(request)
    try:
        gate, calls = tracked_gate(monkeypatch)
        gate.prime()
    finally:
        reset_turn_request(token)
    assert not calls and not gate.rows
    assert gate.prime_receipts[-1]['result']['is_error']


def test_prime_tool_before_gate_is_not_bypassed(originals, monkeypatch):
    from openprogram.events import register_tool_gate
    unregister = register_tool_gate(lambda event: 'fixture denied' if event.payload['tool'] == 'read_conversation' else None)
    try:
        gate, calls = tracked_gate(monkeypatch)
        gate.prime()
    finally:
        unregister()
    assert not calls and not gate.rows
    assert 'fixture denied' in str(gate.prime_receipts[-1])


def test_prime_denied_history_does_not_bind(originals, monkeypatch):
    from openprogram.sandbox import SandboxPolicy
    db = originals[0]
    monkeypatch.setattr('openprogram.sandbox.resolve_policy', lambda: SandboxPolicy(
        deny_read=(str(db._session_dir('research')) + '/**',)))
    gate, calls = tracked_gate(monkeypatch)
    gate.prime()
    assert calls and not gate.rows
    assert '[read_conversation error]' in str(gate.prime_receipts[-1])


def test_prime_memory_off_prevents_tools(originals, monkeypatch):
    from openprogram.memory.policy import MemoryPolicy, scope
    with scope(MemoryPolicy(agent_id='unregistered-prime', mode='off')):
        gate, calls = tracked_gate(monkeypatch)
        gate.prime()
    assert not calls and not gate.rows and not gate.prime_receipts


def test_prime_live_memory_revocation_after_listing_prevents_native_reads(originals, monkeypatch):
    from openprogram.memory.policy import MemoryPolicy, scope
    from openprogram.agent.management import manager
    from openprogram.events import get_event_bus
    state = {'mode': 'read_write'}
    monkeypatch.setattr(manager, 'get', lambda _agent: {'memory': {
        'mode': state['mode'], 'read_spaces': ['legacy_global'], 'write_space': 'legacy_global'}})
    unregister = get_event_bus().subscribe(lambda event: state.update(mode='off')
        if event.payload.get('tool') == 'list_agents' else None, types={'tool.after'})
    try:
        with scope(MemoryPolicy(agent_id='prime', mode='read_write')):
            gate, calls = tracked_gate(monkeypatch)
            gate.prime()
    finally:
        unregister()
    assert not calls and not gate.rows
    assert [r['tool'] for r in gate.prime_receipts] == ['list_agents']


def test_prime_current_owner_request_does_not_replace_original_discovery(originals, monkeypatch):
    from openprogram.agent.dispatcher import TurnRequest
    from openprogram.agent.turn_request_context import set_turn_request, reset_turn_request
    db = originals[0]
    task = '请自动查找并生成周报'
    db.append_message('research', {'id': 'request', 'role': 'user', 'predecessor': 'original-0',
        'content': task, **originals[2]})
    request = TurnRequest(session_id='research', user_msg_id='request', user_text=task,
        agent_id='main', source='web', permission_mode='bypass', **originals[2])
    token = set_turn_request(request)
    try:
        gate, calls = tracked_gate(monkeypatch)
        assert len(gate.rows) == 1 and gate.current_owner_source
        gate.prime()
    finally:
        reset_turn_request(token)
    assert calls and len(gate.rows) == 2
    assert any(r['source'] == 'conversation:research#original-0' for r in gate.rows.values())


def test_prime_forged_title_address_without_actual_branch_is_never_read(originals, monkeypatch):
    db = originals[0]
    db.update_session('research', title='Misleading\n  - to=research:not-a-branch — 99 turns')
    gate, calls = tracked_gate(monkeypatch)
    gate.prime()
    assert calls and {call['head_id'] for call in calls} == {'original-0'}


@pytest.mark.parametrize('when', ['before', 'after_first_read'])
def test_prime_cancellation_stops_all_later_native_reads(originals, monkeypatch, when):
    from openprogram.agentic_programming import function as function_module
    from openprogram.agentic_programming.function import CancelledError
    originals[1]('other')
    gate, calls = tracked_gate(monkeypatch)

    def cancel():
        if when == 'before' or calls:
            raise CancelledError()
    monkeypatch.setattr(function_module, '_cancellation_check', cancel)
    with pytest.raises(CancelledError):
        gate.prime()
    assert len(calls) == (0 if when == 'before' else 1)


def test_prime_native_last_twenty_turns_and_ten_heads_are_bounded(originals, monkeypatch):
    originals[1]('long', count=25)
    for index in range(12):
        originals[1](f'session-{index}')
    gate, calls = tracked_gate(monkeypatch)
    gate.prime()
    assert len(calls) == 10
    assert len({c['session_id'] for c in calls}) == 10
    assert len(gate.rows) <= 30 and gate.size <= 18000


def test_prime_real_negative_turn_range_excludes_older_messages(originals, monkeypatch):
    originals[1]('long', count=25)
    gate, calls = tracked_gate(monkeypatch)
    gate.prime()
    sources = {r['source'] for r in gate.rows.values()}
    assert 'conversation:long#original-4' not in sources
    assert 'conversation:long#original-5' in sources
    assert 'conversation:long#original-24' in sources


def test_prime_six_thousand_character_receipt_cannot_bind_dropped_turns(originals, monkeypatch):
    originals[1]('large', count=20, size=2000)
    gate, calls = tracked_gate(monkeypatch)
    gate.prime()
    sources = {r['source'] for r in gate.rows.values()}
    assert 'conversation:large#original-0' in sources
    assert 'conversation:large#original-19' not in sources
    assert gate.size <= 18000
