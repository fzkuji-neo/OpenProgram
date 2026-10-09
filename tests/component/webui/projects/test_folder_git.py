"""Per-folder git pills: status, branch switch, worktree, PR guard rails."""
from __future__ import annotations

import asyncio
import json
import subprocess
from pathlib import Path

import pytest

from openprogram.worktree import folder_git


def _git(cwd: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(cwd), *args], check=True, capture_output=True, text=True,
    ).stdout


@pytest.fixture()
def repo(tmp_path: Path) -> Path:
    root = tmp_path / "proj"
    root.mkdir()
    _git(root, "init", "-q", "-b", "main")
    _git(root, "config", "user.email", "t@example.com")
    _git(root, "config", "user.name", "T")
    (root / "a.txt").write_text("one\ntwo\n")
    _git(root, "add", "a.txt")
    _git(root, "commit", "-q", "-m", "init")
    return root


def test_non_repo_folder_reports_not_a_repo(tmp_path: Path) -> None:
    assert folder_git.folder_status(str(tmp_path))["is_repo"] is False
    assert folder_git.folder_status("relative/path")["is_repo"] is False


def test_status_counts_tracked_lines_and_untracked_files(repo: Path) -> None:
    (repo / "a.txt").write_text("one\nTWO\nthree\n")
    (repo / "new.txt").write_text("x\n")
    status = folder_git.folder_status(str(repo), include_branches=True)
    assert status["branch"] == "main"
    assert status["changes"] == {
        "files": 2, "untracked": 1, "conflicts": 0, "insertions": 2, "deletions": 1,
    }
    assert status["branches"] == ["main"]
    assert status["is_worktree"] is False
    assert status["has_remote"] is False


def test_subfolder_reports_its_repository(repo: Path) -> None:
    sub = repo / "pkg"
    sub.mkdir()
    status = folder_git.folder_status(str(sub))
    assert status["root"] == str(repo.resolve()) or Path(status["root"]).resolve() == repo.resolve()


def test_switch_branch_creates_and_switches(repo: Path) -> None:
    status = folder_git.switch_branch(str(repo), "feature/x", create=True)
    assert status["branch"] == "feature/x"
    status = folder_git.switch_branch(str(repo), "main")
    assert status["branch"] == "main"
    with pytest.raises(folder_git.FolderGitError):
        folder_git.switch_branch(str(repo), "does-not-exist")
    with pytest.raises(folder_git.FolderGitError):
        folder_git.switch_branch(str(repo), "-bad", create=True)


def test_create_worktree_lands_beside_the_repo(repo: Path) -> None:
    (repo / "a.txt").write_text("dirty\n")
    wt = folder_git.create_worktree(str(repo), "feat/wt")
    target = Path(wt["path"])
    assert target.parent == repo.parent / "proj-worktrees"
    assert wt["branch"] == "feat/wt"
    assert wt["is_worktree"] is True
    # The source checkout keeps its uncommitted change; the worktree is clean.
    assert (repo / "a.txt").read_text() == "dirty\n"
    assert (target / "a.txt").read_text() == "one\ntwo\n"
    with pytest.raises(folder_git.FolderGitError, match="already checked out"):
        folder_git.create_worktree(str(repo), "feat/wt")


def test_create_pr_refuses_without_remote_or_on_base(repo: Path, monkeypatch) -> None:
    monkeypatch.setattr(folder_git.shutil, "which", lambda name: None)
    with pytest.raises(folder_git.FolderGitError, match="GitHub CLI"):
        folder_git.create_pull_request(str(repo))
    monkeypatch.setattr(folder_git.shutil, "which", lambda name: "/usr/bin/false")
    with pytest.raises(folder_git.FolderGitError, match="origin"):
        folder_git.create_pull_request(str(repo))


class _WS:
    def __init__(self) -> None:
        self.frames: list[dict] = []

    async def send_text(self, text: str) -> None:
        self.frames.append(json.loads(text))


def test_ws_actions_echo_path_and_report_errors(repo: Path) -> None:
    from openprogram.webui.ws_actions import folder_git as actions

    ws = _WS()
    asyncio.run(actions.handle_git_folder_status(ws, {"path": str(repo)}))
    asyncio.run(actions.handle_git_switch_branch(ws, {"path": str(repo), "branch": "nope"}))
    status, switch = ws.frames
    assert status["type"] == "git_folder_status"
    assert status["data"]["path"] == str(repo)
    assert status["data"]["status"]["branch"] == "main"
    assert switch["type"] == "git_switch_branch_result"
    assert switch["data"]["ok"] is False and switch["data"]["error"]
