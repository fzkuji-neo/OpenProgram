"""Registered memory writes reject discarded prose without committing a batch."""
from __future__ import annotations

import asyncio
import json
import subprocess

import pytest

SOURCE = '# Conversation 1\n\n<a id="d1-1"></a>\n\nuser: remember this\n'
NOTE = (
    "# Note\n\nA fact worth keeping.[^e-1f4c7a2b90] ^abc12345\n\n"
    "[^e-1f4c7a2b90]: Time: `2026-01-01`; Sources: [D1:1](../sources/D1.md#d1-1)\n"
)
PLAIN = "# Unsupported\n\nUncited substantive prose.\n"


def _invoke(name, args):
    from openprogram.programs import get_agent_tool

    result = asyncio.run(get_agent_tool(name).execute("owned-write", args, None, None))
    text = "\n".join(block.text for block in result.content)
    if name == "memory_get":
        assert not result.is_error, result.content
        return text
    payload = json.loads(text)
    # A rejected call reaches the agent loop as a failed tool result.
    assert result.is_error is (payload.get("ok") is False), result.content
    return payload


def _snapshot(root):
    from openprogram.memory.management.transaction import workspace_revision

    return {
        "bytes": {
            path.relative_to(root).as_posix(): path.read_bytes()
            for path in root.rglob("*")
            if path.is_file() and ".git" not in path.relative_to(root).parts
        },
        "revision": workspace_revision(root),
        "git_head": subprocess.check_output(
            ["git", "-C", str(root), "rev-parse", "HEAD"], text=True,
        ).strip(),
    }


@pytest.fixture
def owned_memory(tmp_path, monkeypatch):
    import openprogram.paths as paths
    from openprogram.agent import authority, run_control, session_db
    from openprogram import store as chat_store
    from openprogram.memory import store
    from openprogram.programs.tools.knowledge.memory import memory as tools

    monkeypatch.setattr(paths, "get_state_dir", lambda: tmp_path / "state")
    authority._reset_owner_cache_for_tests()
    root = store.ensure()
    (root / "sources/D1.md").write_text(SOURCE)
    (root / "topics/note.md").write_text(NOTE)
    store._ensure_git_history(root)
    db = session_db.SessionDB(tmp_path / "owned-sessions")
    db.create_session("owned", "main")
    db.append_message("owned", {
        "id": "owned-user", "role": "user", "content": "Edit owned memory",
        "timestamp": 0, **authority.local_owner_authority(),
    })
    monkeypatch.setattr(session_db, "default_db", lambda: db)
    monkeypatch.setattr(tools, "_root", lambda: root)
    session_token = run_control._current_session_id.set("owned")
    turn_token = chat_store._current_turn_id.set("owned-user")
    try:
        yield root
    finally:
        chat_store._current_turn_id.reset(turn_token)
        run_control._current_session_id.reset(session_token)
        db.close()
        authority._reset_owner_cache_for_tests()


@pytest.mark.parametrize("entry", ["changes", "patch"])
def test_registered_plain_write_rejected_without_committed_mutation(owned_memory, entry):
    root = owned_memory
    before = _snapshot(root)
    args = {"base_revision": before["revision"]}
    if entry == "changes":
        args[entry] = [{"path": "topics/plain.md", "action": "write", "content": PLAIN}]
    else:
        args[entry] = "--- /dev/null\n+++ b/topics/plain.md\n@@ -0,0 +1,3 @@\n+# Unsupported\n+\n+Uncited substantive prose.\n"
    result = _invoke("memory_update", args)
    assert result.get("ok") is False, result
    assert result["error"]["code"] == "INVALID_TOPIC_FORMAT"
    assert _snapshot(root) == before
    assert not (root / "topics/plain.md").exists()
    assert "worth keeping" in _invoke("memory_get", {"path": "topics/note.md"})


@pytest.mark.parametrize("entry", ["changes", "patch"])
def test_registered_invalid_batch_does_not_install_new_source_or_valid_edit(owned_memory, entry):
    root = owned_memory
    before = _snapshot(root)
    valid = (
        "# New\n\nSupported new fact.[^e1]\n\n"
        "[^e1]: Time: `2026-10-03`; Sources: new-source-owned\n"
    )
    args = {
        "base_revision": before["revision"],
        "sources": [{"label": "new-source-owned", "role": "user", "content": "Supported new fact.", "observed_at": "2026-10-03"}],
    }
    if entry == "changes":
        args[entry] = [
            {"path": "topics/note.md", "action": "write", "content": NOTE.replace("keeping", "updating")},
            {"path": "topics/new.md", "action": "write", "content": valid},
            {"path": "topics/plain.md", "action": "write", "content": PLAIN},
        ]
    else:
        args[entry] = (
            "--- a/topics/note.md\n+++ b/topics/note.md\n@@ -3,1 +3,1 @@\n"
            "-A fact worth keeping.[^e-1f4c7a2b90] ^abc12345\n"
            "+A fact worth updating.[^e-1f4c7a2b90] ^abc12345\n"
            "--- /dev/null\n+++ b/topics/new.md\n@@ -0,0 +1,5 @@\n"
            + "".join("+" + line + "\n" for line in valid.splitlines())
            + "--- /dev/null\n+++ b/topics/plain.md\n@@ -0,0 +1,3 @@\n"
            + "".join("+" + line + "\n" for line in PLAIN.splitlines())
        )
    result = _invoke("memory_update", args)
    assert result.get("ok") is False, result
    assert result["error"]["code"] == "INVALID_TOPIC_FORMAT"
    assert _snapshot(root) == before


@pytest.mark.parametrize("content", ["", " \n\t\n", "# Empty topic\n\n## Empty section\n"])
def test_registered_truly_empty_topic_remains_allowed(owned_memory, content):
    root = owned_memory
    before = _snapshot(root)
    result = _invoke("memory_update", {
        "base_revision": before["revision"],
        "changes": [{"path": "topics/empty.md", "action": "write", "content": content}],
    })
    assert result["ok"] is True
    assert not (root / "topics/empty.md").exists()
    assert (root / "topics/note.md").read_text() == NOTE


@pytest.mark.parametrize("callback_fails", [False, True])
def test_staged_edit_trusted_callback_runs_before_install(owned_memory, callback_fails):
    from openprogram.memory.management.transaction import staged_edit

    root = owned_memory
    before = _snapshot(root)
    calls = []

    def before_install():
        calls.append(_snapshot(root))
        assert not (root / ".scriptorium-block-backup").exists()
        if callback_fails:
            raise RuntimeError("owned callback failure")

    ok, _message = staged_edit(
        root, lambda stage: (stage / "topics/note.md").write_text(NOTE.replace("keeping", "updating")),
        before_install=before_install,
    )
    assert calls == [before]
    assert ok is not callback_fails
    if callback_fails:
        assert _snapshot(root) == before
    else:
        assert "worth updating" in (root / "topics/note.md").read_text()


def test_validation_rejection_does_not_call_trusted_callback(owned_memory):
    from openprogram.memory.management.transaction import staged_edit

    root = owned_memory
    before = _snapshot(root)
    calls = []
    ok, _message = staged_edit(
        root, lambda stage: (stage / "topics/plain.md").write_text(PLAIN),
        before_install=lambda: calls.append("must not run"),
    )
    assert not ok
    assert calls == []
    assert _snapshot(root) == before
