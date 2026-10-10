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


def test_migrated_summary_uses_agent_without_tools(monkeypatch):
    calls = []

    def fake_agent(prompt, **kwargs):
        calls.append((prompt, kwargs))
        return "summary"

    module = importlib.import_module("openprogram.programs.workflow.text")
    monkeypatch.setattr(module, "agent", fake_agent)

    assert module.summarize_text("source text") == "summary"
    assert calls == [("Please summarize:\n\nsource text", {"tools": []})]


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


def test_program_agent_methods_do_not_take_a_runtime():
    """Methods run on their Agent's Runtime (or the caller's), never a parameter."""
    root = Path(__file__).parents[3] / "openprogram" / "programs"
    threaded = {"runtime", "exec_runtime", "review_runtime"}
    methods = 0
    remaining = []
    for path in tracked_python_files(root):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if not isinstance(node, ast.ClassDef) or not any(
                getattr(base, "id", getattr(base, "attr", None)) == "Agent"
                for base in node.bases
            ):
                continue
            for item in node.body:
                if not isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    continue
                methods += 1
                arguments = item.args
                names = {
                    arg.arg
                    for arg in [*arguments.posonlyargs, *arguments.args, *arguments.kwonlyargs]
                }
                if names & threaded:
                    remaining.append((path.relative_to(root).as_posix(), item.name))

    assert methods > 20
    assert remaining == []


def _paper_runtime(replies, calls, name):
    from openprogram.agentic_programming.runtime import Runtime

    def call(content, model="default", response_format=None):
        calls.append(name)
        return replies.pop(0)

    return Runtime(call=call, model=name)


def test_review_loop_reviews_on_the_reviewer_and_fixes_on_the_caller(tmp_path, monkeypatch):
    from openprogram import Agent
    from openprogram.programs.workflow.research.stages import review as module
    from openprogram.programs.workflow.research.stages.review import (
        ReviewPaperAgent,
        review_loop,
    )

    # Runtime routing is under test here, not the sandboxed artifact writer.
    monkeypatch.setattr(module, "write_artifact", lambda path, text: Path(path).write_text(text))
    paper = tmp_path / "paper"
    paper.mkdir()
    (paper / "main.tex").write_text("Draft.\n")
    calls = []
    reviewer = ReviewPaperAgent(runtime=_paper_runtime(
        ['{"score": 5, "verdict": "revise"}', '{"score": 8, "verdict": "accept"}'],
        calls, "reviewer",
    ))
    executor_runtime = _paper_runtime(["% === main.tex ===\nRevised.\n"], calls, "executor")

    class Executor(Agent):
        def run(self):
            return review_loop(str(paper), reviewer=reviewer, max_rounds=2)

    result = Executor(runtime=executor_runtime).run()

    assert calls == ["reviewer", "executor", "reviewer"]
    assert result["passed"] and result["rounds"] == 2
    assert (paper / "main.tex").read_text() == "Revised.\n"


def test_compete_judges_on_the_evaluator():
    from openprogram import Agent
    from openprogram.programs.workflow.research.evaluate import (
        EvaluateCandidatesAgent,
        compete,
    )

    calls = []

    class Drafts(Agent):
        def first(self, text: str) -> str:
            return "first " + text

        def second(self, text: str) -> str:
            return "second " + text

    evaluator = EvaluateCandidatesAgent(runtime=_paper_runtime(
        ['{"winner": 2, "scores": [4, 9], "reasoning": "clearer"}'], calls, "evaluator",
    ))
    drafts = Drafts()
    result = compete([drafts.first, drafts.second], {"text": "draft"}, evaluator=evaluator)

    assert calls == ["evaluator"]
    assert result["winner_name"] == "second"
    assert result["winner_output"] == "second draft"


def test_polish_chooses_style_without_a_user_setting(monkeypatch):
    module = importlib.import_module("openprogram.programs.workflow.text")
    calls = []
    monkeypatch.setattr(
        module, "llm", lambda prompt, **kwargs: calls.append(prompt) or "polished"
    )
    assert module.polish_text("A research abstract") == "polished"
    assert len(calls) == 1
    assert "Choose an appropriate style" in calls[0][0]["text"]
    assert module.polish_text.input_meta["style"]["hidden"]
    assert inspect.signature(module.polish_text).parameters["style"].default == "auto"
    module.polish_text("A note", style="concise")
    assert "in concise style" in calls[1][0]["text"]
