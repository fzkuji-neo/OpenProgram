"""HTTP surface of always-on Agents."""
from fastapi import FastAPI
from fastapi.testclient import TestClient

from openprogram.agent.always_on import runtime
from openprogram.agent.management import manager
from openprogram.webui.routes.catalog import agents


def _client(tmp_path, monkeypatch) -> TestClient:
    monkeypatch.setattr(manager, "_state_root", lambda: tmp_path)
    manager.create("main", name="Default Agent", make_default=True)
    app = FastAPI()
    agents.register(app)
    return TestClient(app)


def test_always_on_section_saves_and_status_reads(tmp_path, monkeypatch) -> None:
    client = _client(tmp_path, monkeypatch)
    agent = client.get("/api/agents/main").json()["agent"]
    assert agent["always_on"]["enabled"] is False
    saved = client.patch("/api/agents/main", json={
        "expected_revision": agent["revision"],
        "always_on": {"enabled": True, "goal": "Watch CI", "wake_minutes": 15, "channels": [
            {"channel": "telegram", "account_id": "default", "peer_id": "42", "label": "Bob"},
        ]},
    })
    assert saved.status_code == 200
    assert saved.json()["agent"]["always_on"] == {
        "enabled": True, "goal": "Watch CI", "wake_minutes": 15,
        "research": True, "autonomy": "report",
        "channels": [{"channel": "telegram", "account_id": "default", "peer_id": "42", "label": "Bob"}],
    }
    bad = client.patch("/api/agents/main", json={
        "expected_revision": saved.json()["agent"]["revision"],
        "always_on": {"wake_minutes": 2},
    })
    assert bad.status_code == 400
    bad_channel = client.patch("/api/agents/main", json={
        "expected_revision": saved.json()["agent"]["revision"],
        "always_on": {"channels": [{"channel": "email", "account_id": "a", "peer_id": "b"}]},
    })
    assert bad_channel.status_code == 400
    monkeypatch.setattr(runtime, "_db", lambda: type("Db", (), {"get_session": lambda self, sid: None})())
    status = client.get("/api/agents/main/always-on").json()
    assert status["config"]["goal"] == "Watch CI"
    assert status["home_session_id"] is None and status["reports"] == []
    assert isinstance(status["channel_targets"], list)
    assert client.get("/api/agents/missing/always-on").status_code == 404


def test_wake_now_is_refused_while_off(tmp_path, monkeypatch) -> None:
    client = _client(tmp_path, monkeypatch)
    response = client.post("/api/agents/main/always-on/wake")
    assert response.status_code == 409
    assert "off" in response.json()["error"]
    assert client.post("/api/agents/missing/always-on/wake").status_code == 404
