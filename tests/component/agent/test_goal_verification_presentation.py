from types import SimpleNamespace

from tests.component.agent.test_chat_goal import runtime  # noqa: F401


def test_event_identity_is_exact_and_does_not_rewrite_content():
    from openprogram.programs.workflow.goal.presentation import event_sink
    output = []
    req = SimpleNamespace(goal_verification="candidate", session_id="s", user_msg_id="u")
    emit = event_sink(output.append, req)
    raw = {"type": "chat_response", "data": {"type": "stream_event", "session_id": "s", "msg_id": "u", "event": {"type": "text", "text": '{"requirements":'}}}
    emit(raw)
    assert output[-1]["data"]["goal_verification"] == {"id": "candidate", "status": "pending"}
    assert output[-1]["data"]["event"] == raw["data"]["event"]
    assert "goal_verification" not in raw["data"]
    for sid, mid, kind in [("other", "u", "stream_event"), ("s", "other", "stream_event"), ("s", "u", "user_message")]:
        emit({"type": "chat_response", "data": {"type": kind, "session_id": sid, "msg_id": mid}})
        assert "goal_verification" not in output[-1]["data"]


def test_history_requires_canonical_identity_not_json_shape(runtime):
    from openprogram.programs.workflow.goal.presentation import annotate_messages
    rows = [{"id": "ordinary", "role": "assistant", "content": '{"requirements":[{"verdict":"met"}]}'}]
    assert annotate_messages("goal-chat", rows) == rows


def test_malformed_report_stays_unmet_and_display_safe():
    from openprogram.programs.workflow.goal.presentation import candidate_presentation
    for report in [[], "bad", {"requirements": "bad"}, {"requirements": [None, "bad"]}]:
        projected = candidate_presentation({"id": "c", "status": "unmet", "report": report})
        assert projected["status"] == "unmet"
        assert projected["requirements"] == []


def test_rejected_report_has_only_renderable_fields():
    from openprogram.programs.workflow.goal.presentation import candidate_presentation
    value = candidate_presentation({"id": "c", "status": "unmet", "report": {
        "requirements": [{"id": [], "reason": {}}, {"id": "objective", "verdict": {}, "reason": {}, "evidence": [None, {}, "message:a"]}],
    }})
    assert value["requirements"] == [{"id": "objective", "text": "objective", "verdict": "unknown", "reason": "", "evidence": ["message:a"]}]
