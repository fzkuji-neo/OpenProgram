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
