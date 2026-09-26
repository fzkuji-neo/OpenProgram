"""Failed browser/tool results must remain failed in the persisted call."""
import asyncio

import pytest

from openprogram.agentic_programming import agentic_function
from openprogram.agent.types import AgentToolResult
from openprogram.programs._runtime import ToolReturn
from openprogram.providers.types import TextContent
from openprogram.store import SessionNodeWriter, SessionStore, _store


@pytest.mark.parametrize('async_body', [False, True])
@pytest.mark.parametrize('result_type', ['return', 'result'])
def test_failed_function_result_persists_error(tmp_path, monkeypatch, async_body, result_type):
    db = SessionStore(tmp_path / 'sessions')
    db.create_session('s', 'main')
    monkeypatch.setattr('openprogram.agent.session_db.default_db', lambda: db)
    outcome = (ToolReturn(text='browser unavailable', is_error=True) if result_type == 'return'
               else AgentToolResult(content=[TextContent(text='browser unavailable')], is_error=True))

    def sync_probe():
        return outcome

    async def async_probe():
        return outcome

    probe = agentic_function(register_globally=False)(async_probe if async_body else sync_probe)
    token = _store.set(SessionNodeWriter(db, 's'))
    try:
        returned = asyncio.run(probe()) if async_body else probe()
        assert returned is outcome
        nodes = [n for n in db.get_nodes('s') if n.is_code()]
        assert len(nodes) == 1
        assert nodes[0].metadata['status'] == 'error'
    finally:
        _store.reset(token)
        db.close()
