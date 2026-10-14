"""Unit tests for the todo planning board tool family.

All calls go through the _impl functions (the @function binding object
is not callable) with storage redirected to a tmp path. No LLM requests.
"""
from __future__ import annotations

import json

import pytest

from openprogram.programs.tools.planning.todo import shared
from openprogram.programs.tools.planning.todo.todo_create.todo_create import _todo_create_impl
from openprogram.programs.tools.planning.todo.todo_list.todo_list import _todo_list_impl
from openprogram.programs.tools.planning.todo.todo_update.todo_update import _todo_update_impl


@pytest.fixture
def board(monkeypatch, tmp_path):
    """Session context + todos.json redirected to a tmp file."""
    monkeypatch.setattr(shared, "current_session_id", lambda: "sess1")
    monkeypatch.setattr(shared, "todos_path", lambda sid: tmp_path / "todos.json")
    return tmp_path / "todos.json"


def test_create_returns_id_and_persists(board):
    out = _todo_create_impl("write tests", "cover the board")
    assert out == "Todo #1 created: write tests"
    blob = json.loads(board.read_text())
    (entry,) = blob["todos"]
    assert entry["subject"] == "write tests"
    assert entry["description"] == "cover the board"
    assert entry["status"] == "pending"
    assert entry["blocked_by"] == []
    assert entry["created_at"] == entry["updated_at"]


def test_create_ids_increment(board):
    _todo_create_impl("a")
    out = _todo_create_impl("b")
    assert "#2" in out


def test_create_requires_subject(board):
    assert "subject required" in _todo_create_impl("  ")


def test_create_rejects_unknown_blocked_by(board):
    _todo_create_impl("a")
    out = _todo_create_impl("b", blocked_by="1, 9")
    assert "unknown todo id(s): 9" in out


def test_update_fields_and_status(board):
    _todo_create_impl("a")
    out = _todo_update_impl("1", status="in_progress", owner="claude")
    assert out == "Todo #1 updated (status, owner)"
    (entry,) = json.loads(board.read_text())["todos"]
    assert entry["status"] == "in_progress"
    assert entry["owner"] == "claude"


def test_update_rejects_bad_status(board):
    _todo_create_impl("a")
    assert "invalid status" in _todo_update_impl("1", status="done")


def test_update_unknown_id(board):
    assert "unknown todo_id" in _todo_update_impl("42")


def test_update_no_changes(board):
    _todo_create_impl("a")
    assert "unchanged" in _todo_update_impl("1")


def test_list_empty(board):
    assert _todo_list_impl() == "(no todos in this session)"


def test_list_groups_and_annotations(board):
    _todo_create_impl("first")
    _todo_create_impl("second", blocked_by="1")
    _todo_create_impl("third")
    _todo_update_impl("1", status="completed")
    _todo_update_impl("3", status="in_progress", owner="claude")
    out = _todo_list_impl()
    lines = out.splitlines()
    assert lines[0] == "in_progress:"
    assert lines[1] == "- #3 third  (owner: claude)"
    assert lines[2] == "pending:"
    assert lines[3] == "- #2 second  (blocked by #1)"
    assert lines[4] == "completed:"
    assert lines[5] == "- #1 first"


def test_no_session_context(monkeypatch):
    monkeypatch.setattr(shared, "current_session_id", lambda: None)
    assert "no active session context" in _todo_create_impl("a")
    assert "no active session context" in _todo_update_impl("1")
    assert "no active session context" in _todo_list_impl()


def test_saved_board_is_pushed_to_the_ui(board, monkeypatch):
    frames = []
    monkeypatch.setattr(shared, "publish", lambda sid, todos: frames.append((sid, [dict(t) for t in todos])))
    _todo_create_impl("a")
    _todo_update_impl("1", status="in_progress")
    _todo_update_impl("1")  # no change → nothing to push
    assert [(sid, [(t["id"], t["status"]) for t in todos]) for sid, todos in frames] == [
        ("sess1", [("1", "pending")]),
        ("sess1", [("1", "in_progress")]),
    ]


def test_publish_without_a_server_is_quiet(monkeypatch):
    import sys
    monkeypatch.setitem(sys.modules, "openprogram.webui.server", None)
    shared.publish("sess1", [{"id": "1"}])
