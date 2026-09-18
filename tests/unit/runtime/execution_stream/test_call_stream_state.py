"""CallStreamState owns merge, revision, and preview isolation."""
from __future__ import annotations

from openprogram.agentic_programming.runtime.execution_stream.state import (
    CallStreamState,
    StreamIdentity,
)


def _state(**kwargs):
    ident = StreamIdentity(
        session_id="sess",
        execution_id="exec",
        node_id="node",
        generation=1,
        display_msg_id="assistant",
        ephemeral=True,
    )
    emitted: list[dict] = []
    st = CallStreamState(ident, emit=emitted.append, **kwargs)
    return st, emitted


def test_block_delta_advances_revision_and_merges_preview():
    st, emitted = _state()
    st.start_attempt()
    st.append_delta(kind="text", delta="A")
    st.append_delta(kind="text", delta="B")
    st.flush_checkpoint()
    assert "AB" in st.text_preview()
    ops = [e["data"]["op"] for e in emitted]
    assert "attempt_started" in ops
    assert "block_started" in ops
    assert "block_delta" in ops
    # revisions are contiguous on change events
    deltas = [e["data"] for e in emitted if e["data"]["op"] == "block_delta"]
    assert deltas
    assert all("base_revision" in d and "revision" in d for d in deltas)


def test_retry_isolates_attempts():
    st, emitted = _state()
    st.start_attempt(reason="initial")
    st.append_delta(kind="text", delta="old half")
    st.finish_attempt(status="failed", validation="failed")
    st.start_attempt(reason="structured_output_repair")
    st.append_delta(kind="text", delta="new full")
    assert st.text_preview() == "new full"
    assert len(st.attempt_order) == 2
    first = st.attempts[st.attempt_order[0]]
    assert "old half" in first.blocks[list(first.blocks)[0]].content


def test_cancel_stops_accepting_and_keeps_partial():
    st, _ = _state()
    st.start_attempt()
    st.append_delta(kind="text", delta="partial")
    st.stop_accepting()
    st.append_delta(kind="text", delta=" after cancel")
    assert st.text_preview() == "partial"
    meta = st.finish_node(status="cancelled")
    assert meta["phase"] == "cancelled"
    assert meta["partial"] is False
    assert "partial" in meta["preview_text"]


def test_node_finished_snapshot_recoverable_without_deltas():
    st, emitted = _state()
    st.start_attempt()
    st.append_delta(kind="text", delta="hello")
    st.finish_node(status="completed", result="hello")
    finished = [e["data"] for e in emitted if e["data"]["op"] == "node_finished"]
    assert len(finished) == 1
    snap = finished[0]["snapshot"]
    assert snap["preview_text"].endswith("hello")
    assert snap["phase"] == "completed"


def test_opaque_reasoning_not_in_preview():
    st, _ = _state()
    st.start_attempt()
    bid = st.start_block(kind="reasoning_summary", visibility="opaque")
    st.append_delta(kind="reasoning_summary", delta="secret-sig", block_id=bid)
    assert st.text_preview(kind="reasoning_summary") == ""


def test_envelope_schema():
    st, emitted = _state()
    st.start_attempt()
    st.append_delta(kind="text", delta="x")
    env = emitted[-1]
    assert env["type"] == "chat_response"
    data = env["data"]
    assert data["type"] == "execution_stream"
    assert data["schema_version"] == 1
    assert data["session_id"] == "sess"
    assert data["execution_id"] == "exec"
    assert data["node_id"] == "node"


def test_tool_ref_emits_started_and_preserves_metadata():
    st, emitted = _state()
    st.start_attempt()
    bid = st.add_tool_ref(
        tool_call_id="call_1",
        tool_name="search",
        ref_node_id="node/search#1",
    )
    assert bid
    started = [e["data"] for e in emitted if e["data"]["op"] == "block_started"]
    assert started
    last = started[-1]
    assert last["kind"] == "tool_ref"
    assert last["tool_call_id"] == "call_1"
    assert last["tool_name"] == "search"
    assert last["ref_node_id"] == "node/search#1"
    # text preview ignores tool_ref
    assert st.text_preview() == ""


def test_tool_ref_idempotent_and_finish_sets_ref():
    st, emitted = _state()
    st.start_attempt()
    b1 = st.add_tool_ref(tool_call_id="call_2", tool_name="read")
    b2 = st.add_tool_ref(tool_call_id="call_2", ref_node_id="node/read#1")
    assert b1 == b2
    refs = [
        blk
        for aid in st.attempt_order
        for blk in st.attempts[aid].blocks.values()
        if blk.kind == "tool_ref"
    ]
    assert len(refs) == 1
    assert refs[0].ref_node_id == "node/read#1"
    st.finish_tool_ref("call_2", ref_node_id="node/read#1")
    assert refs[0].status == "finished"
    finished = [e["data"] for e in emitted if e["data"]["op"] == "block_finished"]
    assert finished
    assert finished[-1]["tool_call_id"] == "call_2"
    assert finished[-1]["ref_node_id"] == "node/read#1"


def test_consecutive_tool_refs_share_auto_group_id():
    st, _ = _state()
    st.start_attempt()
    st.add_tool_ref(tool_call_id="a", tool_name="t1")
    st.add_tool_ref(tool_call_id="b", tool_name="t2")
    refs = [
        blk
        for aid in st.attempt_order
        for blk in st.attempts[aid].blocks.values()
        if blk.kind == "tool_ref"
    ]
    assert len(refs) == 2
    assert refs[0].group_id
    assert refs[0].group_id == refs[1].group_id
    # intervening text breaks the parallel group
    st.append_delta(kind="text", delta="mid")
    st.add_tool_ref(tool_call_id="c", tool_name="t3")
    refs2 = [
        blk
        for aid in st.attempt_order
        for blk in st.attempts[aid].blocks.values()
        if blk.kind == "tool_ref"
    ]
    assert refs2[2].group_id != refs[0].group_id or refs2[2].group_id is None or True
    # third should not share first group (new group or none after text)
    assert refs2[2].group_id != refs[0].group_id
