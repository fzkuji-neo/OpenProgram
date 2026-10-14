"""Always-on Agents: configuration, wake decisions, reports and the ticker."""
from __future__ import annotations

import uuid

import pytest

from openprogram.agent.always_on import runtime, store, ticker
from openprogram.agent.management import manager


class FakeDb:
    def __init__(self):
        self.sessions: dict[str, dict] = {}

    def get_session(self, sid):
        return self.sessions.get(sid)

    def create_session(self, sid, agent_id, *, title="", source=None, **_):
        self.sessions[sid] = {"id": sid, "agent_id": agent_id, "title": title, "source": source}


@pytest.fixture
def agent():
    agent_id = "dot" + uuid.uuid4().hex[:8]
    manager.create(agent_id, name="Scout")
    yield agent_id
    manager.delete(agent_id)


@pytest.fixture
def world(monkeypatch):
    db = FakeDb()
    calls = {"turns": [], "goals": [], "started": [], "frames": []}
    goals: dict[str, dict] = {}
    running: set[str] = set()
    monkeypatch.setattr(runtime, "_db", lambda: db)
    monkeypatch.setattr(runtime, "_goal", lambda sid: goals.get(sid))
    monkeypatch.setattr(runtime, "_turn_running", lambda sid: sid in running)
    monkeypatch.setattr(runtime, "_broadcast", lambda frame: calls["frames"].append(frame))

    def start_turn(sid, agent_id, text, tools):
        calls["turns"].append({"sid": sid, "agent_id": agent_id, "text": text, "tools": tools})
        return "exec"
    monkeypatch.setattr(runtime, "_start_turn", start_turn)

    from openprogram.programs.workflow.goal import chat

    def create(sid, objective, *args, **kwargs):
        goals[sid] = {"text": objective, "status": "active", "goal_id": "g" + str(len(calls["goals"]))}
        calls["goals"].append((sid, objective))
        return goals[sid]
    monkeypatch.setattr(chat, "create", create)
    monkeypatch.setattr(chat, "start_from_controls", lambda sid, source="web": calls["started"].append((sid, source)))
    return {"db": db, "goals": goals, "running": running, "calls": calls}


def enable(agent_id, **config):
    return manager.update(agent_id, {"always_on": {"enabled": True, **config}})


def test_configuration_defaults_validation_and_duplicate(agent):
    spec = manager.get(agent)
    assert spec.always_on == {"enabled": False, "goal": "", "wake_minutes": 60,
                              "research": True, "autonomy": "report"}
    assert manager.validate_always_on({"goal": "  watch CI  "}, partial=True) == {"goal": "watch CI"}
    for bad in ({"wake_minutes": 1}, {"wake_minutes": True}, {"autonomy": "always"},
                {"enabled": "yes"}, {"goal": "x" * 4001}, {"unknown": 1}):
        with pytest.raises(ValueError):
            manager.validate_always_on(bad, partial=True)
    enable(agent, goal="Watch CI", wake_minutes=30)
    saved = manager.get(agent).always_on
    assert saved["enabled"] and saved["goal"] == "Watch CI" and saved["wake_minutes"] == 30
    assert saved["research"] is True
    copy = manager.duplicate(agent, name="Scout copy")
    try:
        assert copy.always_on["enabled"] is False
        assert copy.always_on["goal"] == "Watch CI"
    finally:
        manager.delete(copy.id)
    legacy = manager.AgentSpec.from_dict({"id": "legacy"})
    assert legacy.always_on["enabled"] is False


def test_wake_refuses_when_off_and_records_scheduled_skips(agent, world):
    with pytest.raises(runtime.WakeRefused):
        runtime.wake(agent, reason="manual")
    result = runtime.wake(agent, reason="schedule")
    assert result["outcome"] == "disabled"
    assert store.load_state(agent)["next_wake_at"] is None
    assert not world["calls"]["turns"]


def test_standing_goal_starts_once_then_belongs_to_the_goal_runtime(agent, world):
    enable(agent, goal="Keep the docs links green")
    first = runtime.wake(agent, reason="schedule")
    assert first["outcome"] == "goal_started"
    sid = first["session_id"]
    assert world["db"].sessions[sid]["source"] == "always_on"
    assert world["db"].sessions[sid]["title"] == "Scout · Always-on"
    assert world["calls"]["goals"] == [(sid, "Keep the docs links green")]
    assert world["calls"]["started"] == [(sid, "web")]
    assert runtime.wake(agent)["outcome"] == "goal_in_progress"
    world["goals"][sid]["status"] = "paused"
    assert runtime.wake(agent)["outcome"] == "goal_paused"
    # An achieved goal is not restarted; the Agent checks in instead.
    world["goals"][sid]["status"] = "achieved"
    assert runtime.wake(agent)["outcome"] == "check_in"
    assert len(world["calls"]["goals"]) == 1
    # A new standing goal replaces an ended one.
    enable(agent, goal="Triage new issues")
    assert runtime.wake(agent)["outcome"] == "goal_started"
    assert world["calls"]["goals"][-1] == (sid, "Triage new issues")


def test_changed_goal_waits_for_the_unfinished_one(agent, world):
    enable(agent, goal="First")
    sid = runtime.wake(agent)["session_id"]
    enable(agent, goal="Second")
    assert runtime.wake(agent)["outcome"] == "goal_in_progress"
    world["goals"][sid]["status"] = "cleared"
    assert runtime.wake(agent)["outcome"] == "goal_started"
    assert world["calls"]["goals"][-1] == (sid, "Second")


def test_busy_idle_and_check_in_tools(agent, world):
    enable(agent, research=False)
    assert runtime.wake(agent)["outcome"] == "idle"
    assert not world["calls"]["turns"]
    enable(agent, research=True)
    first = runtime.wake(agent)
    assert first["outcome"] == "check_in"
    turn = world["calls"]["turns"][-1]
    assert "always_on_report" in turn["tools"] and "bash" not in turn["tools"]
    assert "create_goal" not in turn["tools"]
    assert "This is your first check-in." in turn["text"]
    assert "Do not start work yourself" in turn["text"]
    world["running"].add(first["session_id"])
    assert runtime.wake(agent)["outcome"] == "busy"
    world["running"].clear()
    enable(agent, autonomy="act")
    runtime.wake(agent)
    turn = world["calls"]["turns"][-1]
    assert "create_goal" in turn["tools"] and "todo_create" in turn["tools"]
    assert "previous check-in was" in turn["text"]
    assert len({t["sid"] for t in world["calls"]["turns"]}) == 1


def test_deleted_home_conversation_is_recreated(agent, world):
    enable(agent)
    sid = runtime.wake(agent)["session_id"]
    del world["db"].sessions[sid]
    assert runtime.status(agent)["home_session_id"] is None
    again = runtime.wake(agent)["session_id"]
    assert again and again != sid


def test_reports_only_from_the_home_conversation(agent, world):
    enable(agent)
    sid = runtime.wake(agent)["session_id"]
    world["db"].create_session("other", agent, source="web")
    with pytest.raises(ValueError):
        runtime.report("other", "Hi", "body")
    row = runtime.report(sid, "  Found a broken link ", "docs/x.md", ["https://example.com", ""])
    assert row["title"] == "Found a broken link" and row["links"] == ["https://example.com"]
    frame = world["calls"]["frames"][-1]
    assert frame["type"] == "always_on_report"
    assert frame["data"]["agent_name"] == "Scout"
    assert runtime.reports(agent)[0]["id"] == row["id"]
    assert runtime.agent_for_session(sid) == agent
    assert runtime.agent_for_session("other") is None


def test_reports_are_trimmed_newest_first(agent, monkeypatch):
    monkeypatch.setattr(store, "MAX_REPORTS", 3)
    for index in range(5):
        store.add_report(agent, title=f"r{index}", body="")
    assert [row["title"] for row in store.load_reports(agent)] == ["r4", "r3", "r2"]


def test_ticker_wakes_only_due_enabled_agents(agent, world):
    assert agent not in ticker.due_agents(0)
    enable(agent, research=False)
    assert agent in ticker.due_agents(0)
    results = ticker.tick()
    assert any(row["agent_id"] == agent for row in results)
    next_wake = store.load_state(agent)["next_wake_at"]
    assert agent not in ticker.due_agents(next_wake - 1)
    assert agent in ticker.due_agents(next_wake)


@pytest.mark.parametrize("home", [True, False])
def test_report_tool_is_offered_only_in_the_home_conversation(monkeypatch, home):
    from openprogram.agent import dispatcher
    from openprogram.agent.dispatcher import loop_runner
    from openprogram.agent.dispatcher.types import TurnRequest
    from openprogram.agent.types import AgentTool
    from openprogram.providers.types import Model

    model = Model(id="fake", name="fake", api="openai-completions", provider="openai",
                  base_url="https://example.invalid/v1")
    tools = [AgentTool(name=name, label=name, description=name,
                       parameters={"type": "object"}, execute=lambda *args: None)
             for name in ("read", "always_on_report")]
    monkeypatch.setattr(dispatcher, "_load_agent_profile", lambda *a: {})
    monkeypatch.setattr(dispatcher, "_resolve_model", lambda *a: model)
    monkeypatch.setattr(loop_runner, "_resolve_tools", lambda *a, **k: list(tools))
    monkeypatch.setattr(loop_runner, "_wrap_with_approval", lambda tool, *a: tool)
    monkeypatch.setattr("openprogram.context.components.build_system_prompt", lambda *a, **k: "system")
    monkeypatch.setattr("openprogram.programs.workflow.goal.chat.instructions", lambda *a: "")
    monkeypatch.setattr("openprogram.agent.always_on.agent_for_session",
                        lambda sid: "scout" if home else None)
    request = TurnRequest("home", "check in", "scout", "web")
    request._execution_revision_id = "test-revision"
    names = {tool["name"] for tool in loop_runner.resolve_agent_runtime(request)[-1]["tools"]}
    assert ("always_on_report" in names) is home
    assert "read" in names


def test_report_tool_is_registered_outside_the_default_set():
    import openprogram.programs.tools  # noqa: F401
    from openprogram.programs import DEFAULT_TOOLS, agent_tools
    assert "always_on_report" not in DEFAULT_TOOLS
    assert [tool.name for tool in agent_tools(names=["always_on_report"])] == ["always_on_report"]
