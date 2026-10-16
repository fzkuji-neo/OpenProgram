"""The home project is named after the home folder, not a fixed label."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from openprogram.store.project import project_store as projects


@pytest.fixture
def home(tmp_path: Path, monkeypatch) -> Path:
    state = tmp_path / ".openprogram"
    state.mkdir()
    folder = tmp_path / "ada"
    folder.mkdir()
    monkeypatch.setattr("openprogram.paths.get_state_dir", lambda: state)
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: folder))
    return folder


def _registry() -> dict:
    return json.loads(projects._registry_path().read_text(encoding="utf-8"))


def test_a_new_home_project_takes_the_home_folders_name(home):
    project = projects.get_default_project()
    assert project.name == "ada"
    assert project.path == str(home)


@pytest.mark.parametrize("old", ["System", "Default", ""])
def test_a_record_with_an_old_label_is_renamed_to_the_folder(home, old):
    projects.get_default_project()
    registry = _registry()
    registry["default"]["name"] = old
    projects._registry_path().write_text(json.dumps(registry), encoding="utf-8")

    assert projects.get_default_project().name == "ada"
    assert _registry()["default"]["name"] == "ada"


def test_a_name_the_user_chose_is_kept(home):
    projects.get_default_project()
    projects.update_project("default", {"name": "System"})
    assert projects.get_default_project().name == "System"
