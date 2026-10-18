"""Batch 2a coverage for agentics runtime.exec migration."""

from __future__ import annotations

import ast
import importlib
import inspect
from pathlib import Path

import pytest

from tests.support.repository import tracked_python_files

MIGRATED_FUNCTIONS = {
    "openprogram.programs.workflow.document.extract_pdf_figures": (
        "extract_pdf_figures",
    ),
    "openprogram.programs.workflow.document.extract_pdf_tables": (
        "extract_pdf_tables",
    ),
    "openprogram.programs.workflow.text": (
        "summarize_text",
        "translate_to_chinese",
        "polish_text",
    ),
    "openprogram.programs.workflow.research.evaluate": ("_evaluate_candidates", "compete"),
    "openprogram.programs.workflow.research.pipeline": ("research_pipeline",),
    "openprogram.programs.workflow.research.stages.idea": (
        "generate_ideas",
        "check_novelty",
        "rank_ideas",
        "run_idea",
    ),
    "openprogram.programs.workflow.research.stages.literature": (
        "survey_topic",
        "identify_gaps",
        "run_literature",
    ),
    "openprogram.programs.workflow.research.stages.experiment": (
        "design_experiments",
        "run_experiment",
        "check_training",
        "run_experiments",
    ),
    "openprogram.programs.workflow.research.stages.writing": (
        "write_section",
        "translate_zh2en",
        "translate_en2zh",
        "polish_rigorous",
        "polish_natural",
        "check_logic",
        "analyze_results",
        "compress_text",
        "expand_text",
    ),
    "openprogram.programs.workflow.research.stages.review": (
        "review_paper",
        "fix_paper",
        "review_loop",
    ),
    "openprogram.programs.workflow.research.stages.submission": (
        "check_submission",
        "run_submission_check",
    ),
}


@pytest.mark.parametrize(
    ("module_name", "function_name"),
    [
        (module_name, function_name)
        for module_name, function_names in MIGRATED_FUNCTIONS.items()
        for function_name in function_names
    ],
)
def test_migrated_functions_do_not_thread_runtime(module_name, function_name):
    function = getattr(importlib.import_module(module_name), function_name)

    assert "runtime" not in inspect.signature(function).parameters


def test_migrated_summary_uses_a_tool_free_role():
    from openprogram.testing import script_roles

    module = importlib.import_module("openprogram.programs.workflow.text")
    assert module.editor.tools == []
    with script_roles({module.editor: ["summary"]}) as calls:
        assert module.summarize_text("source text") == "summary"
    assert calls[module.editor][0].prompt == "Please summarize:\n\nsource text"


def test_programs_do_not_call_runtime_exec():
    root = Path(__file__).parents[3] / "openprogram" / "programs"
    scanned = 0
    remaining = []
    for path in tracked_python_files(root):
        scanned += 1
        source = path.read_text(encoding="utf-8")
        for node in ast.walk(ast.parse(source)):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr == "exec"
                and isinstance(node.func.value, ast.Name)
                and node.func.value.id.endswith("runtime")
            ):
                remaining.append((path.relative_to(root).as_posix(), node.lineno))

    assert scanned > 100
    assert remaining == []


def test_builtin_workflows_use_roles_not_agent_subclasses():
    """Built-in workflows define module-level roles and plain functions."""
    root = Path(__file__).parents[3] / "openprogram" / "programs" / "workflow"
    subclasses = []
    for path in tracked_python_files(root):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if isinstance(node, ast.ClassDef) and any(
                getattr(base, "id", getattr(base, "attr", None)) == "Agent"
                for base in node.bases
            ):
                subclasses.append((path.relative_to(root).as_posix(), node.name))
    assert subclasses == []


def test_review_loop_reviews_on_the_reviewer_and_fixes_on_the_author(tmp_path, monkeypatch):
    from openprogram.testing import script_roles
    from openprogram.programs.workflow.research import roles
    from openprogram.programs.workflow.research.stages import review as module

    # Role routing is under test here, not the sandboxed artifact writer.
    monkeypatch.setattr(module, "write_artifact", lambda path, text: Path(path).write_text(text))
    paper = tmp_path / "paper"
    paper.mkdir()
    (paper / "main.tex").write_text("Draft.\n")
    with script_roles({
        roles.reviewer: ['{"score": 5, "verdict": "revise"}', '{"score": 8, "verdict": "accept"}'],
        roles.author: ["% === main.tex ===\nRevised.\n"],
    }) as calls:
        result = module.review_loop(str(paper), max_rounds=2)

    assert len(calls[roles.reviewer]) == 2 and len(calls[roles.author]) == 1
    assert result["passed"] and result["rounds"] == 2
    assert (paper / "main.tex").read_text() == "Revised.\n"


def test_compete_judges_on_the_evaluator():
    from openprogram.testing import script_roles
    from openprogram.programs.workflow.research import roles
    from openprogram.programs.workflow.research.evaluate import compete

    def first(text: str) -> str:
        return "first " + text

    def second(text: str) -> str:
        return "second " + text

    with script_roles({
        roles.evaluator: ['{"winner": 2, "scores": [4, 9], "reasoning": "clearer"}'],
    }) as calls:
        result = compete([first, second], {"text": "draft"})

    assert len(calls[roles.evaluator]) == 1
    assert result["winner_name"] == "second"
    assert result["winner_output"] == "second draft"


def test_polish_chooses_style_without_a_user_setting():
    from openprogram.testing import script_roles

    module = importlib.import_module("openprogram.programs.workflow.text")
    with script_roles({module.editor: ["polished", "polished"]}) as calls:
        assert module.polish_text("A research abstract") == "polished"
        module.polish_text("A note", style="concise")
    first, second = calls[module.editor]
    assert "Choose an appropriate style" in first.prompt
    assert module.polish_text.input_meta["style"]["hidden"]
    assert inspect.signature(module.polish_text).parameters["style"].default == "auto"
    assert "in concise style" in second.prompt
