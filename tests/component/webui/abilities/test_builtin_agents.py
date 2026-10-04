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
    assert {row.id for row in rows} == {"decision", "utility", "planner"}
    assert manager.get("main").to_dict() == before
    assert manager.get("image") is None
    assert manager.get("decision").name == "Decision"
    assert manager.get("utility").model.id == "small"
    assert all(row.memory["mode"] == "off" for row in rows)
    assert all(row.system_prompt == "" for row in rows)
    from openprogram.agentic_programming.runtime.shared import _current_instructions
    seen_instructions = []
    def call(content, **kwargs):
        seen_instructions.append(_current_instructions.get())
        return '{"call":"B"}' if any("Pick." in block.get("text", "") for block in content) else "extracted"
    runtime = Runtime(call=call)
    token = _current_instructions.set("Instructions supplied by the caller")
    try:
        instance = Agent.from_spec(manager.get("utility"), runtime=runtime)
        assert instance.instructions is None
        assert instance("Extract one field") == "extracted"
        picker = Agent.from_spec(manager.get("decision"), runtime=runtime)
        assert picker.choose("Pick.", {"A": "First", "B": "Second"}) == "B"
        assert seen_instructions == ["Instructions supplied by the caller"] * 2
    finally:
        _current_instructions.reset(token)
        runtime.close()
    manager.update("utility", {"name": "My helper", "system_prompt": "Owner instructions"})
    saved = manager.get("utility").to_dict()
    create_builtin_agents()
    assert manager.get("utility").to_dict() == saved
    app = FastAPI()
    agents.register(app)
    with TestClient(app) as client:
        assert len(client.get("/api/agents").json()["agents"]) == 4
        assert client.get("/api/agent-templates").status_code == 404
        manager.delete("decision")
        assert len(client.get("/api/agents").json()["agents"]) == 3
        assert manager.get("decision") is None
