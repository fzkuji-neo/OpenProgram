"""A project's own Memory is read beside the personal one, behind switches.

Both switches are on by default; the fixture starts with them off so each
test turns on what it exercises.
"""
from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

SOURCE = '# Conversation 1\n\n<a id="d1-1"></a>\n\nuser: remember this\n'


def _note(fact: str, block: str) -> str:
    return (
        "# Note\n"
        "\n"
        f"{fact}[^e-1f4c7a2b90] ^{block}\n"
        "\n"
        "[^e-1f4c7a2b90]: Time: `2026-01-01`; "
        "Sources: [D1:1](../sources/D1.md#d1-1)\n"
    )


def _seed(root: Path, fact: str, block: str) -> None:
    (root / "sources").mkdir(parents=True, exist_ok=True)
    (root / "topics").mkdir(parents=True, exist_ok=True)
    (root / "sources" / "D1.md").write_text(SOURCE, encoding="utf-8")
    (root / "topics" / "note.md").write_text(_note(fact, block), encoding="utf-8")


OWNER = {
    "speaker_kind": "owner",
    "speaker_id": "owner/local",
    "speaker_display": "Owner",
    "principal_id": "owner/install/0123456789abcdef",
    "authority_tier": "owner",
    "interaction": "interactive",
}


@pytest.fixture
def setup(tmp_path, monkeypatch):
    """Personal memory, a registered project, and switchable layer settings."""
    import openprogram.paths as paths
    from openprogram import setup as setup_module
    from openprogram.agent import run_control
    from openprogram.memory import store
    from openprogram.store.project import project_store

    monkeypatch.setattr(paths, "get_state_dir", lambda: tmp_path / "state")
    settings: dict = {"memory": {"layers": {"project": False, "project_writes": False}}}
    monkeypatch.setattr(setup_module, "_read_config", lambda: settings)
    folder = tmp_path / "repo"
    folder.mkdir()
    projects = {
        "s-project": SimpleNamespace(id="p1", path=str(folder), is_default=False),
        "s-adhoc": SimpleNamespace(id="default", path=str(tmp_path), is_default=True),
    }
    monkeypatch.setattr(project_store, "project_for_session", projects.get)
    monkeypatch.setattr(project_store, "list_projects", lambda: list(projects.values()))
    token = run_control.set_current_session_id("s-project")
    personal = store.ensure()
    _seed(personal, "Personal: the user prefers tea.", "abc11111")
    try:
        yield SimpleNamespace(
            settings=settings,
            personal=personal,
            project=(tmp_path / "state" / "projects" / "p1" / "memory").resolve(),
        )
    finally:
        run_control.reset_current_session_id(token)


def _turn_on(env, *, writes=False):
    env.settings["memory"]["layers"] = {"project": True, "project_writes": writes}


def _seed_project(env):
    from openprogram.memory import project_layer, store

    with project_layer.use(env.project, write=True):
        store.ensure()
    _seed(env.project, "Project: the API uses gRPC for transport.", "def22222")


def test_switched_off_reads_personal_and_reading_creates_nothing(setup):
    from openprogram.memory import project_layer

    assert project_layer.read_layers().single
    _turn_on(setup)
    # Switched on, but the project has no memory yet: reads stay personal
    # and do not create the project's workspace.
    assert project_layer.read_layers().single
    assert not setup.project.exists()


def test_both_layers_are_on_by_default(setup):
    from openprogram.memory.management.config import load_memory_config

    setup.settings["memory"]["layers"] = {}
    config = load_memory_config()
    assert config.project_layer and config.project_writes


def test_personal_memory_is_the_system_projects(setup, tmp_path):
    assert setup.personal == (
        tmp_path / "state" / "projects" / "default" / "memory").resolve()


def test_reads_span_both_layers_with_qualified_paths(setup):
    from openprogram.memory import project_layer
    from openprogram.programs.tools.knowledge.memory import memory as tools

    _seed_project(setup)
    _turn_on(setup)
    browse = tools.memory_browse(prefix="topics/")
    assert "project:topics/note.md" in browse
    assert "personal:topics/note.md" in browse
    assert "gRPC" in tools.memory_get(path="project:topics/note.md")
    assert "tea" in tools.memory_get(path="topics/note.md")  # default: personal
    grep = tools.memory_grep(query="gRPC")
    assert grep.startswith("project:topics/note.md:")

    found = project_layer.read_layers("s-project").search("API transport gRPC tea")
    assert [hit["layer"] for hit in found["results"]] == ["project", "personal"]
    # A conversation outside a project reads personal memory only.
    alone = project_layer.read_layers("s-adhoc").search("API transport gRPC tea")
    assert [hit["path"] for hit in alone["results"]] == ["topics/note.md"]


def test_recall_reads_the_layers_of_its_own_conversation(setup, monkeypatch):
    from openprogram.memory import project_layer
    from openprogram.memory.local_backend import LocalMemoryBackend

    asked = []

    class Layers:
        def search(self, query, **_):
            return {"results": [{"content": "Project: gRPC.", "trust_state": "trusted"}]}

    monkeypatch.setattr(project_layer, "read_layers", lambda sid=None: asked.append(sid) or Layers())
    assert "gRPC" in LocalMemoryBackend().search("transport", session_id="s-project")
    assert asked == ["s-project"]


def test_core_of_the_project_comes_first(setup):
    from openprogram.memory.local_backend import LocalMemoryBackend

    _seed_project(setup)
    (setup.personal / "core.md").write_text("# Core\n\nPersonal core.\n", encoding="utf-8")
    (setup.project / "core.md").write_text("# Core\n\nProject core.\n", encoding="utf-8")
    assert "Project core." not in LocalMemoryBackend().system_prompt()
    _turn_on(setup)
    prompt = LocalMemoryBackend().system_prompt()
    assert prompt.index("Project core.") < prompt.index("Personal core.")


def test_update_names_its_layer_and_status_names_the_default(setup, monkeypatch):
    from openprogram.programs.tools.knowledge.memory import memory as tools

    monkeypatch.setattr(tools, "authority_from_message", lambda *_: OWNER)
    _seed_project(setup)
    _turn_on(setup)
    status = json.loads(tools.memory_status())
    assert set(status["layers"]) == {"project", "personal"}
    assert status["default_layer"] == "personal"
    accepted = json.loads(tools.memory_update(
        base_revision=status["revision"],
        layer="project",
        changes=[{
            "path": "topics/note.md", "action": "write",
            "content": _note("Project: the API moved to HTTP/3.", "def22222"),
        }],
    ))
    assert accepted["ok"] is True and accepted["layer"] == "project", accepted
    assert "HTTP/3" in (setup.project / "topics/note.md").read_text(encoding="utf-8")
    assert "tea" in (setup.personal / "topics/note.md").read_text(encoding="utf-8")

    _turn_on(setup, writes=True)
    assert json.loads(tools.memory_status())["default_layer"] == "project"


def test_update_refuses_a_project_layer_that_is_not_there(setup, monkeypatch):
    from openprogram.programs.tools.knowledge.memory import memory as tools

    monkeypatch.setattr(tools, "authority_from_message", lambda *_: OWNER)
    revision = json.loads(tools.memory_status())["revision"]
    refused = json.loads(tools.memory_update(
        base_revision=revision, layer="project",
        changes=[{"path": "topics/x.md", "action": "delete"}],
    ))
    assert refused["error"]["code"] == "INVALID_ARGUMENT"


def test_background_writes_route_to_the_project_and_never_twice(setup):
    from openprogram.memory import project_layer, store, writing

    personal_id = store.workspace_id()
    _turn_on(setup)
    with project_layer.write_target("s-project") as target:
        assert target is None and store.root() == setup.personal
    _turn_on(setup, writes=True)
    with project_layer.write_target("s-project") as target:
        assert target == setup.project
        assert store.root() == setup.project
        project_id = store.workspace_id()
        assert project_id != personal_id
        # A turn already written to personal memory is not written again.
        rows = [{"id": "n1", writing.WRITTEN_NODE_MARKER: personal_id},
                {"id": "n2"}]
        assert writing._marked_ids(rows, project_id) == {"n1"}
    assert store.root() == setup.personal
    # Switched back off, turns written to the project are not copied over.
    _turn_on(setup)
    with project_layer.write_target("s-project"):
        rows = [{"id": "n1", writing.WRITTEN_NODE_MARKER: project_id}]
        assert writing._marked_ids(rows, personal_id) == {"n1"}


def test_nightly_reorganize_covers_project_memory(setup, monkeypatch):
    from openprogram.memory import scheduler, store

    _seed_project(setup)
    _turn_on(setup)
    seen = []

    class Backend:
        def reorganize(self, **_):
            seen.append(store.root())
            return {"status": "ok"}

    monkeypatch.setattr(scheduler, "get_backend", lambda: Backend())
    monkeypatch.setattr(
        "openprogram.agent.management.manager.list_all", lambda: [],
    )
    scheduler.reorganize_spaces()
    assert seen == [setup.personal, setup.project]
