"""The one-time move of conversations and memory into project folders."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from openprogram.store.project import layout_migration as lm


@pytest.fixture(autouse=True)
def _fresh_process():
    lm._done.clear()
    yield
    lm._done.clear()


def _chat(directory: Path, sid: str, *, project_id: str | None = None,
          history: int = 1, body: str = "") -> Path:
    path = directory / sid
    (path / "history").mkdir(parents=True)
    meta = {"id": sid}
    if project_id:
        meta["project_id"] = project_id
    (path / "meta.json").write_text(json.dumps(meta), encoding="utf-8")
    for i in range(history):
        (path / "history" / f"{i:04d}-u-m{i}.json").write_text(
            json.dumps({"id": f"m{i}", "content": body}), encoding="utf-8")
    return path


def _legacy_state(tmp_path: Path) -> Path:
    state = tmp_path / "state"
    sessions = state / "sessions"
    project_folder = tmp_path / "paper"
    (project_folder / ".openprogram" / "memory" / "topics").mkdir(parents=True)
    (project_folder / ".openprogram" / "memory" / "topics" / "t.md").write_text("paper note")
    projects = state / "projects"
    projects.mkdir(parents=True)
    (projects / "projects.json").write_text(json.dumps({
        "default": {"id": "default", "name": "home", "path": str(tmp_path), "is_default": True},
        "p1": {"id": "p1", "name": "paper", "path": str(project_folder), "session_ids": ["bound"]},
    }), encoding="utf-8")
    (projects / "default-settings.json").write_text("{}", encoding="utf-8")
    _chat(sessions, "loose")
    _chat(sessions, "bound")
    _chat(sessions, "by-meta", project_id="p1")
    _chat(sessions / "projects" / "p1", "nested",
          body=f"wrote {state}/sessions/projects/p1/nested/workdir/a.txt")
    _chat(sessions, "refers", body=f"see {state}/sessions/loose/workdir/b.txt")
    (sessions / "index.json").write_text("{}", encoding="utf-8")
    (sessions / "locations.json").write_text(json.dumps({
        "loose": f"{state}/sessions/loose"}), encoding="utf-8")
    (sessions / ".deleted").mkdir()
    (sessions / ".deleted" / "gone").write_text("x")
    (state / "memory" / "topics").mkdir(parents=True)
    (state / "memory" / "topics" / "me.md").write_text("personal note")
    return state


def test_everything_moves_under_its_project(tmp_path):
    state = _legacy_state(tmp_path)
    root = lm.ensure_layout(state)

    assert root == state / "projects"
    assert (root / lm.MARKER).is_file()
    for project_id, sid in [("default", "loose"), ("default", "refers"),
                            ("p1", "bound"), ("p1", "by-meta"), ("p1", "nested")]:
        assert (root / project_id / "chats" / sid / "meta.json").is_file(), sid
    assert (root / "default" / "memory" / "topics" / "me.md").read_text() == "personal note"
    assert (root / "p1" / "memory" / "topics" / "t.md").read_text() == "paper note"
    assert not (tmp_path / "paper" / ".openprogram" / "memory").exists()
    assert (root / "default" / "settings.json").is_file()
    assert (root / ".chats-index.json").is_file()
    assert (root / ".deleted" / "gone").is_file()
    assert not (state / "sessions").exists() and not (state / "memory").exists()
    [backup] = (state / "backups").iterdir()
    assert (backup / "sessions" / "loose" / "meta.json").is_file()
    assert (backup / "memory" / "topics" / "me.md").is_file()
    assert (backup / "project-memory" / "p1" / "topics" / "t.md").is_file()


def test_recorded_paths_follow_the_moved_chats(tmp_path):
    state = _legacy_state(tmp_path)
    root = lm.ensure_layout(state)

    nested = (root / "p1" / "chats" / "nested" / "history" / "0000-u-m0.json").read_text()
    assert f"{root}/p1/chats/nested/workdir/a.txt" in nested
    refers = (root / "default" / "chats" / "refers" / "history" / "0000-u-m0.json").read_text()
    assert f"{root}/default/chats/loose/workdir/b.txt" in refers
    locations = json.loads((root / ".chats-locations.json").read_text())
    assert locations["loose"] == str(root / "default" / "chats" / "loose")


def test_a_second_process_does_not_move_again(tmp_path):
    state = _legacy_state(tmp_path)
    lm.ensure_layout(state)
    lm._done.clear()
    lm.ensure_layout(state)
    assert len(list((state / "backups").iterdir())) == 1


def test_trees_an_older_process_writes_afterwards_merge_in(tmp_path):
    state = _legacy_state(tmp_path)
    root = lm.ensure_layout(state)
    # An older worker keeps running: it re-creates an empty shell of a moved
    # chat, starts a new one, and initialises an empty personal workspace.
    _chat(state / "sessions", "loose", history=0)
    _chat(state / "sessions", "late")
    (state / "sessions" / "index.json").write_text("{}", encoding="utf-8")
    (state / "memory" / ".git").mkdir(parents=True)
    (state / "memory" / ".git" / "HEAD").write_text("ref")
    (state / "memory" / "sources").mkdir()

    lm._done.clear()
    lm.ensure_layout(state)

    assert (root / "default" / "chats" / "late" / "meta.json").is_file()
    assert len(list((root / "default" / "chats" / "loose" / "history").iterdir())) == 1
    assert (root / "default" / "memory" / "topics" / "me.md").is_file()
    assert not (state / "sessions").exists()
    assert not (state / "memory").exists()
    assert not list(state.glob("*.legacy*"))


def test_a_workspace_with_its_own_notes_is_set_aside_not_lost(tmp_path):
    state = _legacy_state(tmp_path)
    lm.ensure_layout(state)
    (state / "memory" / "topics").mkdir(parents=True)
    (state / "memory" / "topics" / "later.md").write_text("written later")

    lm._done.clear()
    lm.ensure_layout(state)

    assert not (state / "memory").exists()
    assert (state / "memory.legacy" / "topics" / "later.md").read_text() == "written later"
