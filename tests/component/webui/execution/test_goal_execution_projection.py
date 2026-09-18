"""Persisted Goal execution nodes expose their actual prompt and reply."""
import json

import pytest

from openprogram.context.nodes import Call, ROLE_CODE, ROLE_LLM
from openprogram.store import SessionNodeWriter, SessionStore
from openprogram.webui._exec_dag import build_exec_dag_by_id


@pytest.mark.parametrize("reply", ["验收完成", [{"type": "text", "text": "完成"}], ""])
def test_goal_tree_restores_llm_prompt_and_output(tmp_path, monkeypatch, reply):
    store = SessionStore(tmp_path / "sessions")
    store.create_session("goal-test", "main")
    writer = SessionNodeWriter(store, "goal-test")
    root = Call(role=ROLE_CODE, name="goal", input={"prompt": "Write review"}, output="done")
    writer.append(root)
    writer.append(Call(role=ROLE_LLM, name="test-model", caller=root.id,
        input={"system": "system text"}, output=reply,
        metadata={"prompt_text": "Verify the article", "status": "completed"}))
    monkeypatch.setattr("openprogram.agent.session_db.default_db", lambda: store)
    tree = build_exec_dag_by_id("goal-test", root.id)
    node = tree["children"][0]
    expected = reply if isinstance(reply, str) else json.dumps(reply, ensure_ascii=False)
    assert node["params"]["_content"] == "Verify the article"
    assert node["params"]["system"] == "system text"
    assert node["output"] == expected
    assert node["raw_reply"] == expected
    assert tree["params"]["prompt"] == "Write review"
    assert store.get_nodes("goal-test")[-1].output == reply


def test_legacy_llm_input_remains_visible(tmp_path, monkeypatch):
    store = SessionStore(tmp_path / "sessions")
    store.create_session("legacy", "main")
    writer = SessionNodeWriter(store, "legacy")
    node = Call(role=ROLE_LLM, input="Legacy prompt", output="Legacy reply")
    writer.append(node)
    monkeypatch.setattr("openprogram.agent.session_db.default_db", lambda: store)
    tree = build_exec_dag_by_id("legacy", node.id)
    assert tree["params"]["_content"] == "Legacy prompt"
    assert tree["output"] == "Legacy reply"


def test_tree_projection_restores_ordered_stream_snapshot_and_tool_child(
    tmp_path, monkeypatch,
):
    """History/DAG projection carries the same ordered content after owner loss."""
    store = SessionStore(tmp_path / "sessions")
    store.create_session("stream-recovery", "main")
    writer = SessionNodeWriter(store, "stream-recovery")
    root = Call(role=ROLE_CODE, name="workflow", output="done")
    writer.append(root)
    llm = Call(
        role=ROLE_LLM,
        name="test-model",
        caller=root.id,
        input={"prompt": "nested"},
        output="Before tools\nAfter tools",
        metadata={
            "status": "completed",
            "stream": {
                "generation": 3,
                "revision": 8,
                "phase": "completed",
                "snapshot": {
                    "generation": 3,
                    "revision": 8,
                    "phase": "completed",
                    "attempts": [{
                        "attempt_id": "attempt-0",
                        "attempt_index": 0,
                        "status": "completed",
                        "blocks": [
                            {"block_id": "before", "block_index": 0,
                             "kind": "text", "content": "Before tools",
                             "status": "finished"},
                            {"block_id": "tool", "block_index": 1,
                             "kind": "tool_ref", "tool_call_id": "call-1",
                             "ref_node_id": "tool-node", "tool_name": "read_file",
                             "status": "finished"},
                            {"block_id": "after", "block_index": 2,
                             "kind": "text", "content": "After tools",
                             "status": "finished"},
                        ],
                    }],
                },
            },
        },
    )
    writer.append(llm)
    tool = Call(
        id="tool-node",
        role=ROLE_CODE,
        name="read_file",
        caller=llm.id,
        input={"path": "missing"},
        output="permission denied",
        metadata={
            "tool_call_id": "call-1",
            "status": "error",
            "error": "permission denied",
        },
    )
    writer.append(tool)
    monkeypatch.setattr("openprogram.agent.session_db.default_db", lambda: store)
    tree = build_exec_dag_by_id("stream-recovery", root.id)
    nested = tree["children"][0]
    blocks = nested["stream_attempts"][0]["blocks"]
    assert [block["kind"] for block in blocks] == ["text", "tool_ref", "text"]
    assert blocks[1]["ref_node_id"] == tool.id
    assert nested["children"][0]["status"] == "error"
    assert nested["children"][0]["error"] == "permission denied"


def test_nested_tool_event_maps_call_id_to_one_durable_dag_node(tmp_path):
    from openprogram.agentic_programming.runtime.history import HistoryOperations
    from openprogram.agentic_programming.function import tool_node_id
    from openprogram.store import _store as store_var

    store = SessionStore(tmp_path / "sessions")
    store.create_session("tool-map", "main")
    writer = SessionNodeWriter(store, "tool-map")
    parent = Call(id="llm-parent", role=ROLE_LLM, output="", metadata={"status": "running"})
    writer.append(parent)
    token = store_var.set(writer)
    try:
        ops = HistoryOperations()
        node_id = ops._ensure_nested_tool_node(
            parent_node_id=parent.id,
            tool_call_id="call-1",
            occurrence_id="occ-round-1",
            tool_name="read_file",
            arguments={"path": "a.txt"},
        )
        assert node_id == tool_node_id(parent.id, "occ-round-1")
        assert ops._ensure_nested_tool_node(
            parent_node_id=parent.id,
            tool_call_id="call-1",
            occurrence_id="occ-round-1",
            tool_name="read_file",
            arguments={"path": "a.txt"},
        ) == node_id
        second_id = ops._ensure_nested_tool_node(
            parent_node_id=parent.id,
            tool_call_id="call-1",
            occurrence_id="occ-round-2",
            tool_name="read_file",
            arguments={"path": "b.txt"},
        )
        assert second_id != node_id
        ops._finish_nested_tool_node(
            parent_node_id=parent.id,
            tool_call_id="call-1",
            occurrence_id="occ-round-1",
            node_id=node_id,
            result="ok",
        )
    finally:
        store_var.reset(token)
    child = writer.load().nodes[node_id]
    assert child.caller == parent.id
    assert child.output == "ok"
    assert child.metadata["tool_call_id"] == "call-1"
    assert child.metadata["tool_call_occurrence_id"] == "occ-round-1"
    assert child.metadata["status"] == "completed"


def test_nested_agentic_siblings_consume_outer_tool_identity(tmp_path):
    """Repeated direct subcalls get separate DAG nodes under one tool call."""
    from openprogram.agentic_programming.function import agentic_function
    from openprogram.agentic_programming.function import _call_id
    from openprogram.programs._runtime import (
        _current_tool_call_id,
        _current_tool_call_occurrence_id,
        _tool_call_identity_consumed,
    )
    from openprogram.store import _store as store_var

    store = SessionStore(tmp_path / "sessions-siblings")
    store.create_session("siblings", "main")
    writer = SessionNodeWriter(store, "siblings")
    parent = Call(id="llm-parent", role=ROLE_LLM, output="", metadata={"status": "running"})
    writer.append(parent)

    @agentic_function(expose="full", as_tool=False)
    def child(value):
        return value

    @agentic_function(expose="full", as_tool=False)
    def outer():
        return [child("first"), child("second")]

    store_token = store_var.set(writer)
    caller_token = _call_id.set(parent.id)
    raw_token = _current_tool_call_id.set("call-1")
    occurrence_token = _current_tool_call_occurrence_id.set("occ-round-1")
    consumed_token = _tool_call_identity_consumed.set(False)
    try:
        assert outer() == ["first", "second"]
    finally:
        _tool_call_identity_consumed.reset(consumed_token)
        _current_tool_call_occurrence_id.reset(occurrence_token)
        _current_tool_call_id.reset(raw_token)
        _call_id.reset(caller_token)
        store_var.reset(store_token)

    children = [n for n in writer.load().nodes.values() if n.function_name == "child"]
    assert len(children) == 2
    assert len({n.id for n in children}) == 2
    assert all(n.caller != "" for n in children)


def test_hidden_nested_tool_does_not_precreate_or_persist_payload(tmp_path):
    from openprogram.agentic_programming.runtime.history import HistoryOperations
    from openprogram.store import _store as store_var

    store = SessionStore(tmp_path / "sessions-hidden")
    store.create_session("hidden", "main")
    writer = SessionNodeWriter(store, "hidden")
    parent = Call(id="llm-hidden", role=ROLE_LLM, output="", metadata={"status": "running"})
    writer.append(parent)
    token = store_var.set(writer)
    try:
        ref = HistoryOperations()._ensure_nested_tool_node(
            parent_node_id=parent.id,
            tool_call_id="secret-call",
            occurrence_id="occ-secret",
            tool_name="secret_tool",
            arguments={"secret": "do-not-persist"},
            expose="hidden",
        )
    finally:
        store_var.reset(token)
    assert ref == ""
    assert all(n.name != "secret_tool" for n in writer.load().nodes.values())
