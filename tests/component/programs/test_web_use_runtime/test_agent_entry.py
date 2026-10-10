"""web use agent entry tests."""

from __future__ import annotations
import sys
from types import ModuleType

from ._support import (
    SimpleNamespace,
    asyncio,
    pytest,
)
from tests.support.on_runtime import run_on


def _desktop_access(monkeypatch):
    from openprogram import system_access

    monkeypatch.setattr(
        system_access,
        "report",
        lambda: {
            "platform": "Darwin",
            "capabilities": [
                {"id": name, "status": "granted"}
                for name in ("screen_recording", "accessibility")
            ],
        },
    )


def _capabilities(monkeypatch, *, selected="browser_use", actions=1, effect=None):
    """Controlled capability dependency; real public orchestration remains active."""
    plans, calls, records = [], [], []

    def plan(**kwargs):
        plans.append(kwargs)
        if len(kwargs["history"]) < actions:
            return {"call": selected, "args": {"task": kwargs["task"]}}
        return {
            "call": "terminal",
            "args": {"status": "succeeded", "reason": "Verified"},
        }

    def call(name, args, **kwargs):
        calls.append((name, args, kwargs))
        if effect is not None:
            return effect(name, args, **kwargs)
        return {
            "status": "succeeded",
            "success": True,
            "completion_verified": True,
            "summary": "inspected",
        }

    def terminal(decision, history):
        assert history and history[-1]["type"] == "capability_call"
        assert history[-1]["output"]["completion_verified"] is True
        return {"accepted": True, **decision["args"]}

    package, tasks, result = (
        ModuleType(name)
        for name in (
            "gui_harness",
            "gui_harness.tasks",
            "gui_harness.tasks.result",
        )
    )
    package.__path__ = tasks.__path__ = []
    tasks.capability_loop = SimpleNamespace(
        CAPABILITIES=("browser_use", "computer_use", "vm_use"),
        capability_status=lambda **kwargs: {
            name: {"available": name == selected}
            for name in ("browser_use", "computer_use", "vm_use")
        },
        plan_next_capability=plan,
        call_capability=call,
        validate_terminal_decision=terminal,
    )
    result.conclusion = lambda **kwargs: {"summary": "inspected"}
    result.save_workflow_record = lambda value, app_name: records.append(
        (value, app_name)
    )
    for module in (package, tasks, result):
        monkeypatch.setitem(sys.modules, module.__name__, module)
    _desktop_access(monkeypatch)
    return SimpleNamespace(plans=plans, calls=calls, records=records)


def test_registered_gui_agent_can_select_computer_use_backend(monkeypatch):
    from openprogram.programs import _runtime
    from openprogram.programs.gui_harness_bridge import (
        install_gui_harness_web_use,
    )

    calls = []

    def original(**kwargs):
        calls.append(("original", kwargs))
        return {"status": "succeeded", "mode": "unified"}

    wrapped = install_gui_harness_web_use(original)
    tool = _runtime.get("gui_agent")
    assert tool is not None

    result = run_on(SimpleNamespace(), wrapped,
        task="click Save",
        backend="chrome_devtools_mcp",
    )
    assert result["status"] == "infeasible"
    assert result["success"] is False
    assert result["reason_code"] == "guarded_dispatch_unsupported"
    assert calls == []


def test_programs_cli_resolves_registered_gui_agent(monkeypatch, capsys):
    from openprogram.programs._runtime import _registry
    from openprogram.cli.commands.programs import _cmd_run
    from openprogram.programs import gui_harness_bridge
    from openprogram.programs.gui_harness_bridge import (
        install_gui_harness_web_use,
    )

    monkeypatch.setitem(_registry, "gui_agent", _registry.get("gui_agent"))
    monkeypatch.setattr(
        gui_harness_bridge,
        "gui_agent",
        getattr(gui_harness_bridge, "gui_agent", None),
        raising=False,
    )

    capabilities = _capabilities(monkeypatch)

    def legacy(**_kwargs):
        raise AssertionError("task-only CLI must use the capability loop")

    wrapped = install_gui_harness_web_use(legacy)

    _cmd_run("gui_agent", ["task=inspect"])

    assert gui_harness_bridge.gui_agent is wrapped
    assert "'status': 'succeeded'" in capsys.readouterr().out
    assert [call[0] for call in capabilities.calls] == ["browser_use"]


def test_registered_gui_agent_browser_surface_uses_standard_entry(monkeypatch):
    from openprogram.programs import gui_browser_agent
    from openprogram.programs.gui_harness_bridge import (
        DEFAULT_MAX_STEPS,
        install_gui_harness_web_use,
    )

    calls = []

    def standard_entry(**kwargs):
        from openprogram.agentic_programming.call_state import _current_runtime
        calls.append({**kwargs, "runtime": _current_runtime.get(None)})
        return {
            "status": "succeeded",
            "reason_code": "verified_browser_assertion",
            "summary": "done",
        }

    monkeypatch.setattr(gui_browser_agent, "run_browser_gui_agent", standard_entry)

    def original(**kwargs):
        raise AssertionError("browser must not use the legacy planner")

    runtime = object()
    wrapped = install_gui_harness_web_use(original)
    result = run_on(runtime, wrapped, task="inspect the page", surface="browser")
    assert result["success"] is True
    assert calls == [
        {
            "task": "inspect the page",
            "max_steps": DEFAULT_MAX_STEPS,
            "max_seconds": None,
            "runtime": runtime,
            "allow_general": False,
            "backend": "",
        }
    ]


def test_gui_agent_app_name_does_not_select_browser_surface(monkeypatch):
    from openprogram.programs.workflow import browser as browser_module
    from openprogram.programs.gui_harness_bridge import (
        install_gui_harness_web_use,
    )

    capabilities = _capabilities(monkeypatch, selected="computer_use")

    def original(**kwargs):
        raise AssertionError("task-only app_name must use the capability loop")

    monkeypatch.setattr(
        browser_module,
        "_run_browser_task_commands",
        lambda **_kwargs: (_ for _ in ()).throw(
            AssertionError("app_name must not select the browser route")
        ),
    )

    wrapped = install_gui_harness_web_use(original)
    result = run_on(object(), wrapped, task="inspect", app_name="browser")

    assert result["success"] is True
    assert [call[0] for call in capabilities.calls] == ["computer_use"]
    assert capabilities.calls[0][2]["app_name"] == "browser"
    assert all(plan["preferred_capability"] == "" for plan in capabilities.plans)


def test_gui_agent_wrapper_resolves_step_budget(monkeypatch):
    from openprogram.programs.gui_harness_bridge import (
        DEFAULT_MAX_STEPS,
        install_gui_harness_web_use,
    )

    seen = []
    _desktop_access(monkeypatch)

    def original(**kwargs):
        seen.append(kwargs)
        return {"ok": True}

    wrapped = install_gui_harness_web_use(original)
    wrapped(task="t", surface="desktop")
    assert seen[-1]["max_steps"] == DEFAULT_MAX_STEPS
    wrapped(task="t", max_steps=0, surface="desktop")
    assert seen[-1]["max_steps"] == 0
    wrapped(task="t", max_steps=-3, surface="desktop")
    assert seen[-1]["max_steps"] == 0
    wrapped(task="t", max_steps=20, surface="desktop")
    assert seen[-1]["max_steps"] == 20


def test_gui_agent_wrapper_forces_success_false_when_infeasible_declared(monkeypatch):
    from openprogram.programs.gui_harness_bridge import (
        install_gui_harness_web_use,
    )

    def original(**kwargs):
        return {
            "status": "succeeded",
            "infeasible_declared": True,
            "success": True,
            "summary": "Human must log in and retry.",
        }

    _desktop_access(monkeypatch)
    wrapped = install_gui_harness_web_use(original)
    result = wrapped(task="t", surface="desktop")
    assert result["success"] is False
    assert result["status"] == "infeasible"
    assert result["infeasible_declared"] is True
    assert result["handoff_instruction"] == "Human must log in and retry."
    assert result["summary"] == "Human must log in and retry."


def test_gui_agent_wrapper_calls_raw_harness_function_once(monkeypatch):
    from openprogram.programs.gui_harness_bridge import (
        install_gui_harness_web_use,
    )

    calls = []

    def raw_harness(**kwargs):
        calls.append(kwargs)
        return {"success": True, "summary": "done"}

    def decorated_harness(**_kwargs):
        raise AssertionError("bridge called the decorated harness wrapper")

    decorated_harness.__wrapped__ = raw_harness
    _desktop_access(monkeypatch)
    wrapped = install_gui_harness_web_use(decorated_harness)

    result = wrapped(task="t", surface="desktop")
    assert result["status"] == "succeeded"
    assert result["success"] is True
    assert result["summary"] == "done"
    assert len(calls) == 1


def test_gui_agent_wrapper_records_one_public_gui_agent_node(tmp_path, monkeypatch):
    from openprogram import Agent
    from openprogram.agentic_programming.runtime import Runtime
    from openprogram.programs.gui_harness_bridge import (
        install_gui_harness_web_use,
    )
    from openprogram.store import SessionNodeWriter, SessionStore, _store

    class GuiStepAgent(Agent):
        method_options = {
            "gui_step": {"name": "gui_step", "tool": True},
        }

        def gui_step(self, task):
            return {
                "task": task,
                "success": True,
                "summary": "done",
                "completion_verified": True,
            }

    gui_step = GuiStepAgent().gui_step

    class GuiAgentAgent(Agent):
        method_options = {
            "gui_agent": {"name": "gui_agent", "tool": True},
        }

        def gui_agent(self, task, **_kwargs):
            raise AssertionError("task-only must not call the decorated legacy root")

    gui_agent = GuiAgentAgent().gui_agent

    capabilities = _capabilities(
        monkeypatch,
        effect=lambda _name, args, **kwargs: gui_step(args["task"]),
    )

    store = SessionStore(tmp_path / "sessions")
    store.create_session("s1", agent_id="main")
    writer = SessionNodeWriter(store, "s1")
    token = _store.set(writer)
    try:
        wrapped = install_gui_harness_web_use(gui_agent)
        run_on(Runtime(call=lambda *_a, **_k: "", model="dummy"), wrapped, task="t")
    finally:
        _store.reset(token)

    names = [node.name for node in writer.load() if node.is_code()]
    assert names.count("gui_agent") == 1
    assert names.count("gui_step") == 0
    link = next(n for n in writer.load() if n.metadata.get('child_session_id'))
    child = SessionNodeWriter(store, link.metadata['child_session_id']).load()
    assert sum(n.name == 'gui_step' for n in child) == 1
    assert len(capabilities.calls) == 1


@pytest.mark.parametrize(
    "max_steps,expected_calls,status",
    [
        (None, 2, "succeeded"),
        (0, 2, "succeeded"),
        (-3, 2, "succeeded"),
        (1, 1, "failed"),
        (20, 2, "succeeded"),
    ],
)
def test_task_only_gui_agent_enforces_actual_action_budget(
    monkeypatch, max_steps, expected_calls, status
):
    from openprogram.programs.gui_harness_bridge import install_gui_harness_web_use

    capabilities = _capabilities(monkeypatch, actions=2)

    def legacy(**kwargs):
        raise AssertionError("task-only must not call the legacy root")

    wrapped = install_gui_harness_web_use(legacy)
    result = run_on(SimpleNamespace(), wrapped, task="two actions", max_steps=max_steps)
    assert len(capabilities.calls) == expected_calls
    assert result["steps_taken"] == expected_calls
    assert result["status"] == status
    assert result["success"] is (status == "succeeded")
    if status == "failed":
        assert result["reason_code"] == "safety_step_limit"


def test_gui_agent_harness_uses_selected_computer_use_backend(monkeypatch):
    from openprogram.agent import surface_context
    from openprogram.programs.workflow import browser as module
    from openprogram.programs.workflow.browser import (
        web_use_runtime,
    )

    class _Registry:
        def __init__(self) -> None:
            self.calls = []

        def execute(self, **kwargs):
            self.calls.append(kwargs)
            if kwargs["command"] == "observe":
                return {
                    "ok": True,
                    "frame_id": "frame-1",
                    "web_session_id": "cs-1",
                    "backend": kwargs.get("backend") or "chrome_devtools_mcp",
                }
            if kwargs["command"] == "verify":
                return {"ok": True, "passed": True, "backend": "chrome_devtools_mcp"}
            return {"ok": True}

    registry = _Registry()
    monkeypatch.setattr(web_use_runtime, "get_registry", lambda: registry)
    context = {
        "context_id": "ctx-1",
        "surfaces": [
            {
                "binding_id": "binding-1",
                "capabilities": ["observe", "interact", "navigate"],
            }
        ],
    }
    monkeypatch.setattr(surface_context, "current", lambda: context)
    monkeypatch.setattr(
        surface_context, "resolve_binding", lambda _page="": "binding-1"
    )
    monkeypatch.setattr(surface_context, "resolve_page_key", lambda _page="": "page-1")

    class _Runtime:
        def exec(self, **kwargs):
            tool = kwargs["tools"][0]
            asyncio.run(
                tool.execute(
                    "call-1",
                    {
                        "action": "verify",
                        "expected_frame_id": "frame-1",
                        "page_context_token": "pct-current",
                        "assertion": "text_contains",
                        "value": "done",
                    },
                    asyncio.Event(),
                    None,
                )
            )
            return "verified"

    result = run_on(_Runtime(), module.browser_agent,
        task="Verify the page",
        backend="chrome_devtools_mcp",
    )
    assert result["status"] == "succeeded"
    verify_call = next(call for call in registry.calls if call["command"] == "verify")
    assert "page_context_token" not in verify_call["arguments"]
    assert registry.calls[0] == {
        "command": "observe",
        "backend": "chrome_devtools_mcp",
        "binding_id": "binding-1",
        "page_key": "page-1",
        "owner_id": "harness:ctx-1",
        "page_context": context,
    }
    assert registry.calls[-1] == {
        "command": "close",
        "web_session_id": "cs-1",
        "owner_id": "harness:ctx-1",
    }


def test_gui_agent_prompt_receives_group_aware_page_inventory(monkeypatch):
    from openprogram.agent import surface_context
    from openprogram.programs.workflow import browser as module
    from openprogram.programs.workflow.browser import (
        web_use_runtime,
    )

    inventory_context = {
        "context_id": "ctx-pages",
        "window_id": "window-1",
        "inventory_revision": 9,
        "active_tab_entry_id": "group:g3",
        "focused_page": "p4",
        "tab_entries": [
            {
                "id": "group:g3",
                "mode": "split",
                "pages": ["p3", "p4"],
            }
        ],
        "windows": [
            {
                "window_id": "window-1",
                "inventory_revision": 9,
                "active_tab_entry_id": "group:g3",
                "focused_page": "p4",
                "tab_entries": [
                    {
                        "id": "group:g3",
                        "mode": "split",
                        "pages": ["p3", "p4"],
                    }
                ],
                "pages": ["p3", "p4"],
            },
            {
                "window_id": "window-2",
                "inventory_revision": 4,
                "active_tab_entry_id": "tab:tab-d",
                "focused_page": "p5",
                "tab_entries": [
                    {
                        "id": "tab:tab-d",
                        "mode": "single",
                        "pages": ["p5"],
                    }
                ],
                "pages": ["p5"],
            },
        ],
        "surfaces": [],
    }

    class _Registry:
        def list_pages(self, **_kwargs):
            return {
                "ok": True,
                "browser_context_id": "ctx-pages",
                "window_id": "window-1",
                "inventory_revision": 9,
                "active_tab_entry_id": "group:g3",
                "focused_page": "p4",
                "tab_entries": inventory_context["tab_entries"],
                "windows": inventory_context["windows"],
                "pages": [
                    {
                        "page": "p3",
                        "window_id": "window-1",
                        "tab_id": "tab-c",
                        "visible": True,
                        "focused": False,
                        "page_context_token": "pct_3",
                    },
                    {
                        "page": "p4",
                        "window_id": "window-1",
                        "tab_id": "tab-d",
                        "visible": True,
                        "focused": True,
                        "page_context_token": "pct_4",
                    },
                    {
                        "page": "p5",
                        "window_id": "window-2",
                        "tab_id": "tab-d",
                        "visible": True,
                        "focused": True,
                        "page_context_token": "pct_5",
                    },
                ],
            }

        def execute(self, **kwargs):
            if kwargs["command"] == "observe":
                return {
                    "ok": True,
                    "frame_id": "frame-1",
                    "web_session_id": "cs-1",
                }
            if kwargs["command"] == "verify":
                return {"ok": True, "passed": True}
            return {"ok": True, "closed": True}

    registry = _Registry()
    monkeypatch.setattr(web_use_runtime, "get_registry", lambda: registry)
    monkeypatch.setattr(surface_context, "current", lambda: inventory_context)
    monkeypatch.setattr(
        surface_context,
        "capture_pages",
        lambda _context=None: inventory_context,
    )
    prompts = []

    class _Runtime:
        def exec(self, **kwargs):
            prompts.append(kwargs["content"][0]["text"])
            asyncio.run(
                kwargs["tools"][0].execute(
                    "call-1",
                    {
                        "action": "verify",
                        "expected_frame_id": "frame-1",
                        "assertion": "text_contains",
                        "value": "done",
                    },
                    asyncio.Event(),
                    None,
                )
            )
            return "verified"

    result = run_on(_Runtime(), module._run_browser_task_commands,
        task="Verify the split page",
        backend="chrome_devtools_mcp",
        max_steps=2,
        max_seconds=30,
    )

    assert result["status"] == "succeeded"
    assert '"active_tab_entry_id": "group:g3"' in prompts[0]
    assert '"pages": ["p3", "p4"]' in prompts[0]
    assert '"page": "p4"' in prompts[0]
    assert '"window_id": "window-2"' in prompts[0]
    assert '"page": "p5"' in prompts[0]
    assert prompts[0].count('"bound": true') == 1
