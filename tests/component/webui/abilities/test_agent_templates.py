"""Templates use the public Agent registry and execution contract."""
from fastapi import FastAPI
from fastapi.testclient import TestClient

from openprogram import Agent, Runtime
from openprogram.agent.management import manager
from openprogram.webui.routes.catalog import agents


def test_templates_create_independent_runnable_profiles(tmp_path, monkeypatch):
    monkeypatch.setattr(manager, "_state_root", lambda: tmp_path)
    manager.create("main", name="Existing", make_default=True)
    app = FastAPI()
    agents.register(app)
    with TestClient(app) as client:
        before = manager.get("main").to_dict()
        response = client.get("/api/agent-templates")
        assert response.status_code == 200
        templates = response.json()["templates"]
        assert {row["id"] for row in templates} == {"image", "decision", "utility", "planner"}
        assert len(manager.list_all()) == 1
        for template in templates:
            response = client.post("/api/agents", json={
                "name": template["name"], "template_id": template["id"],
                "model": {"provider": "fixture", "id": "chosen"},
                "thinking_effort": "",
            })
            assert response.status_code == 201, response.text
            saved = manager.get(response.json()["agent"]["id"])
            assert saved.system_prompt == template["configuration"]["system_prompt"]
            assert saved.tools == template["configuration"]["tools"]
            assert saved.model.provider == "fixture" and saved.model.id == "chosen"
            assert saved.thinking_effort == ""
            assert saved.memory["mode"] == "off"
            if template["id"] == "utility":
                calls = []
                runtime = Runtime(call=lambda content, **kwargs: calls.append(content) or "extracted")
                try:
                    assert Agent.from_spec(saved, runtime=runtime)("Extract one field") == "extracted"
                    assert len(calls) == 1
                finally:
                    runtime.close()
                manager.update(saved.id, {"system_prompt": "Owner edit"})
        assert manager.get("main").to_dict() == before
        assert client.get("/api/agent-templates").json()["templates"] == templates
        count = len(manager.list_all())
        for bad in ({"template_id": "missing"}, {"template_id": []}, {"model": "bad"}):
            response = client.post("/api/agents", json={"name": "Invalid", **bad})
            assert response.status_code == 400
        assert len(manager.list_all()) == count
