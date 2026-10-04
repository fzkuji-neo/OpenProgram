"""Specialists are persisted Agents, not catalog choices."""
from fastapi import FastAPI
from fastapi.testclient import TestClient

from openprogram import Agent, Runtime
from openprogram.agent.management import manager
from openprogram.webui.routes.catalog import agents


def test_builtin_agents_are_saved_independent_and_preserve_owner_edits(tmp_path, monkeypatch):
    monkeypatch.setattr(manager, "_state_root", lambda: tmp_path)
    manager.create("main", name="Existing", make_default=True)
    before = manager.get("main").to_dict()
    from openprogram.agent.management.builtin_agents import create_builtin_agents
    rows = create_builtin_agents(model_refs={"utility": manager.AgentModelRef("fixture", "small")})
    assert {row.id for row in rows} == {"image", "decision", "utility", "planner"}
    assert manager.get("main").to_dict() == before
    assert manager.get("utility").model.id == "small"
    assert all(row.memory["mode"] == "off" for row in rows)
    runtime = Runtime(call=lambda content, **kwargs: "extracted")
    try:
        assert Agent.from_spec(manager.get("utility"), runtime=runtime)("Extract one field") == "extracted"
    finally:
        runtime.close()
    manager.update("utility", {"name": "My helper", "system_prompt": "Owner instructions"})
    saved = manager.get("utility").to_dict()
    create_builtin_agents()
    assert manager.get("utility").to_dict() == saved
    app = FastAPI()
    agents.register(app)
    with TestClient(app) as client:
        assert len(client.get("/api/agents").json()["agents"]) == 5
        assert client.get("/api/agent-templates").status_code == 404
        manager.delete("decision")
        assert len(client.get("/api/agents").json()["agents"]) == 4
        assert manager.get("decision") is None
