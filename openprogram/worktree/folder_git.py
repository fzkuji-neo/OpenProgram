"""Per-folder Git state for the composer's git pills.

Every working folder a conversation uses (the main project folder and
each additional working directory) gets a small pill in the composer's
environment row. This module answers what that pill shows and performs
the four things its menu can do:

* :func:`folder_status` — branch, upstream ahead/behind, uncommitted
  change counts, the repository's worktrees, and (on request) the local
  branch list and the current branch's open pull request.
* :func:`switch_branch` — ``git switch`` (optionally ``-c``) in place.
  Uncommitted changes travel with the switch exactly as plain git
  allows; git's own refusal is returned as the error.
* :func:`create_worktree` — ``git worktree add`` for a branch in a
  sibling ``<repo>-worktrees/<branch>`` folder. Never touches the
  source checkout's files.
* :func:`create_pull_request` — push the current branch and open a PR
  with ``gh pr create --fill``. Requires the GitHub CLI, signed in.

Everything is read from git on demand; nothing is cached or polled.
All git calls run with ``GIT_OPTIONAL_LOCKS=0`` so a status read never
contends with the user's own git commands.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import threading
from pathlib import Path
from typing import Any, Optional

_GIT_TIMEOUT = 10
_NETWORK_TIMEOUT = 90
_MAX_BRANCHES = 50
_worktree_lock = threading.Lock()


class FolderGitError(ValueError):
    """A user-facing failure (bad input or a git / gh refusal)."""


def _env() -> dict[str, str]:
    env = dict(os.environ)
    env["GIT_OPTIONAL_LOCKS"] = "0"
    env["GIT_TERMINAL_PROMPT"] = "0"
    env.setdefault("LC_ALL", "C")
    return env


def _git(cwd: str, *args: str, timeout: int = _GIT_TIMEOUT) -> tuple[int, str, str]:
    try:
        proc = subprocess.run(
            ["git", "-C", cwd, *args],
            capture_output=True, text=True, timeout=timeout, env=_env(),
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return 1, "", str(exc)
    return proc.returncode, proc.stdout, proc.stderr.strip()


def _git_ok(cwd: str, *args: str, timeout: int = _GIT_TIMEOUT) -> str:
    code, out, err = _git(cwd, *args, timeout=timeout)
    if code:
        raise FolderGitError(err or f"git {args[0]} failed")
    return out


def _folder(path: object) -> str:
    if not isinstance(path, str) or not path.strip():
        raise FolderGitError("a folder path is required")
    p = Path(path).expanduser()
    if not p.is_absolute():
        raise FolderGitError("the folder path must be absolute")
    if not p.is_dir():
        raise FolderGitError("the folder does not exist")
    return str(p)


def _repo_root(path: str) -> Optional[str]:
    code, out, _ = _git(path, "rev-parse", "--show-toplevel")
    return out.strip() if code == 0 and out.strip() else None


def _parse_status_v2(out: str) -> dict[str, Any]:
    """Branch header + change counts from ``status --porcelain=v2 -z``."""
    info: dict[str, Any] = {
        "branch": None, "head": None, "upstream": None,
        "ahead": 0, "behind": 0, "files": 0, "untracked": 0, "conflicts": 0,
    }
    entries = out.split("\0")
    skip_next = False
    for entry in entries:
        if skip_next:  # rename/copy entries carry the original path next
            skip_next = False
            continue
        if not entry:
            continue
        if entry.startswith("# branch.oid "):
            oid = entry[len("# branch.oid "):]
            info["head"] = None if oid == "(initial)" else oid[:8]
        elif entry.startswith("# branch.head "):
            head = entry[len("# branch.head "):]
            info["branch"] = None if head == "(detached)" else head
        elif entry.startswith("# branch.upstream "):
            info["upstream"] = entry[len("# branch.upstream "):]
        elif entry.startswith("# branch.ab "):
            m = re.match(r"# branch\.ab \+(\d+) -(\d+)", entry)
            if m:
                info["ahead"], info["behind"] = int(m.group(1)), int(m.group(2))
        elif entry[0] in "12":
            info["files"] += 1
            if entry[0] == "2":
                skip_next = True
        elif entry[0] == "u":
            info["files"] += 1
            info["conflicts"] += 1
        elif entry[0] == "?":
            info["files"] += 1
            info["untracked"] += 1
    return info


def _line_counts(root: str, has_head: bool) -> tuple[int, int]:
    """Insertions / deletions of tracked changes against HEAD."""
    args = ["diff", "--numstat", "-z", "HEAD"] if has_head else ["diff", "--numstat", "-z", "--cached"]
    code, out, _ = _git(root, *args)
    if code:
        return 0, 0
    added = removed = 0
    for record in out.split("\0"):
        parts = record.split("\t")
        if len(parts) >= 2 and parts[0].isdigit() and parts[1].isdigit():
            added += int(parts[0])
            removed += int(parts[1])
    return added, removed


def _worktrees(root: str) -> list[dict[str, Any]]:
    code, out, _ = _git(root, "worktree", "list", "--porcelain")
    if code:
        return []
    rows: list[dict[str, Any]] = []
    for block in out.strip().split("\n\n"):
        row: dict[str, Any] = {"path": None, "branch": None, "detached": False}
        for line in block.splitlines():
            if line.startswith("worktree "):
                row["path"] = line[len("worktree "):]
            elif line.startswith("branch "):
                row["branch"] = line[len("branch "):].removeprefix("refs/heads/")
            elif line == "detached":
                row["detached"] = True
            elif line == "bare":
                row["bare"] = True
        if row["path"] and not row.get("bare"):
            rows.append(row)
    for index, row in enumerate(rows):
        row["is_main"] = index == 0  # git always lists the main worktree first
        row["is_current"] = _same_path(row["path"], root)
    return rows


def _same_path(a: str, b: str) -> bool:
    try:
        return Path(a).resolve() == Path(b).resolve()
    except OSError:
        return a == b


def _default_branch(root: str) -> Optional[str]:
    code, out, _ = _git(root, "symbolic-ref", "--short", "refs/remotes/origin/HEAD")
    if code == 0 and out.strip():
        return out.strip().split("/", 1)[-1]
    for name in ("main", "master"):
        if _git(root, "show-ref", "--verify", "--quiet", f"refs/heads/{name}")[0] == 0:
            return name
    return None


def _has_remote(root: str, name: str = "origin") -> bool:
    return _git(root, "remote", "get-url", name)[0] == 0


def _branches(root: str) -> list[str]:
    code, out, _ = _git(
        root, "for-each-ref", "--sort=-committerdate",
        f"--count={_MAX_BRANCHES}", "--format=%(refname:short)", "refs/heads",
    )
    return [b for b in out.splitlines() if b] if code == 0 else []


def _open_pr(root: str, branch: str) -> Optional[dict[str, Any]]:
    gh = shutil.which("gh")
    if not gh:
        return None
    try:
        proc = subprocess.run(
            [gh, "pr", "view", branch, "--json", "number,url,state,title,isDraft"],
            cwd=root, capture_output=True, text=True, timeout=8, env=_env(),
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if proc.returncode:
        return None
    import json
    try:
        data = json.loads(proc.stdout)
    except ValueError:
        return None
    if not isinstance(data, dict) or not data.get("url"):
        return None
    return {k: data.get(k) for k in ("number", "url", "state", "title", "isDraft")}


def folder_status(
    path: object, *, include_branches: bool = False, include_pr: bool = False,
) -> dict[str, Any]:
    """Git state of one working folder. Never raises for a non-repo."""
    try:
        folder = _folder(path)
    except FolderGitError as exc:
        return {"path": path, "is_repo": False, "error": str(exc)}
    root = _repo_root(folder)
    if not root:
        return {"path": folder, "is_repo": False}
    code, out, err = _git(root, "status", "--porcelain=v2", "--branch", "-z", "--untracked-files=normal")
    if code:
        return {"path": folder, "is_repo": True, "root": root, "error": err or "git status failed"}
    info = _parse_status_v2(out)
    insertions, deletions = _line_counts(root, has_head=info["head"] is not None)
    common = _git(root, "rev-parse", "--path-format=absolute", "--git-common-dir")[1].strip()
    repo_dir = str(Path(common).parent) if common.endswith("/.git") else root
    worktrees = _worktrees(root)
    status: dict[str, Any] = {
        "path": folder,
        "is_repo": True,
        "root": root,
        "repo": repo_dir,
        "repo_name": Path(repo_dir).name,
        "branch": info["branch"],
        "head": info["head"],
        "upstream": info["upstream"],
        "ahead": info["ahead"],
        "behind": info["behind"],
        "changes": {
            "files": info["files"],
            "untracked": info["untracked"],
            "conflicts": info["conflicts"],
            "insertions": insertions,
            "deletions": deletions,
        },
        "is_worktree": any(w["is_current"] and not w["is_main"] for w in worktrees),
        "worktrees": worktrees,
        "default_branch": _default_branch(root),
        "has_remote": _has_remote(root),
        "gh_available": shutil.which("gh") is not None,
    }
    if include_branches:
        status["branches"] = _branches(root)
    if include_pr and info["branch"] and status["has_remote"]:
        status["pr"] = _open_pr(root, info["branch"])
    return status


def _check_branch_name(root: str, branch: object) -> str:
    if not isinstance(branch, str) or not branch.strip() or branch.strip().startswith("-"):
        raise FolderGitError("a branch name is required")
    name = branch.strip()
    if _git(root, "check-ref-format", "--branch", name)[0]:
        raise FolderGitError(f"{name!r} is not a valid branch name")
    return name


def _require_repo(path: object) -> str:
    folder = _folder(path)
    root = _repo_root(folder)
    if not root:
        raise FolderGitError("the folder is not inside a Git repository")
    return root


def switch_branch(path: object, branch: object, *, create: bool = False) -> dict[str, Any]:
    """Check out ``branch`` in place (``create`` makes it from HEAD)."""
    root = _require_repo(path)
    name = _check_branch_name(root, branch)
    _git_ok(root, "switch", *(["-c"] if create else []), name, timeout=60)
    return folder_status(path, include_branches=True)


def default_worktree_path(root: str, branch: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9._-]+", "-", branch).strip("-.") or "worktree"
    source = Path(root)
    return str(source.parent / f"{source.name}-worktrees" / slug)


def create_worktree(path: object, branch: object) -> dict[str, Any]:
    """Add a worktree for ``branch`` (new from HEAD if it doesn't exist).

    The folder lands next to the repository, never inside it, so the
    source checkout's files and uncommitted changes stay where they are.
    Returns the new folder's status.
    """
    root = _require_repo(path)
    name = _check_branch_name(root, branch)
    for row in _worktrees(root):
        if row.get("branch") == name:
            raise FolderGitError(f"branch {name!r} is already checked out at {row['path']}")
    target = Path(default_worktree_path(root, name))
    with _worktree_lock:
        if target.exists():
            raise FolderGitError(f"{target} already exists")
        target.parent.mkdir(parents=True, exist_ok=True)
        exists = _git(root, "show-ref", "--verify", "--quiet", f"refs/heads/{name}")[0] == 0
        if exists:
            _git_ok(root, "worktree", "add", "--", str(target), name, timeout=120)
        else:
            _git_ok(root, "worktree", "add", "-b", name, "--", str(target), "HEAD", timeout=120)
    return folder_status(str(target))


def create_pull_request(path: object, *, base: object = None) -> dict[str, Any]:
    """Push the current branch and open a pull request for it.

    Only committed work is included; the PR title and body come from the
    commits (``gh pr create --fill``). Returns ``{"url", "number"?}``.
    """
    root = _require_repo(path)
    gh = shutil.which("gh")
    if not gh:
        raise FolderGitError("the GitHub CLI (gh) is not installed")
    status = folder_status(root, include_pr=True)
    branch = status.get("branch")
    if not branch:
        raise FolderGitError("check out a branch first; HEAD is detached")
    if status.get("pr") and str(status["pr"].get("state", "")).upper() == "OPEN":
        return {"url": status["pr"]["url"], "number": status["pr"].get("number"), "existing": True}
    if not status.get("has_remote"):
        raise FolderGitError("this repository has no 'origin' remote")
    target = base.strip() if isinstance(base, str) and base.strip() else status.get("default_branch")
    if not target:
        raise FolderGitError("couldn't determine the base branch")
    if branch == target:
        raise FolderGitError(f"you're on {target}; switch to a feature branch first")
    code, out, _ = _git(root, "rev-list", "--count", f"origin/{target}..HEAD")
    if code == 0 and out.strip() == "0":
        raise FolderGitError(f"no commits ahead of {target}; commit your changes first")
    _git_ok(root, "push", "-u", "origin", "HEAD", timeout=_NETWORK_TIMEOUT)
    try:
        proc = subprocess.run(
            [gh, "pr", "create", "--fill", "--head", branch, "--base", target],
            cwd=root, capture_output=True, text=True, timeout=_NETWORK_TIMEOUT, env=_env(),
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise FolderGitError(str(exc)) from exc
    if proc.returncode:
        raise FolderGitError(proc.stderr.strip() or "gh pr create failed")
    urls = re.findall(r"https?://\S+", proc.stdout)
    if not urls:
        raise FolderGitError("gh did not report the pull request URL")
    url = urls[-1]
    m = re.search(r"/pull/(\d+)", url)
    return {"url": url, "number": int(m.group(1)) if m else None, "existing": False}
