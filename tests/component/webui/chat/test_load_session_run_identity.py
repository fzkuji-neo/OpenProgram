"""A load that reports a running turn names it, and closes it if it ends mid-load."""
import asyncio
import json

from openprogram.store import SessionStore
from openprogram.webui.ws_actions import session as ws_session
from openprogram.webui.session_history import close_snapshots


def test_turn_ending_during_load_is_cleared_by_name(tmp_path, monkeypatch):
    from openprogram.webui import server
    sid = 'run-identity-chat'
    store = SessionStore(tmp_path / 'sessions')
    store.create_session(sid, 'main')
    store.append_message(sid, {'id': 'm1', 'role': 'user', 'content': 'hi', 'predecessor': None})
    store.update_session(sid, head_id='m1')
    monkeypatch.setattr('openprogram.agent.session_db.default_db', lambda: store)
    monkeypatch.setattr(server, '_get_provider_info', lambda _sid=None: {})
    monkeypatch.setattr(server, '_is_run_active', lambda _sid: True)
    monkeypatch.setattr(server, '_canonical_foreground_task', lambda _sid: None)

    def turn_ends(_sid):
        # The turn finishes while the load is still in flight.
        with server._running_tasks_lock:
            server._running_tasks.pop(sid, None)
    monkeypatch.setattr(server, 'refresh_context_stats', turn_ends)

    class WS:
        _bounded_history = True
        _history_protocol = 1

        def __init__(self):
            self.frames = []

        async def send_text(self, text):
            self.frames.append(json.loads(text))

    ws = WS()
    with server._sessions_lock:
        server._sessions[sid] = {'id': sid}
    with server._running_tasks_lock:
        server._running_tasks[sid] = {'msg_id': 'm1', 'execution_id': 'exec-1',
                                      'func_name': '_chat', 'started_at': 0}
    try:
        asyncio.run(ws_session.handle_load_session(ws, {'session_id': sid}))
        loaded = next(f['data'] for f in ws.frames if f['type'] == 'session_loaded')
        assert loaded['run_active'] is True
        assert loaded['run_task'] == {'msg_id': 'm1', 'execution_id': 'exec-1'}
        clears = [f['data'] for f in ws.frames if f['type'] == 'running_task_clear']
        assert clears == [{'session_id': sid, 'msg_id': 'm1', 'execution_id': 'exec-1'}]
        assert not any(f['type'] == 'running_task' for f in ws.frames)
    finally:
        close_snapshots(ws)
        with server._sessions_lock:
            server._sessions.pop(sid, None)
        with server._running_tasks_lock:
            server._running_tasks.pop(sid, None)
