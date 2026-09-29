"""Saved effort changes affect the next runtime without mutating an active one."""

from types import SimpleNamespace

from openprogram.agent.management import manager, runtime_registry


def test_agent_runtime_cache_tracks_effort_and_inheritance(monkeypatch):
    built = []

    def build(provider, model_id):
        runtime = SimpleNamespace(thinking_level="medium")
        built.append(runtime)
        return runtime

    monkeypatch.setattr(runtime_registry, "_cache", {})
    monkeypatch.setattr(runtime_registry, "_build_runtime", build)
    agent = manager.AgentSpec(id="example", thinking_effort="high")
    high = runtime_registry.get_runtime_for(agent)
    assert high.thinking_level == "high"
    assert runtime_registry.get_runtime_for(agent) is high
    agent.thinking_effort = "low"
    low = runtime_registry.get_runtime_for(agent)
    assert low.thinking_level == "low"
    assert low is not high
    assert high.thinking_level == "high"
    agent.thinking_effort = ""
    inherited = runtime_registry.get_runtime_for(agent)
    assert inherited.thinking_level == "medium"
    assert inherited is not low
    assert len(built) == 3
