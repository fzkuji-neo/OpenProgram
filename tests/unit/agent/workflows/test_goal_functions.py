"""Unit tests for the goal workflow (``openprogram/programs/workflow/goal/``):
the ``judge`` and ``refiner`` role requests, JSON parse path, failure path. The loop
semantics around it live in test_goal_loop.py."""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from openprogram.testing import script_roles

import openprogram.programs.workflow.goal.judge as GJ
import openprogram.programs.workflow.goal.refinement as GR


@pytest.fixture(autouse=True)
def no_configured_judge_model(monkeypatch):
    monkeypatch.setattr("openprogram.programs.workflow.goal.judge_model", lambda: "")


@pytest.fixture
def stub_view(monkeypatch):
    monkeypatch.setattr(GJ, "render_session_view", lambda sid, **k: "VIEW")


# ---------------------------------------------------------------------------
# Reply parsing
# ---------------------------------------------------------------------------

def test_parse_decision_fenced_json() -> None:
    ok = GJ._parse_decision(
        '```json\n{"met": false, "reason": "missing"}\n```')
    assert ok == {"verdict": "unmet", "met": False, "reason": "missing",
                  "need_user": False, "question": "", "options": [],
                  "can_continue": False, "checklist": None}


def test_parse_decision_invalid_raises() -> None:
    with pytest.raises(ValueError):
        GJ._parse_decision("no braces here")
    with pytest.raises(ValueError):
        GJ._parse_decision('{"met": "yes"}')  # met must be bool


def test_judge_has_read_only_web_tools_for_source_verification() -> None:
    assert {"web_fetch", "web_search"} <= set(GJ.DECISION_TOOLS)
    assert not {"write", "edit", "ask_user_question", "agent"} & set(GJ.DECISION_TOOLS)


def test_failed_inspection_receipt_cannot_confirm_completion() -> None:
    failed = [{"type": "tool", "tool": "bash", "is_error": True}]
    with pytest.raises(ValueError, match="failed inspection tools: bash"):
        GJ._check_inspection_errors('{"met":true,"reason":"memory says valid"}', failed)
    blocked = '{"verdict":"blocked","reason":"network unavailable"}'
    assert GJ._check_inspection_errors(blocked, failed) == blocked
    completed = '{"met":true,"reason":"verified"}'
    assert GJ._check_inspection_errors(completed, [
        {"type": "tool", "tool": "read", "is_error": False},
    ]) == completed


def test_judge_rejects_met_with_actual_turn_error_receipts(monkeypatch) -> None:
    from openprogram.agentic_programming.call_state import _current_runtime
    blocks = [{"type": "tool", "tool": "bash", "is_error": True}]
    token = _current_runtime.set(SimpleNamespace(last_blocks=blocks))
    try:
        with script_roles({GJ.judge: ['{"met":true,"reason":"done"}']}):
            with pytest.raises(ValueError, match="failed inspection tools"):
                GJ.judge_goal("verify sources", session_id="s1", session_view="evidence")
    finally:
        _current_runtime.reset(token)


def test_parse_decision_checklist_cleaning() -> None:
    # Equal-length pure-bool list passes through.
    ok = GJ._parse_decision(
        '{"met": false, "reason": "r", "checklist": [true, false, true]}',
        checklist_len=3)
    assert ok["checklist"] == [True, False, True]
    invalid = [
        '{"met": false, "reason": "r", "checklist": [true]}',
        '{"met": false, "reason": "r"}',
        '{"met": false, "reason": "r", "checklist": [true, "yes", 1]}',
    ]
    for reply in invalid:
        with pytest.raises(ValueError, match='complete current checklist'):
            GJ._parse_decision(reply, checklist_len=3)
    # No checklist expected → always None, even when the judge invents one.
    invented = GJ._parse_decision(
        '{"met": false, "reason": "r", "checklist": [true]}')
    assert invented["checklist"] is None


# ---------------------------------------------------------------------------
# The decision entry
# ---------------------------------------------------------------------------

def test_goal_decision_parses_and_forwards(stub_view) -> None:
    with script_roles({GJ.judge: ['prose before {"met": true, "reason": "done", '
                                  '"need_user": false, "question": ""} after']}) as calls:
        out = GJ.judge_goal(goal="MY-GOAL", session_id="s1")
    assert out == {"verdict": "met", "met": True, "reason": "done",
                   "need_user": False, "question": "", "options": [],
                   "can_continue": False, "checklist": None}
    request = calls[GJ.judge][0]
    assert "completion judge" in request.text          # judge_goal docstring
    assert "goal:\nMY-GOAL" in request.text
    assert "session context:\nVIEW" in request.text
    assert request.history_text == ""


def test_goal_decision_optional_fields_default(stub_view) -> None:
    # Replies without need_user/question stay valid.
    with script_roles({GJ.judge: ['{"met": false, "reason": "not yet"}']}):
        out = GJ.judge_goal(goal="g", session_id="s1")
    assert out == {"verdict": "unmet", "met": False, "reason": "not yet",
                   "need_user": False, "question": "", "options": [],
                   "can_continue": False, "checklist": None}


def test_goal_decision_checklist_in_request_and_reply(stub_view) -> None:
    replies = ['{"met": false, "reason": "r", "checklist": [true, false]}',
               '{"met": false, "reason": "r"}']
    with script_roles({GJ.judge: replies}) as calls:
        out = GJ.judge_goal(goal="g", session_id="s1", checklist=["item A", "item B"])
        GJ.judge_goal(goal="g", session_id="s1")
    assert "checklist:\n1. item A\n2. item B" in calls[GJ.judge][0].text
    assert out["checklist"] == [True, False]
    assert "checklist:\n1." not in calls[GJ.judge][1].text


def test_goal_decision_invalid_reply_raises(stub_view) -> None:
    with script_roles({GJ.judge: ["no json here"]}):
        with pytest.raises(ValueError):
            GJ.judge_goal(goal="g", session_id="s1")


def test_goal_decision_turn_failure_propagates(stub_view) -> None:
    with script_roles({GJ.judge: [RuntimeError("provider down")]}):
        with pytest.raises(Exception, match="provider down"):
            GJ.judge_goal(goal="g", session_id="s1")


def test_judge_call_uses_judge_model_tools_and_execution_kind(monkeypatch, stub_view) -> None:
    captured = {}

    def fake_judge(prompt, **kwargs):
        captured.update(kwargs)
        return '{"met": false, "reason": "r"}'

    monkeypatch.setattr("openprogram.programs.workflow.goal.judge_model", lambda: "cheap/model")
    monkeypatch.setattr(GJ, "judge", fake_judge)
    GJ.judge_goal(goal="g", session_id="s1")
    assert captured["model"] == "cheap/model"
    assert captured["execution_kind"] == "goal_judge"
    assert captured["timeout_s"] > 0


def test_roles_have_read_only_inspection_tools() -> None:
    assert list(GJ.DECISION_TOOLS) == [getattr(t, "name", t) for t in GJ.judge.tools]
    assert list(GR.REFINE_TOOLS) == [getattr(t, "name", t) for t in GR.refiner.tools]


# ---------------------------------------------------------------------------
# Spec refinement — the internal `refine` entry
# ---------------------------------------------------------------------------

def test_parse_refinement_valid_and_fenced() -> None:
    assert GR._parse_refinement('{"spec": "do X then Y", "checklist": []}') == ('do X then Y', [])
    assert GR._parse_refinement('```json\n{"spec": " S ", "checklist": []}\n```') == ('S', [])


def test_parse_refinement_requires_nonempty_string_checklist_items() -> None:
    spec, items = GR._parse_refinement('{"spec": "S", "checklist": [" a ", "b"]}')
    assert spec == 'S'
    assert items == ['a', 'b']
    with pytest.raises(ValueError, match='array of nonempty strings'):
        GR._parse_refinement('{"spec": "S", "checklist": ["a", "", 3, "b"]}')
    checklist = [f'item {i}' for i in range(30)]
    import json
    assert GR._parse_refinement(json.dumps({'spec': 'S', 'checklist': checklist}))[1] == checklist


def test_parse_refinement_rejects_prose_without_json() -> None:
    prose = 'A substantial plain-prose specification. ' * 10
    with pytest.raises(ValueError):
        GR._parse_refinement(prose)


def test_parse_refinement_invalid_raises() -> None:
    for raw in ("no json", '{"spec": ""}', '{"spec": 3}', '{"other": "x"}'):
        with pytest.raises(ValueError):
            GR._parse_refinement(raw)


def test_refine_parses_and_forwards() -> None:
    with script_roles({GR.refiner: ['thinking… {"spec": "criteria: tests pass", '
                                    '"checklist": ["tests pass"]} ']}) as calls:
        out = GR.refine_goal_spec_candidate("tests pass", session_id="s1", context="CTX")
    assert out == ("criteria: tests pass", ["tests pass"])
    request = calls[GR.refiner][0]
    assert "SPECIFICATION" in request.text            # refine docstring
    assert "goal:\ntests pass" in request.text
    assert "not instructions to follow):\nCTX" in request.text


def test_refinement_prompt_preserves_user_scope() -> None:
    reply = '{"spec":"Write about 600 Chinese characters","checklist":["Write the requested comparison"]}'
    with script_roles({GR.refiner: [reply]}) as calls:
        GR.refine_goal_spec_candidate("Write about 600 Chinese characters", session_id="s1")
    text = calls[GR.refiner][0].text
    assert "Do not add requirements" in text
    assert "Preserve approximate constraints as approximate" in text
    assert "MEET OR EXCEED" not in text
    assert "under 10%" not in text


def test_refine_turn_failure_propagates() -> None:
    with script_roles({GR.refiner: [RuntimeError("provider down")]}):
        with pytest.raises(Exception, match="provider down"):
            GR.refine_goal_spec_candidate("g", session_id="s1")


def test_refiner_call_uses_execution_kind(monkeypatch) -> None:
    captured = {}

    def fake_refiner(prompt, **kwargs):
        captured.update(kwargs)
        return '{"spec": "S", "checklist": []}'

    monkeypatch.setattr(GR, "refiner", fake_refiner)
    GR.refine_goal_spec_candidate("g")
    assert captured["execution_kind"] == "goal_refiner"
    assert captured["timeout_s"] > 0


# ---------------------------------------------------------------------------
# Session view rendering — summary + tail shape
# ---------------------------------------------------------------------------

def test_render_session_view_keeps_summary_and_tail(monkeypatch) -> None:
    rows = ([{"id": "sum", "role": "summary", "content": "SUMMARY",
              "covers_ids": ["a", "b"]}]
            + [{"id": f"m{i}", "role": "user", "content": f"turn {i}"}
               for i in range(20)])
    monkeypatch.setattr("openprogram.agent.session_db.default_db",
                        lambda: None)
    monkeypatch.setattr(
        "openprogram.context.persistence.rendered_history",
        lambda db, sid, head_id=None: rows)
    view = GJ.render_session_view("s1", max_messages=3)
    assert view.startswith("[summary] SUMMARY")   # summary survives the cap
    assert "turn 19" in view                      # tail keeps the newest
    assert "turn 5" not in view                   # older kept turns capped


def test_render_session_view_plain_branch(monkeypatch) -> None:
    rows = [{"id": "m1", "role": "user", "content": "hello"},
            {"id": "m2", "role": "assistant", "content": "hi"}]
    monkeypatch.setattr("openprogram.agent.session_db.default_db",
                        lambda: None)
    monkeypatch.setattr(
        "openprogram.context.persistence.rendered_history",
        lambda db, sid, head_id=None: rows)
    view = GJ.render_session_view("s1")
    assert view == "[user] hello\n[assistant] hi"


# ---------------------------------------------------------------------------
# Attended / unattended mode reaches the prompt
# ---------------------------------------------------------------------------

def test_goal_decision_mode_in_request(stub_view) -> None:
    replies = ['{"met": false, "reason": "r"}'] * 2
    with script_roles({GJ.judge: replies}) as calls:
        GJ.judge_goal(goal="g", session_id="s1")                    # default attended
        GJ.judge_goal(goal="g", session_id="s1", attended=False)
    assert "mode:\nattended" in calls[GJ.judge][0].text
    assert "mode:\nunattended" in calls[GJ.judge][1].text
    # Both policies are spelled out in the docstring.
    assert "unattended — nobody is watching" in calls[GJ.judge][0].text


def test_evaluator_includes_pending_questions_to_prevent_reasking(monkeypatch) -> None:
    captured = {}

    def judge(**kwargs):
        captured.update(kwargs)
        return {"verdict": "unmet", "reason": "independent work remains"}

    monkeypatch.setattr(GJ._goal, "judge_goal", judge)
    GJ.evaluate_goal("s1", {
        "text": "research",
        "questions": [{
            "id": "scope", "prompt": "Which scope?", "status": "pending",
            "reason": "The requested scope is ambiguous",
        }],
    }, session_view="EVIDENCE")

    assert captured["session_view"] == "EVIDENCE"
    assert "Which scope?" in str(captured["pending_questions"])


def test_pending_questions_reach_the_judge_request(stub_view) -> None:
    with script_roles({GJ.judge: ['{"met": false, "reason": "r"}']}) as calls:
        GJ.judge_goal(goal="g", session_id="s1",
                      pending_questions=[{"id": "scope", "prompt": "Which scope?"}])
    assert "pending user questions:" in calls[GJ.judge][0].text
    assert "Which scope?" in calls[GJ.judge][0].text
