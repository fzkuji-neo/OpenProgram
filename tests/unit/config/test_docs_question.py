"""Unit tests for the docs_question workflow
(``openprogram/programs/workflow/docs_question/``): the entry point's
input validation, the request its ``reader`` role sends, source path
normalization, and the shape it returns once the role has replied.

``script_roles`` answers the role, so these tests never reach a provider."""
from __future__ import annotations

import json

import pytest

from openprogram.testing import script_roles

import openprogram.programs.workflow.docs_question as DQ


@pytest.fixture
def fake_docs(tmp_path, monkeypatch):
    """A miniature docs/ tree, standing in for the repository's."""
    root = tmp_path / "docs"
    (root / "capabilities").mkdir(parents=True)
    (root / "capabilities" / "goal.md").write_text("# Session goals\n\nbody")
    (root / "capabilities" / "goal.zh.md").write_text("# 会话目标\n\n正文")
    (root / "README.md").write_text("# OpenProgram\n")
    (root / "_site").mkdir()
    (root / "_site" / "built.md").write_text("# build output\n")
    monkeypatch.setattr(DQ, "docs_root", lambda: root)
    return root


def _reply(answer="It can.", sources=("capabilities/goal.md",), covered=True):
    return json.dumps({"answer": answer, "sources": list(sources),
                       "covered": covered})


def _ask(question, reply=None):
    with script_roles({DQ.reader: [reply or _reply()]}) as calls:
        out = DQ.run_docs_question(question)
    return out, calls[DQ.reader][0]


# ---------------------------------------------------------------------------
# Entry point — argument validation
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("question", ["", "   ", "\n\t "])
def test_empty_question_is_rejected(fake_docs, question) -> None:
    with script_roles({DQ.reader: []}) as calls:
        with pytest.raises(ValueError, match="question"):
            DQ.run_docs_question(question)
    assert calls[DQ.reader] == []


def test_question_is_trimmed_into_the_prompt(fake_docs) -> None:
    _out, request = _ask("  can it set a goal?  ")
    assert request.prompt == "can it set a goal?"


# ---------------------------------------------------------------------------
# The request: page listing and the rules that matter
# ---------------------------------------------------------------------------

def test_request_lists_english_pages_with_titles(fake_docs) -> None:
    _out, request = _ask("q")
    assert "capabilities/goal.md — Session goals" in request.text
    assert "README.md — OpenProgram" in request.text
    assert "capabilities/goal.zh.md" not in request.text  # translations not listed
    assert "_site/built.md" not in request.text           # build output not listed
    assert str(fake_docs) in request.text                 # the scope it works in


def test_instructions_state_the_three_outcomes_and_the_no_fabrication_rule(
    fake_docs,
) -> None:
    _out, request = _ask("q")
    assert "covered=false" in request.system and "does not cover it" in request.system
    assert "NOT supported" in request.system      # documented-no is not the same
    assert "fabrication" in request.system
    assert "authoritative" in request.system      # English page wins


def test_missing_docs_tree_lists_nothing_rather_than_erroring(tmp_path) -> None:
    assert DQ.list_pages(tmp_path / "nope") == []
    assert DQ._listing(tmp_path / "nope") == "(no pages found)"


def test_generated_reference_pages_are_listed_only_when_present(
    fake_docs,
) -> None:
    # docs/reference/cli/ is gitignored build output — absent on a fresh
    # clone, and its absence is not an error.
    assert not any(rel.startswith("reference/")
                   for rel, _ in DQ.list_pages(fake_docs))
    generated = fake_docs / "reference" / "cli"
    generated.mkdir(parents=True)
    (generated / "run.md").write_text("# openprogram run\n")
    assert ("reference/cli/run.md", "openprogram run") in DQ.list_pages(fake_docs)


# ---------------------------------------------------------------------------
# The reader role is read-only and scoped
# ---------------------------------------------------------------------------

def test_tools_are_read_only() -> None:
    tools = [getattr(tool, "name", tool) for tool in DQ.reader.tools]
    assert set(tools) == set(DQ.DOCS_TOOLS)
    for forbidden in ('write', 'edit', 'apply_patch', 'bash', 'task'):
        assert forbidden not in tools
    assert DQ.run_docs_question.render_range == {'callers': 0, 'subcalls': 0}


def test_failed_turn_raises(fake_docs) -> None:
    with script_roles({DQ.reader: [RuntimeError('provider down')]}):
        with pytest.raises(Exception, match='provider down'):
            DQ.run_docs_question('p')


# ---------------------------------------------------------------------------
# Return shape
# ---------------------------------------------------------------------------

def test_returns_answer_sources_covered(monkeypatch, fake_docs) -> None:
    out, _request = _ask("can it set a goal?", _reply("Yes, with /goal.", ["capabilities/goal.md"]))
    assert out == {"answer": "Yes, with /goal.",
                   "sources": ["capabilities/goal.md"],
                   "covered": True}


def test_uncovered_answer_keeps_its_nearest_pages(monkeypatch, fake_docs) -> None:
    out, _request = _ask("does it fly?", _reply("The documentation does not cover this.",
                                                ["capabilities/goal.md"], covered=False))
    assert out["covered"] is False
    assert out["sources"] == ["capabilities/goal.md"]   # closest related page


def test_fenced_json_reply_is_accepted(fake_docs) -> None:
    out = DQ._parse_answer(
        '```json\n{"answer": "a", "sources": ["README.md"], "covered": true}\n```',
        fake_docs)
    assert out["answer"] == "a" and out["sources"] == ["README.md"]


@pytest.mark.parametrize("reply", [
    "no json at all",
    '{"answer": "a", "sources": []}',            # covered missing
    '{"answer": "a", "covered": "yes"}',         # covered not a bool
    '{"answer": "   ", "covered": true}',        # no answer text
])
def test_malformed_replies_are_rejected(reply, fake_docs) -> None:
    with pytest.raises(ValueError):
        DQ._parse_answer(reply, fake_docs)


# ---------------------------------------------------------------------------
# Source path normalization
# ---------------------------------------------------------------------------

def test_absolute_and_prefixed_paths_fold_to_one_form(fake_docs) -> None:
    want = "capabilities/goal.md"
    for raw in (
        "capabilities/goal.md",
        "docs/capabilities/goal.md",
        "/capabilities/goal.md",
        "`capabilities/goal.md`",
        "  capabilities/goal.md  ",
        "capabilities/goal.md#how-a-goal-is-judged",
        str(fake_docs / "capabilities" / "goal.md"),
    ):
        assert DQ.normalize_source(raw, fake_docs) == want


def test_paths_outside_docs_are_dropped(fake_docs) -> None:
    for raw in ("", "   ", "../secrets.md", "a/../../b.md", "/etc/passwd"):
        assert DQ.normalize_source(raw, fake_docs) == ""


def test_a_cited_page_that_does_not_exist_is_dropped(fake_docs) -> None:
    # A path the agent invented is not a source, however plausible it looks.
    assert DQ.normalize_source("capabilities/imaginary.md", fake_docs) == ""
    assert DQ._parse_answer(json.dumps({
        "answer": "a", "covered": True,
        "sources": ["capabilities/imaginary.md", "README.md"],
    }), fake_docs)["sources"] == ["README.md"]


def test_sources_are_deduplicated_in_order(fake_docs) -> None:
    out = DQ._parse_answer(json.dumps({
        "answer": "a", "covered": True,
        "sources": ["docs/README.md", "README.md", 7, None,
                    "/etc/passwd", "capabilities/goal.md"],
    }), fake_docs)
    assert out["sources"] == ["README.md", "capabilities/goal.md"]


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

def test_module_is_registered() -> None:
    from openprogram.programs._registry import PROGRAM_MODULES
    assert "docs_question" in PROGRAM_MODULES


def test_docs_root_points_at_the_repository_docs_tree() -> None:
    root = DQ.docs_root()
    assert root.name == "docs"
    assert (root / "capabilities").is_dir()
