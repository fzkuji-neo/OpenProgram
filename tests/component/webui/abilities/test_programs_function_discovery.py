from pathlib import Path

from openprogram.webui._functions import (
    _discover_workflow_functions,
    _extract_all_functions,
    _extract_function_info,
)


def test_goal_launcher_keeps_original_prompt_schema_through_ownership_wrapper():
    import openprogram.programs.workflow.goal  # register the public entry

    row = next(
        row for row in _discover_workflow_functions(set()) if row["name"] == "goal"
    )
    assert "prompt" in row["params"]
    assert row["filepath"].endswith("/goal/goal.py")


def test_goal_source_endpoint_returns_goal_instead_of_ownership_wrapper(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from openprogram.programs.workflow.goal.goal import goal
    from openprogram.webui import server
    from openprogram.webui.routes.catalog import functions

    monkeypatch.setattr(server, "_load_function", lambda _name: goal)
    app = FastAPI()
    functions.register(app)
    response = TestClient(app).get("/api/function/goal/source")
    assert response.status_code == 200
    data = response.json()
    assert data["filepath"].endswith("/goal/goal.py")
    assert "def goal(" in data["source"]
    assert "def run(" not in data["source"]


def test_workflow_category_has_no_authoring_entries() -> None:
    workflow_dir = Path(__file__).parents[4] / "openprogram" / "programs" / "workflow"
    for filename in (
        "search_workflows.py",
        "create_workflow.py",
        "revise_workflow.py",
        "auto_workflow.py",
        "resume_workflow.py",
    ):
        assert not (workflow_dir / filename).exists()


def test_programs_treats_workflow_as_category_not_program() -> None:
    from openprogram.webui.routes.catalog.programs import _list_entries, _program_logic

    root_entries = _list_entries("")
    workflow = next(
        entry for entry in root_entries["entries"] if entry["path"] == "workflow"
    )
    assert workflow["program_kind"] is None
    assert workflow["has_children"] is True
    assert not any(
        entry["path"] == "workflow/agentic_workflow"
        for entry in root_entries["entries"]
    )

    children = {entry["path"]: entry for entry in _list_entries("workflow")["entries"]}
    for removed in ("search_workflows", "create_workflow", "revise_workflow", "auto_workflow"):
        assert f"workflow/{removed}" not in children
    assert "workflow/authoring" not in children
    assert "workflow/errors" not in children
    assert "workflow/json_parsing" not in children
    assert "workflow/ask_user" not in children
    assert "workflow/resume_workflow" not in children
    assert not any(path.endswith(".py") for path in children)
    assert not any(entry["name"].startswith("_") for entry in children.values())
    assert len(children) == len({entry["name"] for entry in children.values()})
    assert "workflow/browser" in children
    assert children["workflow/browser"]["has_children"] is True
    assert children["workflow/docs_question"]["has_children"] is True
    assert children["workflow/docs_question"]["program_kind"] is None
    assert children["workflow/docs_question"]["name"] == "docs_question"
    assert children["workflow/goal"]["has_children"] is True
    assert children["workflow/goal"]["program_kind"] is None
    assert children["workflow/goal"]["name"] == "goal"
    assert children["workflow/goal"]["callable_name"] == "goal"
    assert children["workflow/goal"]["logic_path"] == "workflow/goal"
    assert children["workflow/security_review"]["has_children"] is True
    assert children["workflow/security_review"]["name"] == "security_review"

    goal_entry = _list_entries("workflow/goal")["entries"]
    goal_by_name = {entry["name"]: entry for entry in goal_entry}
    assert goal_by_name["goal"]["callable_name"] == "goal"
    assert goal_by_name["goal"]["logic_path"] == "workflow/goal"
    assert goal_by_name["goal"]["program_kind"] == "workflow"
    assert {
        "command",
        "judge",
        "loop",
        "notices",
        "refinement",
        "state",
    } <= set(goal_by_name)
    command = goal_by_name["command"]
    assert "callable_name" not in command
    assert command["path"] == "workflow/goal/command"
    assert command["logic_path"] == "workflow/goal/command"
    assert command["program_kind"] is None
    command_logic = _program_logic("workflow/goal/command")
    assert command_logic["root"] == "workflow/goal/command"
    assert command_logic["nodes"][0]["program_kind"] is None
    notices_logic = _program_logic("workflow/goal/notices")
    # Package attribute calls must resolve to the defining helper, not goal().
    # State now reaches presentation/verification/chat transitively, so absence
    # from the entire graph is not the package-resolution contract.
    notice_targets = {
        edge["target"]
        for edge in notices_logic["edges"]
        if edge["source"] == "workflow/goal/notices"
    }
    assert notice_targets == {"workflow/goal/state"}
    goal_logic = _program_logic("workflow/goal")
    goal_ids = {node["id"] for node in goal_logic["nodes"]}
    goal_edges = {(edge["source"], edge["target"]) for edge in goal_logic["edges"]}
    assert "agentic_programming/agent" in goal_ids
    assert "workflow/goal/judge" in goal_ids
    assert "workflow/goal/refinement" in goal_ids
    assert "workflow/goal/loop" in goal_ids
    assert "workflow/goal/notices" in goal_ids
    assert "workflow/goal/command" not in goal_ids
    assert ("workflow/goal/loop", "workflow/goal/judge") not in goal_edges
    assert ("workflow/goal", "workflow/goal/judge") in goal_edges
    docs_entry = _list_entries("workflow/docs_question")["entries"]
    assert [(entry["callable_name"], entry["logic_path"]) for entry in docs_entry] == [
        ("run_docs_question", "workflow/docs_question")
    ]

    old_source = (
        Path(__file__).parents[4] / "openprogram/programs/workflow/agentic_workflow"
    )
    assert not old_source.exists()


def test_goal_form_keeps_prompt_primary_and_preserves_explicit_controls() -> None:
    source = Path(__file__).parents[4] / "openprogram/programs/workflow/goal/goal.py"
    goal = next(
        info
        for info in _extract_all_functions(str(source), "workflow")
        if info["name"] == "goal"
    )
    visible = [p["name"] for p in goal["params_detail"] if not p.get("hidden")]
    assert visible == ["prompt"]
    advanced = {p["name"] for p in goal["params_detail"] if p.get("advanced")}
    assert advanced == {
        "model",
        "effort",
        "judge_model",
        "judge_effort",
        "judge_timeout_s",
        "max_rounds",
        "max_tokens",
        "max_elapsed_s",
        "max_cost_usd",
        "timeout_s",
        "context_mode",
    }
    assert not advanced.intersection({"runtime", "resume", "expected_goal"})


def test_function_info_preserves_advanced_input_metadata(tmp_path: Path) -> None:
    source = tmp_path / "advanced_function.py"
    source.write_text(
        'from openprogram import Agent\nclass AdvancedFunctionAgent(Agent):\n    method_options = {\n        \'advanced_function\': {\n            \'input\': {\n    "max_steps": {"hidden": True, "advanced": True},\n},\n            \'name\': \'advanced_function\',\n            \'tool\': True\n        },\n    }\n\n    def advanced_function(self, task: str, max_steps: int = 3) -> str:\n        """Run one task."""\n        return task\n\n\nadvanced_function = AdvancedFunctionAgent().advanced_function\n',
        encoding="utf-8",
    )

    info = _extract_function_info(str(source), "advanced_function", "app")

    assert info is not None
    max_steps = next(
        param for param in info["params_detail"] if param["name"] == "max_steps"
    )
    assert max_steps["hidden"] is True
    assert max_steps["advanced"] is True


def test_registered_workflow_is_available_to_favorites(
    tmp_path: Path, monkeypatch
) -> None:
    from types import SimpleNamespace

    from openprogram.programs._runtime import _registry

    source = tmp_path / "favorite_workflow.py"
    source.write_text(
        "def favorite_workflow(task: str) -> str:\n"
        '    """Prepare a report."""\n'
        "    return task\n",
        encoding="utf-8",
    )
    # A package in ~/.openprogram/workflows imports under its own name
    # (favorite_workflow.workflow); the loader tags the tool with its owner.
    namespace = {"__name__": "favorite_workflow.workflow"}
    exec(compile(source.read_text(), str(source), "exec"), namespace)
    monkeypatch.setitem(
        _registry,
        "favorite_workflow",
        SimpleNamespace(
            _is_agent_method=True,
            _python_callable=namespace["favorite_workflow"],
            _workflow_owner="favorite_workflow",
        ),
    )

    workflows = _discover_workflow_functions(set())

    workflow = next(
        program for program in workflows if program["name"] == "favorite_workflow"
    )
    assert workflow["category"] == "workflow"
    assert workflow["params"] == ["task"]


def test_nested_multi_entry_agentic_file_expands_as_virtual_group(
    tmp_path: Path,
    monkeypatch,
) -> None:
    from openprogram.webui.routes.catalog import programs

    source = tmp_path / "workflow/deep/category/tools.py"
    source.parent.mkdir(parents=True)
    source.write_text("# test source\n", encoding="utf-8")
    indexed = {
        "workflow/deep/category/tools": [
            {"name": "alpha", "description": "", "source": source},
            {"name": "beta", "description": "", "source": source},
        ],
    }
    monkeypatch.setattr(programs, "PROGRAMS_ROOT", tmp_path)
    monkeypatch.setattr(
        programs,
        "_registered_agent_methods",
        lambda: indexed,
    )

    category = programs._list_entries("workflow/deep/category")
    group = next(entry for entry in category["entries"] if entry["name"] == "tools")
    assert group["program_kind"] is None
    assert group["has_children"] is True
    entries = programs._list_entries("workflow/deep/category/tools")["entries"]
    assert [entry["name"] for entry in entries] == ["alpha", "beta"]


def test_agentic_registry_discovery_uses_a_stable_snapshot(monkeypatch) -> None:
    import importlib

    from openprogram.webui.routes.catalog.programs import _registered_agent_methods

    function = importlib.import_module("openprogram.programs._runtime")
    original = function._registry

    class MutatingRegistry(dict):
        def items(self):
            iterator = super().items()

            def mutate_during_iteration():
                first = next(iterator)
                yield first
                self["late_registration"] = first[1]
                yield from iterator

            return mutate_during_iteration()

    monkeypatch.setattr(function, "_registry", MutatingRegistry(original))

    indexed = _registered_agent_methods()

    assert "workflow/goal" in indexed
    assert "workflow/docs_question" in indexed


def test_multi_entry_call_graph_scopes_imports_to_selected_function(
    tmp_path: Path,
    monkeypatch,
) -> None:
    from openprogram.webui.routes.catalog import programs

    group = tmp_path / "group.py"
    group.write_text(
        "from openprogram.programs.workflow.dep import zz_dep\n"
        "def zz_alpha():\n"
        "    return zz_dep()\n"
        "def zz_beta():\n"
        "    return None\n",
        encoding="utf-8",
    )
    dependency = tmp_path / "dep.py"
    dependency.write_text("def zz_dep():\n    return None\n", encoding="utf-8")
    indexed = {
        "workflow/group": [
            {"name": "zz_alpha", "description": "", "source": group},
            {"name": "zz_beta", "description": "", "source": group},
        ],
        "workflow/dep": [
            {"name": "zz_dep", "description": "", "source": dependency},
        ],
    }
    entities = {
        "workflow/group/zz_alpha": group,
        "workflow/group/zz_beta": group,
        "workflow/dep": dependency,
    }
    monkeypatch.setattr(programs, "_inside_programs", lambda _path: True)
    monkeypatch.setattr(
        programs,
        "_registered_agent_methods",
        lambda: indexed,
    )
    monkeypatch.setattr(programs, "_entity_paths", lambda: entities)

    alpha = programs._program_logic("workflow/group/zz_alpha")
    beta = programs._program_logic("workflow/group/zz_beta")

    assert {(edge["source"], edge["target"]) for edge in alpha["edges"]} == {
        (
            "workflow/group/zz_alpha",
            "workflow/dep",
        ),
    }
    assert beta["edges"] == []



def test_installed_program_entry_is_available_to_favorites(
    tmp_path: Path, monkeypatch
) -> None:
    import functools
    from types import SimpleNamespace

    from openprogram.programs import _programs
    from openprogram.programs._runtime import _registry
    from openprogram.webui._functions import _discover_program_functions

    source = tmp_path / "main.py"
    source.write_text(
        "def paper_agent(topic: str) -> str:\n"
        '    """Write a paper."""\n'
        "    return topic\n",
        encoding="utf-8",
    )
    namespace = {"__name__": "paper_harness.main"}
    exec(compile(source.read_text(), str(source), "exec"), namespace)

    # The registry holds the Agent method wrapper, defined elsewhere.
    @functools.wraps(namespace["paper_agent"])
    def wrapper(*args, **kwargs):
        return namespace["paper_agent"](*args, **kwargs)

    monkeypatch.setitem(
        _registry, "paper_agent", SimpleNamespace(_python_callable=wrapper)
    )
    monkeypatch.setattr(
        _programs,
        "installed_programs",
        lambda: [SimpleNamespace(function="paper_agent")],
    )

    rows = {row["name"]: row for row in _discover_program_functions(set())}
    assert rows["paper_agent"]["filepath"] == str(source)
    assert rows["paper_agent"]["params"] == ["topic"]
